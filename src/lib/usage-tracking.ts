/* eslint-disable @typescript-eslint/no-explicit-any */
import { createMiddleware } from 'langchain';

// ─── Pricing ────────────────────────────────────────────────────────────────
//
// Bedrock prices in USD per 1M tokens. Update when AWS changes pricing or you
// switch models. Defaults are conservative — when an unknown model id shows
// up, fall back to Kimi K2.5 rates (the configured default). Caching token
// rates: cache_read is ~10% of input, cache_creation is ~125%; only matters
// once Bedrock prompt caching is wired (not yet on this branch).

interface PricePerMillion {
  input: number;
  output: number;
  cacheRead?: number;
  cacheCreate?: number;
}

const PRICING: Record<string, PricePerMillion> = {
  // Kimi K2.5 on Bedrock (rough — verify on the AWS pricing page).
  'moonshotai.kimi-k2.5': { input: 0.25, output: 2.25 },
  // Anthropic on Bedrock — for if/when the AWS Marketplace subscription clears.
  'us.anthropic.claude-sonnet-4-5-20250929-v1:0': {
    input: 3.0,
    output: 15.0,
    cacheRead: 0.3,
    cacheCreate: 3.75,
  },
  // Nova families — for fallback testing.
  'global.amazon.nova-2-lite-v1:0': { input: 0.06, output: 0.24 },
};

const DEFAULT_PRICE: PricePerMillion = PRICING['moonshotai.kimi-k2.5']!;

function priceFor(modelId: string | undefined): PricePerMillion {
  if (!modelId) return DEFAULT_PRICE;
  return PRICING[modelId] ?? DEFAULT_PRICE;
}

// ─── Per-thread aggregation ────────────────────────────────────────────────
//
// In-process counters keyed by threadId. Reset is implicit — the agent server
// process restart clears them, which is fine for the use cases below (running
// totals visible in dev, batched logs flushed per-turn). For durable
// per-session totals you'd persist these to the DB; out of scope for now.

interface ThreadUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  modelCalls: number;
  costUsd: number;
}

const USAGE_REGISTRY = Symbol.for('codevibe.usageRegistry');

function getUsageRegistry(): Map<string, ThreadUsage> {
  const g = globalThis as any;
  if (!g[USAGE_REGISTRY]) g[USAGE_REGISTRY] = new Map<string, ThreadUsage>();
  return g[USAGE_REGISTRY] as Map<string, ThreadUsage>;
}

export function getThreadUsage(threadId: string): ThreadUsage | null {
  return getUsageRegistry().get(threadId) ?? null;
}

export function resetThreadUsage(threadId: string): void {
  getUsageRegistry().delete(threadId);
}

function blank(): ThreadUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    modelCalls: 0,
    costUsd: 0,
  };
}

// ─── Middleware ─────────────────────────────────────────────────────────────
//
// Wraps every model call: extract usage from the response, compute cost
// against the price table, accumulate per-thread totals, log a structured
// line, emit a custom event so the frontend can show a running counter.
//
// Output is one JSON line per call — easy to grep, easy to pipe to jq, and
// easy to ship to an observability platform later if you want to.

interface UsageMetadata {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_token_details?: {
    cache_read?: number;
    cache_creation?: number;
  };
}

function extractUsage(response: any): UsageMetadata | null {
  // LangChain v1 puts it on usage_metadata; the underlying Bedrock response
  // also exposes it on response_metadata.usage. Prefer the normalized field.
  return response?.usage_metadata ?? response?.lc_kwargs?.usage_metadata ?? null;
}

export const usageTrackingMiddleware = createMiddleware({
  name: 'usageTracking',
  wrapModelCall: async (request, handler) => {
    const response = await handler(request);

    const cfg = request.runtime?.configurable as Record<string, unknown> | undefined;
    const threadId = (cfg?.thread_id as string | undefined) ?? '_unknown';
    const sessionId = cfg?.sessionId as string | undefined;
    const userId = cfg?.userId as string | undefined;

    // The response from handler is an LLM result. The usage lives on the
    // AIMessage that was returned — for createAgent this is the last message
    // in response.messages, but the middleware contract wraps the model call
    // directly so response itself is the AIMessage.
    const message = (response as any)?.messages?.at?.(-1) ?? response;
    const usage = extractUsage(message);

    if (!usage) {
      // Some Bedrock paths (errors, mid-stream cancellations) return without
      // usage. Don't crash on this — just skip accumulation for that call.
      return response;
    }

    const modelId =
      (message?.response_metadata?.model_name as string | undefined) ??
      (message?.response_metadata?.model_id as string | undefined) ??
      (request.model as any)?.lc_kwargs?.model ??
      undefined;
    const price = priceFor(modelId);

    const inputTokens = usage.input_tokens ?? 0;
    const outputTokens = usage.output_tokens ?? 0;
    const cacheRead = usage.input_token_details?.cache_read ?? 0;
    const cacheCreate = usage.input_token_details?.cache_creation ?? 0;

    // Bedrock reports input_tokens as the *uncached* portion already; cache
    // tokens are accounted separately. If a deployment ever reports them as
    // additive, the cost will overshoot — error on that side, not under.
    const cost =
      (inputTokens * price.input) / 1_000_000 +
      (outputTokens * price.output) / 1_000_000 +
      (cacheRead * (price.cacheRead ?? price.input * 0.1)) / 1_000_000 +
      (cacheCreate * (price.cacheCreate ?? price.input * 1.25)) / 1_000_000;

    const reg = getUsageRegistry();
    const cur = reg.get(threadId) ?? blank();
    cur.inputTokens += inputTokens;
    cur.outputTokens += outputTokens;
    cur.cacheReadTokens += cacheRead;
    cur.cacheCreateTokens += cacheCreate;
    cur.modelCalls += 1;
    cur.costUsd += cost;
    reg.set(threadId, cur);

    // Structured single-line log — grep-friendly, jq-pipeable.
    console.log(
      JSON.stringify({
        kind: 'modelUsage',
        threadId,
        sessionId,
        userId,
        modelId,
        inputTokens,
        outputTokens,
        cacheRead,
        cacheCreate,
        callCostUsd: Number(cost.toFixed(6)),
        threadTotalUsd: Number(cur.costUsd.toFixed(6)),
        threadCalls: cur.modelCalls,
      }),
    );

    // Forward a custom event to the frontend so the running total can be
    // shown in the UI (dev builds only — gated client-side; emitting is
    // cheap and the hook on the other side decides whether to render it).
    request.runtime?.writer?.({
      type: 'tokenUsage',
      threadId,
      callCostUsd: Number(cost.toFixed(6)),
      threadTotalUsd: Number(cur.costUsd.toFixed(6)),
      threadCalls: cur.modelCalls,
      inputTokens: cur.inputTokens,
      outputTokens: cur.outputTokens,
    });

    return response;
  },
});
