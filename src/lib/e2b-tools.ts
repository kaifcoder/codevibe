/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSandbox } from '@/lib/sandbox-utils';
import { tool } from '@langchain/core/tools';
import { Sandbox } from '@e2b/code-interpreter';
import { z } from 'zod';
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import { getThreadSandbox, registerSandbox } from './sandbox-registry';

async function resolveSandbox(config: LangGraphRunnableConfig) {
  const threadId = config.configurable?.thread_id as string;
  const entry = getThreadSandbox(threadId);

  if (entry) {
    const sbx = await getSandbox(entry.sandboxId);
    if (sbx) return sbx;
    // Sandbox expired — fall through to create a new one
    config.writer?.({ type: 'sandboxExpired', sandboxId: entry.sandboxId });
  }

  // Auto-create sandbox if none exists or existing one expired
  const sbx = await Sandbox.create('codevibe-test', { timeoutMs: 25 * 60 * 1000 });
  const host = sbx.getHost(3000);
  const sandboxUrl = `https://${host}`;
  registerSandbox(threadId, sbx.sandboxId, sandboxUrl);
  config.writer?.({ type: 'sandboxCreated', sandboxId: sbx.sandboxId, sandboxUrl, isNew: true });
  return sbx;
}

const runCommand = tool(
  async ({ command }: { command: string }, config: LangGraphRunnableConfig) => {
    config.writer?.({ type: 'tool_progress', tool: 'e2b_run_command', args: { command }, message: `Running: ${command}`, status: 'running' });
    const sbx = await resolveSandbox(config);
    const result = await sbx.commands.run(command);
    if (result.exitCode !== 0) {
      throw new Error(`Exit code ${result.exitCode}: ${result.stderr}`);
    }
    const output = result.stdout || '(no output)';
    config.writer?.({ type: 'tool_result', tool: 'e2b_run_command', args: { command }, result: output.slice(0, 200) });
    return output;
  },
  {
    name: 'e2b_run_command',
    description: 'Run a shell command in the sandbox. Requires create_sandbox to have been called first.',
    schema: z.object({ command: z.string().min(1).describe('Shell command to run') }),
  }
);

const writeFile = tool(
  async ({ path, content }: { path: string; content: string }, config: LangGraphRunnableConfig) => {
    const sbx = await resolveSandbox(config);
    config.writer?.({ type: 'codePatch', filePath: path, action: 'streaming_start' });
    config.writer?.({ type: 'tool_progress', tool: 'e2b_write_file', args: { path }, message: `Writing ${path}...`, status: 'running' });

    // Emit content in chunks for typing effect
    const CHUNK_SIZE = 80;
    for (let i = 0; i < content.length; i += CHUNK_SIZE) {
      config.writer?.({ type: 'codePatch', filePath: path, content: content.slice(0, i + CHUNK_SIZE), action: 'streaming_chunk' });
    }

    await sbx.files.write(path, content);

    config.writer?.({ type: 'codePatch', filePath: path, content, action: 'streaming_end' });
    const result = `Wrote ${content.length} chars to ${path}`;
    config.writer?.({ type: 'tool_result', tool: 'e2b_write_file', args: { path }, result });
    return result;
  },
  {
    name: 'e2b_write_file',
    description: 'Create or overwrite a file. Directories are created automatically. To edit a file, read it first, modify the content, then write the full file back. Requires create_sandbox first.',
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
