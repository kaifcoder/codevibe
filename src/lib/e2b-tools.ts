/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSandbox } from '@/lib/sandbox-utils';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { globalEventEmitter } from '@/lib/event-emitter';

export function makeE2BTools(sbxId: string, sessionId?: string) {

  async function getSandboxSafe() {
    const sbx = await getSandbox(sbxId);
    if (!sbx) {
      if (sessionId) {
        globalEventEmitter.emit('agent:sandboxDeleted', { sessionId, oldSandboxId: sbxId });
      }
      throw new Error(`Sandbox ${sbxId} expired. Please create a new sandbox.`);
    }
    return sbx;
  }

  const runCommand = tool(
    async ({ command }: { command: string }) => {
      const sbx = await getSandboxSafe();
      const result = await sbx.commands.run(command);
      if (result.exitCode !== 0) {
        throw new Error(`Exit code ${result.exitCode}: ${result.stderr}`);
      }
      return result.stdout || '(no output)';
    },
    {
      name: 'e2b_run_command',
      description: 'Run a shell command in the sandbox.',
      schema: z.object({ command: z.string().min(1).describe('Shell command to run') }),
    }
  );

  const writeFile = tool(
    async ({ path, content }: { path: string; content: string }) => {
      try {
        const sbx = await getSandboxSafe();
        if (sessionId) {
          globalEventEmitter.emit('agent:codePatch', { sessionId, filePath: path, action: 'start' });
        }
        await sbx.files.write(path, content);
        if (sessionId) {
          globalEventEmitter.emit('agent:codePatch', { sessionId, filePath: path, content, action: 'patch' });
          globalEventEmitter.emit('agent:codePatch', { sessionId, filePath: path, content, action: 'complete' });
        }
        return `Wrote ${content.length} chars to ${path}`;
      } catch (error) {
        if (sessionId) {
          globalEventEmitter.emit('agent:codePatch', { sessionId, filePath: path, action: 'complete' });
        }
        throw new Error(`Failed to write ${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    {
      name: 'e2b_write_file',
      description: 'Create or overwrite a file. Directories are created automatically. To edit a file, read it first, modify the content, then write the full file back.',
      schema: z.object({
        path: z.string().min(1).describe('File path (e.g. "app/page.tsx")'),
        content: z.string().describe('Complete file content')
      }),
    }
  );

  const readFile = tool(
    async ({ path }: { path: string }) => {
      const sbx = await getSandboxSafe();
      return await sbx.files.read(path);
    },
    {
      name: 'e2b_read_file',
      description: 'Read a file from the sandbox.',
      schema: z.object({
        path: z.string().min(1).describe('File path to read')
      }),
    }
  );

  const listFiles = tool(
    async ({ path = '.' }: { path?: string }) => {
      const sbx = await getSandboxSafe();
      const files = await sbx.files.list(path);
      return files
        .sort((a: any, b: any) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
          return a.name.localeCompare(b.name);
        })
        .map((f: any) => `${f.isDir ? 'd' : 'f'} ${f.name}`)
        .join('\n') || '(empty)';
    },
    {
      name: 'e2b_list_files',
      description: 'List files and directories in a path.',
      schema: z.object({
        path: z.string().optional().describe('Directory path (defaults to ".")')
      }),
    }
  );

  const deleteFile = tool(
    async ({ path }: { path: string }) => {
      const sbx = await getSandboxSafe();
      await sbx.files.remove(path);
      return `Deleted ${path}`;
    },
    {
      name: 'e2b_delete_file',
      description: 'Delete a file or directory.',
      schema: z.object({
        path: z.string().min(1).describe('Path to delete')
      }),
    }
  );

  const listFilesRecursive = tool(
    async ({ rootPath = '/home/user', excludePaths }: {
      rootPath?: string;
      excludePaths?: string[];
    }) => {
      const sbx = await getSandboxSafe();
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

      async function scan(dirPath: string): Promise<FileInfo[]> {
        try {
          const files = await sbx.files.list(dirPath);
          const result: FileInfo[] = [];

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

      if (sessionId && fileTree.length > 0) {
        globalEventEmitter.emit('agent:fileTreeSync', { sessionId, fileTree });
      }

      return JSON.stringify(fileTree, null, 2);
    },
    {
      name: 'e2b_list_files_recursive',
      description: 'Recursively list all files with contents. Excludes node_modules, .git, .next, etc.',
      schema: z.object({
        rootPath: z.string().optional().describe('Root path (defaults to /home/user)'),
        excludePaths: z.array(z.string()).optional().describe('Additional paths to exclude')
      }),
    }
  );

  return [runCommand, writeFile, readFile, listFiles, deleteFile, listFilesRecursive];
}