/* eslint-disable @typescript-eslint/no-explicit-any */
// LangChain tools for executing commands in e2b sandboxes
import { getSandbox } from '@/inngest/utils';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

// Factory to create tools bound to a specific sbxId
export function makeE2BTools(sbxId: string) {
  
  // Helper function to get sandbox with error handling
  async function getSandboxSafe() {
    const sbx = await getSandbox(sbxId);
    if (!sbx) {
      throw new Error(`Sandbox with ID ${sbxId} not found or failed to initialize`);
    }
    return sbx;
  }

  // Tool to execute a shell command in an e2b sandbox
  const runCommand = tool(
    async ({ command }: { command: string }) => {
      const buffers = { stdout: "", stderr: "" };
      try {
        const sbx = await getSandboxSafe();
        const result = await sbx.commands.run(command, {
          onStdout(data: any) {
            console.log('stdout:', data.toString());
            buffers.stdout += data.toString();
          },
          onStderr(data: any) {
            console.error('stderr:', data.toString());
            buffers.stderr += data.toString();
          },
        });
        
        if (result.exitCode !== 0) {
          throw new Error(`Command failed with exit code ${result.exitCode}: ${buffers.stderr}`);
        }
        
        return buffers.stdout || `Command executed in sandbox ${sbxId}: ${command} \nOutput: ${buffers.stdout}`;
      } catch (error) {
        console.error('Error executing command in sandbox:', error);
        throw new Error(`Failed to execute command in sandbox ${sbxId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    {
      name: 'e2b_run_command',
      description: 'Run a shell command in a specific e2b sandbox and return the output.',
      schema: z.object({ command: z.string().min(1).describe('The shell command to run') }),
    }
  );

  // Enhanced file management tool - write/create files with directory creation
  const writeFile = tool(
    async ({ path, content }: { path: string; content: string }) => {
      try {
        const sbx = await getSandboxSafe();
        
        if (!content && content !== '') {
          throw new Error('Content cannot be null or undefined. Use empty string for empty files.');
        }

        // Create directory structure if it doesn't exist
        const dirPath = path.substring(0, path.lastIndexOf('/'));
        if (dirPath && dirPath !== path) {
          try {
            await sbx.files.makeDir(dirPath);
          } catch (error) {
            // Directory might already exist, that's fine
            console.log(`Directory ${dirPath} might already exist:`, error);
          }
        }

        await sbx.files.write(path, content);
        
        const stats = content.length;
        return `✅ Successfully wrote ${stats} characters to ${path} in sandbox ${sbxId}`;
      } catch (error) {
        console.error('Error writing file in sandbox:', error);
        throw new Error(`Failed to write file ${path} in sandbox ${sbxId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    {
      name: 'e2b_write_file',
      description: 'Create or completely overwrite a file with the specified content. Automatically creates necessary directories.',
      schema: z.object({
        path: z.string().min(1).describe('The file path to create/write (e.g., "src/components/Button.tsx")'),
        content: z.string().describe('The complete content to write to the file')
      }),
    }
  );

  // Read file tool with enhanced error handling
  const readFile = tool(
    async ({ path }: { path: string }) => {
      try {
        const sbx = await getSandboxSafe();
        const content = await sbx.files.read(path);
        const lines = content.split('\n').length;
        const chars = content.length;
        
        return `📄 Content of ${path} (${lines} lines, ${chars} characters):\n\n${content}`;
      } catch (error) {
        console.error('Error reading file in sandbox:', error);
        throw new Error(`Failed to read file ${path} in sandbox ${sbxId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    {
      name: 'e2b_read_file',
      description: 'Read the complete contents of a file from the sandbox.',
      schema: z.object({
        path: z.string().min(1).describe('The file path to read (e.g., "package.json")')
      }),
    }
  );

  // Advanced file editing tool - supports partial edits, insertions, replacements
  const editFile = tool(
    async ({ path, operation, content, lineNumber, searchText, replaceText }: {
      path: string;
      operation: 'append' | 'prepend' | 'insert_at_line' | 'replace_text' | 'replace_line';
      content?: string;
      lineNumber?: number;
      searchText?: string;
      replaceText?: string;
    }) => {
      try {
        const sbx = await getSandboxSafe();
        
        // Read existing content
        let existingContent = '';
        try {
          existingContent = await sbx.files.read(path);
        } catch {
          // File doesn't exist, create it if we're appending or prepending
          if (operation === 'append' || operation === 'prepend') {
            existingContent = '';
          } else {
            throw new Error(`File ${path} does not exist. Use e2b_write_file to create it first.`);
          }
        }

        let newContent = existingContent;
        let operationDescription = '';

        switch (operation) {
          case 'append':
            newContent = existingContent + (content || '');
            operationDescription = `Appended ${(content || '').length} characters`;
            break;

          case 'prepend':
            newContent = (content || '') + existingContent;
            operationDescription = `Prepended ${(content || '').length} characters`;
            break;

          case 'insert_at_line':
            if (lineNumber === undefined || !content) {
              throw new Error('lineNumber and content are required for insert_at_line operation');
            }
            const lines = existingContent.split('\n');
            lines.splice(lineNumber - 1, 0, content);
            newContent = lines.join('\n');
            operationDescription = `Inserted content at line ${lineNumber}`;
            break;

          case 'replace_text':
            if (!searchText || replaceText === undefined) {
              throw new Error('searchText and replaceText are required for replace_text operation');
            }
            if (!existingContent.includes(searchText)) {
              throw new Error(`Search text "${searchText}" not found in file ${path}`);
            }
            newContent = existingContent.replace(new RegExp(searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), replaceText);
            const replacements = (existingContent.match(new RegExp(searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
            operationDescription = `Replaced ${replacements} occurrences of "${searchText}"`;
            break;

          case 'replace_line':
            if (lineNumber === undefined || content === undefined) {
              throw new Error('lineNumber and content are required for replace_line operation');
            }
            const lineArray = existingContent.split('\n');
            if (lineNumber < 1 || lineNumber > lineArray.length) {
              throw new Error(`Line number ${lineNumber} is out of range (1-${lineArray.length})`);
            }
            lineArray[lineNumber - 1] = content;
            newContent = lineArray.join('\n');
            operationDescription = `Replaced line ${lineNumber}`;
            break;

          default:
            throw new Error(`Unknown operation: ${operation}`);
        }

        await sbx.files.write(path, newContent);
        return `✏️ ${operationDescription} in ${path}. File now has ${newContent.length} characters.`;
      } catch (error) {
        console.error('Error editing file in sandbox:', error);
        throw new Error(`Failed to edit file ${path} in sandbox ${sbxId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    {
      name: 'e2b_edit_file',
      description: 'Perform advanced editing operations on existing files (append, prepend, insert, replace text/lines).',
      schema: z.object({
        path: z.string().min(1).describe('The file path to edit'),
        operation: z.enum(['append', 'prepend', 'insert_at_line', 'replace_text', 'replace_line']).describe('The type of edit operation to perform'),
        content: z.string().optional().describe('Content for append, prepend, insert_at_line, or replace_line operations'),
        lineNumber: z.number().optional().describe('Line number for insert_at_line or replace_line operations (1-based)'),
        searchText: z.string().optional().describe('Text to search for in replace_text operation'),
        replaceText: z.string().optional().describe('Replacement text for replace_text operation')
      }),
    }
  );

  // List directory contents with detailed information
  const listFiles = tool(
    async ({ path = '.' }: { path?: string }) => {
      try {
        const sbx = await getSandboxSafe();
        const files = await sbx.files.list(path);
        
        if (files.length === 0) {
          return `📁 Directory ${path} is empty in sandbox ${sbxId}`;
        }
        
        const fileList = files
          .sort((a: any, b: any) => {
            // Directories first, then files, both alphabetically
            if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
            return a.name.localeCompare(b.name);
          })
          .map((file: any) => {
            const type = file.isDir ? '📁' : '📄';
            const size = file.isDir ? '' : ` (${formatFileSize(file.size)})`;
            return `${type} ${file.name}${size}`;
          }).join('\n');
        
        return `📁 Contents of ${path} in sandbox ${sbxId}:\n${fileList}`;
      } catch (error) {
        console.error('Error listing files in sandbox:', error);
        throw new Error(`Failed to list files in ${path} in sandbox ${sbxId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    {
      name: 'e2b_list_files',
      description: 'List files and directories in a specified path with detailed information.',
      schema: z.object({
        path: z.string().optional().describe('Directory path to list (defaults to current directory)')
      }),
    }
  );

  // Delete files or directories
  const deleteFile = tool(
    async ({ path }: { path: string }) => {
      try {
        const sbx = await getSandboxSafe();
        await sbx.files.remove(path);
        return `🗑️ Successfully deleted ${path} from sandbox ${sbxId}`;
      } catch (error) {
        console.error('Error deleting file in sandbox:', error);
        throw new Error(`Failed to delete ${path} in sandbox ${sbxId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    {
      name: 'e2b_delete_file',
      description: 'Delete a file or directory from the sandbox.',
      schema: z.object({
        path: z.string().min(1).describe('The file or directory path to delete')
      }),
    }
  );

  // Create directory with nested support
  const createDirectory = tool(
    async ({ path }: { path: string }) => {
      try {
        const sbx = await getSandboxSafe();
        await sbx.files.makeDir(path);
        return `📁 Successfully created directory ${path} in sandbox ${sbxId}`;
      } catch (error) {
        console.error('Error creating directory in sandbox:', error);
        throw new Error(`Failed to create directory ${path} in sandbox ${sbxId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    {
      name: 'e2b_create_directory',
      description: 'Create a new directory (supports nested directories).',
      schema: z.object({
        path: z.string().min(1).describe('The directory path to create (e.g., "src/components")')
      }),
    }
  );

  return [runCommand, writeFile, readFile, editFile, listFiles, deleteFile, createDirectory];
}

// Helper function to format file sizes
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}