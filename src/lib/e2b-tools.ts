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
} from './sandbox-registry';
import { writeToYjsRoom } from './server-yjs-writer';
import { scanSandboxToTree } from './sandbox-scan';

async function resolveSandbox(config: LangGraphRunnableConfig) {
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

// Exported wrapper so other entry points (e.g. createSandboxTool in agent.ts,
// any future manual sandbox provisioner) can guarantee the same initial tree
// emission as the implicit auto-create path inside resolveSandbox.
export async function emitInitialFileTree(sbx: Sandbox, config: LangGraphRunnableConfig) {
  try {
    await scanAndEmitFileTree(sbx, config);
  } catch (err) {
    console.warn('[emitInitialFileTree] scan failed:', (err as Error).message);
  }
}

const runCommand = tool(
  async ({ command }: { command: string }, config: LangGraphRunnableConfig) => {
    config.writer?.({ type: 'tool_progress', tool: 'e2b_run_command', args: { command }, message: `Running: ${command}`, status: 'running' });
    const sbx = await resolveSandbox(config);
    const result = await sbx.commands.run(command, { timeoutMs: 60000 });
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

export const e2bTools = [runCommand, writeFile, readFile, listFiles, deleteFile, listFilesRecursive];
