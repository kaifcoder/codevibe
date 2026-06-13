"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// Poll /api/agent-ready until the LangGraph dyno reports ready. New users on a
// freshly-spun-up Render Starter dyno can hit a 30–90s cold start; without a
// gate the first stream.submit lands on a sleeping process and the chat thread
// looks frozen with no error. This hook drives the "Waking up the backend"
// banner and lets handleSend await readiness before submitting.

const POLL_INTERVAL_MS = 2_500;
const SESSION_READY_KEY = "codevibe.agentReady.until";
// Short cache window: if the agent reported ready in the last minute, skip the
// initial probe to avoid the banner flashing on every navigation. Re-probes on
// cache miss so a dyno that fell asleep mid-session is still detected.
const READY_CACHE_MS = 60_000;

function readReadyCache(): boolean {
  if (typeof window === "undefined") return false;
  const raw = sessionStorage.getItem(SESSION_READY_KEY);
  if (!raw) return false;
  const until = Number(raw);
  if (!Number.isFinite(until)) return false;
  return Date.now() < until;
}

function writeReadyCache() {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(SESSION_READY_KEY, String(Date.now() + READY_CACHE_MS));
}

function clearReadyCache() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(SESSION_READY_KEY);
}

export interface AgentReadyState {
  /** true once /api/agent-ready returned ready, OR if the cache says so. */
  ready: boolean;
  /** true while we're actively polling and haven't gotten a ready=true yet. */
  warming: boolean;
  /** Best-effort wait helper for handleSend. Resolves once ready or after timeoutMs. */
  waitUntilReady: (timeoutMs?: number) => Promise<boolean>;
  /** Force a re-probe (e.g. after a submit failure looks like a cold-start). */
  invalidate: () => void;
}

export function useAgentReady(): AgentReadyState {
  const [ready, setReady] = useState<boolean>(() => readReadyCache());
  const [warming, setWarming] = useState<boolean>(() => !readReadyCache());
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const cancelledRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const probe = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/agent-ready", { cache: "no-store" });
      const data = await res.json();
      return Boolean(data?.ready);
    } catch {
      return false;
    }
  }, []);

  const startPolling = useCallback(() => {
    cancelledRef.current = false;
    setWarming(true);
    setReady(false);
    const tick = async () => {
      if (cancelledRef.current) return;
      const ok = await probe();
      if (cancelledRef.current) return;
      if (ok) {
        writeReadyCache();
        setReady(true);
        setWarming(false);
        return;
      }
      pollTimerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
    };
    tick();
  }, [probe]);

  useEffect(() => {
    if (readReadyCache()) return; // already warm — no banner, no polling
    startPolling();
    return () => {
      cancelledRef.current = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [startPolling]);

  const waitUntilReady = useCallback(
    async (timeoutMs = 90_000): Promise<boolean> => {
      if (readyRef.current) return true;
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const ok = await probe();
        if (ok) {
          writeReadyCache();
          setReady(true);
          setWarming(false);
          return true;
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
      return false;
    },
    [probe],
  );

  const invalidate = useCallback(() => {
    clearReadyCache();
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    startPolling();
  }, [startPolling]);

  return { ready, warming, waitUntilReady, invalidate };
}
