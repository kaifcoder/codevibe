/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSandbox } from '@/lib/sandbox-utils';
import { tool } from '@langchain/core/tools';
import { Sandbox } from '@e2b/code-interpreter';
import { z } from 'zod';
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import {
  getThreadSandbox,
  registerSandbox,
  resolveTemplateType,
  TEMPLATE_CONFIG,
  getInflightProvision,
  setInflightProvision,
  clearInflightProvision,
} from './sandbox-registry';
import { writeToYjsRoom } from './server-yjs-writer';
import { scanSandboxToTree } from './sandbox-scan';

async function resolveSandbox(config: LangGraphRunnableConfig): Promise<Sandbox> {
  // De-dupe concurrent provisioning per thread. With the parallel-component
  // workflow (multiple e2b_write_file tool calls in one assistant turn), N
  // copies of this function fire at once — without this guard, each one
  // finds the registry empty, calls Sandbox.create(), and we end up with
  // N sandboxes for a single thread (and burned E2B credits).
  //
  // The first concurrent caller stores its in-flight promise on the registry
  // entry; subsequent callers await it and reuse the result. Once it
  // resolves we clear the field so future expired-sandbox respawns work.
  const threadId = config.configurable?.thread_id as string;
  const inflight = getInflightProvision<Sandbox>(threadId);
  if (inflight) return inflight;

  const promise: Promise<Sandbox> = (async () => {
    try {
      return await resolveSandboxInner(config);
    } finally {
      clearInflightProvision(threadId);
    }
  })();
  setInflightProvision(threadId, promise);
  return promise;
}

async function resolveSandboxInner(config: LangGraphRunnableConfig): Promise<Sandbox> {
  const threadId = config.configurable?.thread_id as string;
  const entry = getThreadSandbox(threadId);

  // Frontend forwards its current sandboxId via configurable. After a rewarm
  // it points at a sandbox the agent process doesn't know about yet — adopt
  // it (re-register) so this run and subsequent ones use it instead of the
  // stale registry entry.
  const requestedSandboxId = config.configurable?.sandboxId as string | undefined;
  if (requestedSandboxId && requestedSandboxId !== entry?.sandboxId) {
    const sbx = await getSandbox(requestedSandboxId);
    if (sbx) {
      const adoptedTemplate = resolveTemplateType(
        entry?.templateType ?? config.configurable?.templateType,
      );
      if (adoptedTemplate === 'chat') {
        throw new Error('Sandbox tools cannot be used in chat mode.');
      }
      const cfg = TEMPLATE_CONFIG[adoptedTemplate];
      const host = sbx.getHost(cfg.port);
      const sandboxUrl = `https://${host}`;
      registerSandbox(threadId, requestedSandboxId, sandboxUrl, adoptedTemplate);
      config.writer?.({ type: 'sandboxCreated', sandboxId: requestedSandboxId, sandboxUrl, isNew: false });
      return sbx;
    }
    // Fall through — the sandboxId the frontend sent has already died.
  }

  if (entry?.sandboxId) {
    const sbx = await getSandbox(entry.sandboxId);
    if (sbx) {
      // Reattach: tell the frontend about the live sandbox in case this is a
      // fresh page load that didn't have sandboxUrl in the session row yet.
      // isNew=false signals the handler to skip iframe-loading flicker etc.
      config.writer?.({ type: 'sandboxCreated', sandboxId: entry.sandboxId, sandboxUrl: entry.sandboxUrl, isNew: false });
      return sbx;
    }
    config.writer?.({ type: 'sandboxExpired', sandboxId: entry.sandboxId });
  }

  // Auto-create sandbox if none exists or existing one expired. Template is
  // chosen by the session (frontend passes via config.configurable.templateType);
  // an existing registry entry's template wins on respawn after expiry so the
  // sandbox doesn't change image mid-conversation.
  const templateType = resolveTemplateType(
    entry?.templateType ?? config.configurable?.templateType,
  );
  if (templateType === 'chat') {
    throw new Error('Sandbox tools cannot be used in chat mode.');
  }
  const cfg = TEMPLATE_CONFIG[templateType];
  const sbx = await Sandbox.create(cfg.alias, { timeoutMs: 25 * 60 * 1000 });
  const host = sbx.getHost(cfg.port);
  const sandboxUrl = `https://${host}`;
  registerSandbox(threadId, sbx.sandboxId, sandboxUrl, templateType);
  config.writer?.({ type: 'sandboxCreated', sandboxId: sbx.sandboxId, sandboxUrl, isNew: true });

  // Emit initial file tree so frontend shows the structure immediately. n8n
  // sandboxes don't have a project tree to scan — skip the scan there.
  // Awaited (not fire-and-forget): the recursive sbx.files.list/read scan used
  // to take 10–20s on fresh nextjs projects, often outlasting the agent run,
  // and the post-run config.writer call dropped the fileTreeSync silently —
  // leaving the frontend with only fileCreated entries (= just agent-written
  // files, no boilerplate). The new tar-based scan finishes in ~1–2s; awaiting
  // it adds negligible delay to the first tool call but guarantees delivery.
  if (templateType === 'nextjs') {
    try {
      await scanAndEmitFileTree(sbx, config);
    } catch (err) {
      console.warn('[resolveSandbox] initial scan failed:', (err as Error).message);
    }
  }

  return sbx;
}

async function scanAndEmitFileTree(sbx: Sandbox, config: LangGraphRunnableConfig) {
  const sessionId = config.configurable?.sessionId as string | undefined;
  const fileTree = await scanSandboxToTree(sbx, { sessionId });
  config.writer?.({ type: 'fileTreeSync', fileTree });
}

// Exported wrapper so other entry points (e.g. any future manual sandbox
// provisioner) can guarantee the same initial tree
// emission as the implicit auto-create path inside resolveSandbox.
export async function emitInitialFileTree(sbx: Sandbox, config: LangGraphRunnableConfig) {
  try {
    await scanAndEmitFileTree(sbx, config);
  } catch (err) {
    console.warn('[emitInitialFileTree] scan failed:', (err as Error).message);
  }
}

// Commands the agent must NEVER run — the dev server is already running
// inside the sandbox and these either waste 30+ seconds, break the
// running server, or both. matchBlockedCommand() returns a short reason
// string when the input matches; null otherwise. Match conservatively
// — only obvious offenders. False positives are worse than letting a
// rare legit case through.
function matchBlockedCommand(raw: string): string | null {
  // Normalize: strip leading shell wrappers like "bash -c '...'", and
  // collapse multi-statement chains to inspect each piece.
  const stripped = raw.replace(/^\s*(?:bash|sh|zsh)\s+-c\s+['"]?(.+?)['"]?\s*$/, '$1');
  const segments = stripped.split(/&&|;|\|\||\|/).map((s) => s.trim()).filter(Boolean);
  for (const seg of segments) {
    // npm run build / next build / tsc — full project recompile that the
    // dev server already does incrementally on every save.
    if (/^(?:npm|pnpm|yarn|bun)\s+run\s+build\b/.test(seg)) {
      return 'never run `npm run build` (or pnpm/yarn/bun equivalent)';
    }
    if (/^(?:npx\s+)?next\s+build\b/.test(seg)) {
      return 'never run `next build`';
    }
    if (/^(?:npx\s+)?tsc(?:\s|$)/.test(seg)) {
      return 'never run `tsc` — the dev server already type-checks via Next.js compiler';
    }
    // Starting another dev / start server — the existing one is on port 3000.
    if (/^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start)\b/.test(seg)) {
      return 'never run `npm run dev` / `npm run start` — the dev server is already running on port 3000';
    }
    if (/^(?:npx\s+)?next\s+(?:dev|start)\b/.test(seg)) {
      return 'never run `next dev` / `next start` — already running on port 3000';
    }
    // npm install / add: sometimes legitimate (user asks for a package
    // not in the pre-installed list). Don't block — it's the agent's
    // call. The prompt already discourages it for pre-installed deps.
    // Leaving this branch out on purpose.
  }
  return null;
}

const runCommand = tool(
  async ({ command }: { command: string }, config: LangGraphRunnableConfig) => {
    // Hard-block commands that always waste time / break the running dev
    // server. The dev server (next dev, port 3000) is already running and
    // hot-reloads on every e2b_write_file; running build / tsc / install
    // here only burns the recursion budget without surfacing anything new.
    // See RULE 0 in nextjs-agent-prompt.ts.
    const blocked = matchBlockedCommand(command);
    if (blocked) {
      const errorOutput = `ERROR: ${blocked}. The dev server on port 3000 is already running and hot-reloads automatically. The post-write compile check inside e2b_write_file is the only build signal you need. Skip this command and continue with the next file change.`;
      config.writer?.({ type: 'tool_result', tool: 'e2b_run_command', args: { command }, result: `BLOCKED: ${blocked}` });
      return errorOutput;
    }

    config.writer?.({ type: 'tool_progress', tool: 'e2b_run_command', args: { command }, message: `Running: ${command}`, status: 'running' });
    const sbx = await resolveSandbox(config);
    // Per-command timeout: long enough for typical builds (npm install, dev
    // server startup) but short enough that a hung process doesn't kill the
    // whole agent run. If `sbx.commands.run` exceeds this it throws a
    // TimeoutError — caught below and returned as an error string so the
    // model can react (try a different approach) instead of the graph dying
    // with `[deadline_exceeded]`.
    const COMMAND_TIMEOUT_MS = 60_000;
    let result;
    try {
      result = await sbx.commands.run(command, { timeoutMs: COMMAND_TIMEOUT_MS });
    } catch (err) {
      const e = err as { name?: string; message?: string; result?: { stdout?: string; stderr?: string } };
      const isTimeout = (e.name ?? '').includes('Timeout') || /timed out|deadline/i.test(e.message ?? '');
      if (isTimeout) {
        const partialOut = e.result?.stdout ?? '';
        const partialErr = e.result?.stderr ?? '';
        const errorOutput =
          `ERROR: command exceeded ${COMMAND_TIMEOUT_MS / 1000}s timeout and was killed. ` +
          `If this was a long-running process (dev server, polling trigger, interactive REPL), ` +
          `run it with '&' or 'nohup ... &' to background it. ` +
          `If this was 'n8n execute' on a credential-required workflow, skip the execute — ` +
          `it hangs waiting for OAuth. Partial output:\n` +
          `${partialOut ? `STDOUT (last 200 chars): ${partialOut.slice(-200)}\n` : ''}` +
          `${partialErr ? `STDERR (last 200 chars): ${partialErr.slice(-200)}` : ''}`;
        config.writer?.({ type: 'tool_result', tool: 'e2b_run_command', args: { command }, result: `TIMEOUT after ${COMMAND_TIMEOUT_MS / 1000}s` });
        return errorOutput;
      }
      // Non-timeout errors: also return as a string instead of throwing, so
      // the agent loop continues and the model can try a different command.
      const message = e.message ?? String(err);
      const errorOutput = `ERROR: ${message.slice(0, 500)}`;
      config.writer?.({ type: 'tool_result', tool: 'e2b_run_command', args: { command }, result: `FAILED: ${message.slice(0, 200)}` });
      return errorOutput;
    }
    if (result.exitCode !== 0) {
      const errorOutput = `ERROR (exit ${result.exitCode}):\n${result.stderr || result.stdout || 'Unknown error'}`;
      config.writer?.({ type: 'tool_result', tool: 'e2b_run_command', args: { command }, result: `FAILED: ${errorOutput.slice(0, 200)}` });
      return errorOutput;
    }
    const output = result.stdout || '(no output)';
    config.writer?.({ type: 'tool_result', tool: 'e2b_run_command', args: { command }, result: output.slice(0, 200) });

    // n8n: when the agent imports a workflow, sniff the new id from SQLite and
    // emit `workflowReady` so the iframe deep-links to /workflow/<id>. The
    // CLI itself doesn't print the id reliably across versions; querying the
    // DB by createdAt is the only stable signal.
    if (/\bn8n\s+import:workflow\b/.test(command)) {
      try {
        const sql = `SELECT id || '|' || COALESCE(name,'') FROM workflow_entity ORDER BY datetime(createdAt) DESC LIMIT 1;`;
        const idRes = await sbx.commands.run(
          `sqlite3 /home/user/.n8n/database.sqlite "${sql}"`,
          { timeoutMs: 5_000 },
        );
        const line = (idRes.stdout ?? '').trim().split('\n')[0] ?? '';
        const [workflowId, workflowName] = line.split('|');
        if (workflowId) {
          config.writer?.({ type: 'workflowReady', workflowId, workflowName });
        }
      } catch (err) {
        console.warn('[e2b-tools] workflow id sniff failed:', (err as Error).message);
      }
    }

    return output;
  },
  {
    name: 'e2b_run_command',
    description: 'Run a shell command in the sandbox. Returns error output (instead of failing) so you can fix issues.',
    schema: z.object({ command: z.string().min(1).describe('Shell command to run') }),
  }
);

const writeFile = tool(
  async ({ path, content }: { path: string; content: string }, config: LangGraphRunnableConfig) => {
    const sbx = await resolveSandbox(config);
    config.writer?.({ type: 'tool_progress', tool: 'e2b_write_file', args: { path }, message: `Writing ${path}...`, status: 'running' });

    await sbx.files.write(path, content);

    // Tell the frontend this file exists so the sidebar can show it before any
    // fileTreeSync rescans. The actual content lives in Yjs (below).
    config.writer?.({ type: 'fileCreated', filePath: path });

    // Yjs mirror + compile-error check are independent — run them in parallel
    // so the tool doesn't block the agent for ~3s per file write. Still
    // awaited (not fire-and-forget) because Monaco loads file content from
    // Yjs; if a user clicks the file before the mirror lands they see the
    // empty doc.
    const sessionId = config.configurable?.sessionId as string | undefined;
    const yjsPromise: Promise<void> = (async () => {
      if (!sessionId) {
        console.warn('[e2b_write_file] No sessionId in config.configurable — skipping Yjs mirror for', path);
        return;
      }
      const room = `${sessionId}-${path}`;
      try {
        await writeToYjsRoom(room, content);
      } catch (err) {
        console.warn('[e2b_write_file] Yjs mirror failed:', room, '-', (err as Error).message);
      }
    })();

    const ext = path.substring(path.lastIndexOf('.'));
    const checkCompile = ['.tsx', '.ts', '.jsx', '.js'].includes(ext);
    const compilePromise: Promise<string | null> = checkCompile
      ? (async () => {
          try {
            const pageCheck = await sbx.commands.run(
              `curl -s http://localhost:3000 2>/dev/null | grep -o 'Server Error\\|Unhandled Runtime Error\\|Module not found\\|SyntaxError\\|TypeError\\|Cannot find module' | head -1`,
              { timeoutMs: 5000 }
            );
            if (!pageCheck.stdout || !pageCheck.stdout.trim()) return null;
            const errorDetail = await sbx.commands.run(
              `curl -s http://localhost:3000 2>/dev/null | grep -A5 -o 'Error:.*' | head -10`,
              { timeoutMs: 5000 }
            );
            return errorDetail.stdout?.trim() || pageCheck.stdout.trim();
          } catch {
            return null;
          }
        })()
      : Promise.resolve(null);

    const [, compileError] = await Promise.all([yjsPromise, compilePromise]);

    if (compileError) {
      const result = `Wrote ${content.length} chars to ${path}\n\n⚠️ COMPILATION ERROR DETECTED:\n${compileError}\n\nPlease fix this error before continuing.`;
      config.writer?.({ type: 'tool_result', tool: 'e2b_write_file', args: { path }, result: `WROTE but ERROR: ${compileError.slice(0, 100)}` });
      return result;
    }

    const result = `Wrote ${content.length} chars to ${path}`;
    config.writer?.({ type: 'tool_result', tool: 'e2b_write_file', args: { path }, result });
    return result;
  },
  {
    name: 'e2b_write_file',
    description: 'Create or overwrite a file. Directories are created automatically. To edit a file, read it first, modify the content, then write the full file back. After writing .ts/.tsx files, checks for compilation errors and reports them.',
    schema: z.object({
      path: z.string().min(1).describe('File path (e.g. "app/page.tsx")'),
      content: z.string().describe('Complete file content')
    }),
  }
);

const readFile = tool(
  async ({ path }: { path: string }, config: LangGraphRunnableConfig) => {
    config.writer?.({ type: 'tool_progress', tool: 'e2b_read_file', args: { path }, message: `Reading ${path}...`, status: 'running' });
    const sbx = await resolveSandbox(config);
    const content = await sbx.files.read(path);
    config.writer?.({ type: 'tool_result', tool: 'e2b_read_file', args: { path }, result: `Read ${content.length} chars` });
    return content;
  },
  {
    name: 'e2b_read_file',
    description: 'Read a file from the sandbox. Requires create_sandbox first.',
    schema: z.object({
      path: z.string().min(1).describe('File path to read')
    }),
  }
);

const listFiles = tool(
  async ({ path = '.' }: { path?: string }, config: LangGraphRunnableConfig) => {
    config.writer?.({ type: 'tool_progress', tool: 'e2b_list_files', args: { path }, message: `Listing ${path}...`, status: 'running' });
    const sbx = await resolveSandbox(config);
    const files = await sbx.files.list(path);
    const result = files
      .sort((a: any, b: any) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map((f: any) => `${f.isDir ? 'd' : 'f'} ${f.name}`)
      .join('\n') || '(empty)';
    config.writer?.({ type: 'tool_result', tool: 'e2b_list_files', args: { path }, result: result.slice(0, 200) });
    return result;
  },
  {
    name: 'e2b_list_files',
    description: 'List files and directories in a path. Requires create_sandbox first.',
    schema: z.object({
      path: z.string().optional().describe('Directory path (defaults to ".")')
    }),
  }
);

const deleteFile = tool(
  async ({ path }: { path: string }, config: LangGraphRunnableConfig) => {
    config.writer?.({ type: 'tool_progress', tool: 'e2b_delete_file', args: { path }, message: `Deleting ${path}...`, status: 'running' });
    const sbx = await resolveSandbox(config);
    await sbx.files.remove(path);
    config.writer?.({ type: 'tool_result', tool: 'e2b_delete_file', args: { path }, result: `Deleted ${path}` });
    return `Deleted ${path}`;
  },
  {
    name: 'e2b_delete_file',
    description: 'Delete a file or directory. Requires create_sandbox first.',
    schema: z.object({
      path: z.string().min(1).describe('Path to delete')
    }),
  }
);

// ─── e2b_patch_file ────────────────────────────────────────────────────────
//
// Targeted in-place edits via search-and-replace blocks. Far cheaper in
// output tokens than rewriting a 5k-token file when only 20 lines change,
// and immune to the "JSX truncation → cat >> EOF" loop we kept seeing
// because the model can't accidentally drop a closing tag — old_string
// must match verbatim or the patch errors back to the model.
//
// Format mirrors Claude Code / Cursor: each edit is { oldString, newString }.
// `oldString` must match EXACTLY once unless `replaceAll` is set; if it
// doesn't appear, or appears multiple times without replaceAll, the tool
// returns a hard error so the model retries with more context instead of
// silently smearing the file. Multiple edits in one call are applied in
// order against the same buffer — a later edit can see the result of an
// earlier one in the same call.

interface PatchEdit {
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}

function applyEdits(content: string, edits: PatchEdit[]): { ok: true; result: string; applied: number } | { ok: false; error: string } {
  let buf = content;
  let applied = 0;
  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i];
    if (!edit.oldString) {
      return { ok: false, error: `Edit #${i + 1}: oldString is empty (use e2b_write_file to create a new file).` };
    }
    if (edit.oldString === edit.newString) {
      return { ok: false, error: `Edit #${i + 1}: oldString === newString — nothing to do.` };
    }
    if (edit.replaceAll) {
      const before = buf;
      buf = buf.split(edit.oldString).join(edit.newString);
      if (buf === before) {
        return { ok: false, error: `Edit #${i + 1}: oldString not found in file. Re-read the file and use the EXACT text (including indentation).` };
      }
      applied++;
      continue;
    }
    const first = buf.indexOf(edit.oldString);
    if (first === -1) {
      return { ok: false, error: `Edit #${i + 1}: oldString not found. Re-read the file and copy the EXACT text (including whitespace and indentation). First 80 chars of oldString: ${JSON.stringify(edit.oldString.slice(0, 80))}` };
    }
    const second = buf.indexOf(edit.oldString, first + edit.oldString.length);
    if (second !== -1) {
      return { ok: false, error: `Edit #${i + 1}: oldString matches multiple times. Add more surrounding context (full lines above/below) so it's unique, or set replaceAll: true if you want every occurrence replaced.` };
    }
    buf = buf.slice(0, first) + edit.newString + buf.slice(first + edit.oldString.length);
    applied++;
  }
  return { ok: true, result: buf, applied };
}

const patchFile = tool(
  async (
    { path, edits }: { path: string; edits: PatchEdit[] },
    config: LangGraphRunnableConfig,
  ) => {
    if (!Array.isArray(edits) || edits.length === 0) {
      return 'ERROR: edits must be a non-empty array of { oldString, newString } objects.';
    }
    const sbx = await resolveSandbox(config);
    config.writer?.({ type: 'tool_progress', tool: 'e2b_patch_file', args: { path, count: edits.length }, message: `Patching ${path} (${edits.length} edit${edits.length === 1 ? '' : 's'})...`, status: 'running' });

    let original: string;
    try {
      original = await sbx.files.read(path);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      const errOut = `ERROR: could not read ${path} — ${msg.slice(0, 200)}. Use e2b_write_file to create a new file.`;
      config.writer?.({ type: 'tool_result', tool: 'e2b_patch_file', args: { path }, result: errOut.slice(0, 200) });
      return errOut;
    }

    const outcome = applyEdits(original, edits);
    if (!outcome.ok) {
      config.writer?.({ type: 'tool_result', tool: 'e2b_patch_file', args: { path }, result: `FAILED: ${outcome.error.slice(0, 160)}` });
      return `ERROR patching ${path}: ${outcome.error}`;
    }
    if (outcome.result === original) {
      config.writer?.({ type: 'tool_result', tool: 'e2b_patch_file', args: { path }, result: 'No-op (file unchanged)' });
      return `No-op: ${path} unchanged after applying edits.`;
    }

    await sbx.files.write(path, outcome.result);
    config.writer?.({ type: 'fileCreated', filePath: path });

    // Mirror the new content into Yjs so collaborators / Monaco see the
    // result without waiting for a rescan. Same pattern as e2b_write_file.
    const sessionId = config.configurable?.sessionId as string | undefined;
    if (sessionId) {
      try {
        await writeToYjsRoom(`${sessionId}-${path}`, outcome.result);
      } catch (err) {
        console.warn('[e2b_patch_file] Yjs mirror failed:', path, '-', (err as Error).message);
      }
    }

    const result = `Patched ${path} — applied ${outcome.applied}/${edits.length} edit${edits.length === 1 ? '' : 's'} (${original.length} → ${outcome.result.length} chars).`;
    config.writer?.({ type: 'tool_result', tool: 'e2b_patch_file', args: { path }, result });
    return result;
  },
  {
    name: 'e2b_patch_file',
    description:
      'Apply one or more search-and-replace edits to an EXISTING file. Cheaper than rewriting a full file when only a few lines change, and impossible to truncate JSX. ' +
      'For each edit, oldString must match the file EXACTLY (whitespace and indentation included) and uniquely — add surrounding context lines if the snippet alone appears more than once. ' +
      'Use replaceAll: true to replace every occurrence (e.g. renaming an identifier across the file). ' +
      'If you need to create a NEW file, use e2b_write_file instead. If the change is large enough that picking small unique snippets is awkward, prefer e2b_write_file.',
    schema: z.object({
      path: z.string().min(1).describe('File path to patch (must already exist).'),
      edits: z
        .array(
          z.object({
            oldString: z
              .string()
              .min(1)
              .describe(
                'Exact text to find in the file. Must include enough surrounding context to be unique. Whitespace, indentation, and newlines must match verbatim.',
              ),
            newString: z
              .string()
              .describe('Replacement text. Use an empty string to delete the matched region.'),
            replaceAll: z
              .boolean()
              .optional()
              .describe('If true, replace every occurrence of oldString. Defaults to false (must match exactly once).'),
          }),
        )
        .min(1)
        .describe('Ordered list of edits. Each later edit sees the result of all earlier edits in the same call.'),
    }),
  },
);

const listFilesRecursive = tool(
  async ({ rootPath = '/home/user', excludePaths }: {
    rootPath?: string;
    excludePaths?: string[];
  }, config: LangGraphRunnableConfig) => {
    config.writer?.({ type: 'tool_progress', tool: 'e2b_list_files_recursive', args: { rootPath }, message: 'Scanning file tree...', status: 'running' });
    const sbx = await resolveSandbox(config);
    const defaultExcludes = ['node_modules', '.git', '.next', 'dist', 'build', '.cache', 'components/ui', 'nextjs-app'];
    const excludes = new Set([...defaultExcludes, ...(excludePaths || [])]);

    const binaryExtensions = new Set([
      '.ico', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp',
      '.mp4', '.mov', '.avi', '.mp3', '.wav',
      '.zip', '.tar', '.gz', '.rar',
      '.exe', '.dll', '.so', '.dylib',
      '.pdf', '.doc', '.docx',
      '.woff', '.woff2', '.ttf', '.otf', '.eot'
    ]);
    const lockFiles = new Set(['.lock', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb']);

    interface FileInfo {
      name: string;
      path: string;
      type: 'file' | 'folder';
      children?: FileInfo[];
      content?: string;
    }

    let scannedDirs = 0;

    async function scan(dirPath: string): Promise<FileInfo[]> {
      try {
        const files = await sbx.files.list(dirPath);
        const result: FileInfo[] = [];
        scannedDirs++;

        if (scannedDirs % 5 === 0) {
          config.writer?.({ type: 'tool_progress', tool: 'e2b_list_files_recursive', args: { rootPath }, message: `Scanned ${scannedDirs} directories...`, status: 'running' });
        }

        for (const file of files) {
          if (excludes.has(file.name)) continue;

          const fullPath = dirPath === '/' ? `/${file.name}` : `${dirPath}/${file.name}`;
          const relativePath = fullPath.startsWith('/home/user/')
            ? fullPath.substring('/home/user/'.length)
            : fullPath;

          if (Array.from(excludes).some(exc => relativePath.includes(exc + '/'))) continue;

          if (file.type === 'dir') {
            const children = await scan(fullPath);
            if (children.length > 0) {
              result.push({ name: file.name, path: relativePath, type: 'folder', children });
            }
          } else {
            const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
            if (binaryExtensions.has(ext) || lockFiles.has(file.name)) continue;

            let content = '';
            try {
              if (file.size < 100000) {
                content = (await sbx.files.read(fullPath)).replaceAll('\x00', '');
              }
            } catch { /* skip unreadable */ }

            result.push({ name: file.name, path: relativePath, type: 'file', content });
          }
        }

        return result.sort((a, b) => {
          if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      } catch {
        return [];
      }
    }

    const fileTree = await scan(rootPath);

    config.writer?.({ type: 'fileTreeSync', fileTree });
    config.writer?.({ type: 'tool_result', tool: 'e2b_list_files_recursive', args: { rootPath }, result: `Scanned ${scannedDirs} directories` });
    return JSON.stringify(fileTree, null, 2);
  },
  {
    name: 'e2b_list_files_recursive',
    description: 'Recursively list all files with contents. Excludes node_modules, .git, .next, etc. Requires create_sandbox first.',
    schema: z.object({
      rootPath: z.string().optional().describe('Root path (defaults to /home/user)'),
      excludePaths: z.array(z.string()).optional().describe('Additional paths to exclude')
    }),
  }
);

export const e2bTools = [runCommand, writeFile, patchFile, readFile, listFiles, deleteFile, listFilesRecursive];
