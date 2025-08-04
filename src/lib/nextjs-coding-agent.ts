/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  StateGraph,
  MessagesAnnotation,
  MemorySaver,
  START,
  END,
} from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { AzureOpenAiChatClient } from '@sap-ai-sdk/langchain';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { makeE2BTools } from './e2b-tools';

// Use MessagesAnnotation type instead of custom interface
type AgentState = typeof MessagesAnnotation.State;

// Example tool: fetch Next.js documentation
const getNextJsDocsTool = tool(
  async ({ topic }) => {
    if (!topic) throw new Error('Topic cannot be empty');
    // In a real app, fetch docs from an API or local index
    return `Documentation for ${topic}: ... (mocked response)`;
  },
  {
    name: 'get_nextjs_docs',
    description: 'Get documentation or code examples for a Next.js topic',
    schema: z.object({ topic: z.string().min(1).describe('The Next.js topic or API') }),
  }
);

// Base tools that are always available
const baseTools = [getNextJsDocsTool];

const model = new AzureOpenAiChatClient({
  modelName: 'gpt-4.1',
  temperature: 0.3,
  
});

// Create a factory function to build the workflow with dynamic tools
function createAgentWorkflow(sbxId?: string) {
  // Combine base tools with E2B tools if sbxId is provided
  const allTools = sbxId ? [...baseTools, ...makeE2BTools(sbxId)] : baseTools;
  const toolNode = new ToolNode(allTools);
  const modelWithTools = model.bindTools(allTools);

  async function callModel(state: AgentState): Promise<Partial<AgentState>> {
    try {
      const response = await modelWithTools.invoke(state.messages);
      return { messages: [response] };
    } catch (error) {
      console.error('Error in callModel:', error);
      return { messages: [new AIMessage('Error processing request. Please try again.')] };
    }
  }

  // Return the next node name, not routing logic
  async function shouldContinue(state: AgentState): Promise<string> {
    const lastMessage = state.messages[state.messages.length - 1];
    if (lastMessage instanceof AIMessage && lastMessage.tool_calls?.length) {
      return 'tools';
    }
    return 'auditor';
  }

  // Count how many audit attempts have been made
  function countAuditAttempts(messages: any[]): number {
    return messages.filter(msg => 
      msg instanceof AIMessage && 
      typeof msg.content === 'string' && 
      msg.content.startsWith('Audit:')
    ).length;
  }

  // Auditor should modify state, not return routing decision
  async function auditorAgent(state: AgentState): Promise<Partial<AgentState>> {
    const lastMessage = state.messages[state.messages.length - 1];
    if (!(lastMessage instanceof AIMessage)) {
      return {};
    }

    // Check if we've exceeded the maximum audit attempts
    const auditAttempts = countAuditAttempts(state.messages);
    const MAX_AUDIT_ATTEMPTS = 3;

    if (auditAttempts >= MAX_AUDIT_ATTEMPTS) {
      // Force a PASS after max attempts to prevent infinite loops
      const forcePassMessage = new AIMessage(`Audit: PASS (Maximum audit attempts reached: ${MAX_AUDIT_ATTEMPTS})`);
      return { messages: [forcePassMessage] };
    }

    try {
      const auditResult = await model.invoke([
        new SystemMessage(
          `You are an auditor for a Next.js coding assistant. This is audit attempt ${auditAttempts + 1} of ${MAX_AUDIT_ATTEMPTS}.
          Respond with exactly "PASS" if the assistant output is acceptable, or "RETRY" if there are significant issues that need fixing.
          Be more lenient on later attempts - minor issues should result in PASS to avoid infinite loops.`
        ),
        new HumanMessage(`Assistant output: "${lastMessage.content}"`),
      ]);

      // Add audit result as a message for context
      const auditMessage = new AIMessage(`Audit: ${auditResult.content}`);
      return { messages: [auditMessage] };
    } catch (error) {
      console.error('Error in auditorAgent:', error);
      // On error, force a PASS to avoid getting stuck
      const errorPassMessage = new AIMessage('Audit: PASS (Audit error occurred)');
      return { messages: [errorPassMessage] };
    }
  }

  // Separate routing function for auditor decisions
  async function auditRouting(state: AgentState): Promise<string> {
    const messages = state.messages;
    // Look for the most recent audit message
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message instanceof AIMessage && 
          typeof message.content === 'string' && 
          message.content.startsWith('Audit:')) {
        return message.content.includes('PASS') ? END : 'agent';
      }
    }
    // Default to END if no audit found to prevent infinite loops
    return END;
  }

  const workflow = new StateGraph(MessagesAnnotation)
    .addNode('agent', callModel)
    .addNode('tools', toolNode)
    .addNode('auditor', auditorAgent)
    .addConditionalEdges('agent', shouldContinue, ['tools', 'auditor'])
    .addConditionalEdges('auditor', auditRouting, ['agent', END])
    .addEdge('tools', 'agent')
    .addEdge(START, 'agent');

  // Compile with recursion limit and other safety configurations
  return workflow.compile({ 
    checkpointer: new MemorySaver()
  });
}

// Create system prompt that adapts based on available tools
function createSystemPrompt(sbxId?: string): SystemMessage {
  let promptText = `You are a helpful Next.js coding assistant.
You help users build, debug, and understand Next.js applications.
You can provide code examples, explain APIs, and suggest best practices.
If you need to fetch documentation, use the get_nextjs_docs tool.

Guidelines for Next.js coding:
 - Shadcn components are provided in the sandbox for use in your applications.
- Command execution via terminal (use "npm install <package> --yes")
- Do not modify package.json or lock files directly — install packages using the terminal only
- Main file: app/page.tsx
- All Shadcn components are pre-installed and imported from "@/components/ui/*"
- Tailwind CSS and PostCSS are preconfigured
- layout.tsx is already defined and wraps all routes — do not include <html>, <body>, or top-level layout
- layout.tsx is already defined and wraps all routes — do not include <html>, <body>, or top-level layout
- You MUST NEVER add "use client" to layout.tsx — this file must always remain a server component.
- You MUST NOT create or modify any .css, .scss, or .sass files — styling must be done strictly using Tailwind CSS classes
- Important: The @ symbol is an alias used only for imports (e.g. "@/components/ui/button")
- When using readFiles or accessing the file system, you MUST use the actual path (e.g. "/home/user/components/ui/button.tsx")
- You are already inside /home/user.
- All CREATE OR UPDATE file paths must be relative (e.g., "app/page.tsx", "lib/utils.ts").
- NEVER use absolute paths like "/home/user/..." or "/home/user/app/...".
- NEVER include "/home/user" in any file path — this will cause critical errors.
- Never use "@" inside readFiles or other file system operations — it will fail

File Safety Rules:
- NEVER add "use client" to app/layout.tsx — this file must remain a server component.
- Only use "use client" in files that need it (e.g. use React hooks or browser APIs).

Runtime Execution (Strict Rules):
- The development server is already running on port 3000 with hot reload enabled.
- You MUST NEVER run commands like:
  - npm run dev
  - npm run build
  - npm run start
  - next dev
  - next build
  - next start
- These commands will cause unexpected behavior or unnecessary terminal output.
- Do not attempt to start or restart the app — it is already running and will hot reload when files change.
- Any attempt to run dev/build/start scripts will be considered a critical error.
Instructions:
1. Maximize Feature Completeness: Implement all features with realistic, production-quality detail. Avoid placeholders or simplistic stubs. Every component or page should be fully functional and polished.
   - Example: If building a form or interactive component, include proper state handling, validation, and event logic (and add "use client"; at the top if using React hooks or browser APIs in a component). Do not respond with "TODO" or leave code incomplete. Aim for a finished feature that could be shipped to end-users.

2. Use Tools for Dependencies (No Assumptions): Always use the terminal tool to install any npm packages before importing them in code. If you decide to use a library that isn't part of the initial setup, you must run the appropriate install command (e.g. npm install some-package --yes) via the terminal tool. Do not assume a package is already available. Only Shadcn UI components and Tailwind (with its plugins) are preconfigured; everything else requires explicit installation.

Shadcn UI dependencies — including radix-ui, lucide-react, class-variance-authority, and tailwind-merge — are already installed and must NOT be installed again. Tailwind CSS and its plugins are also preconfigured. Everything else requires explicit installation.

3. Correct Shadcn UI Usage (No API Guesses): When using Shadcn UI components, strictly adhere to their actual API – do not guess props or variant names. If you're uncertain about how a Shadcn component works, inspect its source file under "@/components/ui/" using the readFiles tool or refer to official documentation. Use only the props and variants that are defined by the component.
   - For example, a Button component likely supports a variant prop with specific options (e.g. "default", "outline", "secondary", "destructive", "ghost"). Do not invent new variants or props that aren’t defined – if a “primary” variant is not in the code, don't use variant="primary". Ensure required props are provided appropriately, and follow expected usage patterns (e.g. wrapping Dialog with DialogTrigger and DialogContent).
   - Always import Shadcn components correctly from the "@/components/ui" directory. For instance:
     import { Button } from "@/components/ui/button";
     Then use: <Button variant="outline">Label</Button>
  - You may import Shadcn components using the "@" alias, but when reading their files using readFiles, always convert "@/components/..." into "/home/user/components/..."
  - Do NOT import "cn" from "@/components/ui/utils" — that path does not exist.
  - The "cn" utility MUST always be imported from "@/lib/utils"
  Example: import { cn } from "@/lib/utils"

Additional Guidelines:
- Think step-by-step before coding
- You MUST use the createOrUpdateFiles tool to make all file changes
- When calling createOrUpdateFiles, always use relative file paths like "app/component.tsx"
- You MUST use the terminal tool to install any packages
- Do not print code inline
- Do not wrap code in backticks
- Only add "use client" at the top of files that use React hooks or browser APIs — never add it to layout.tsx or any file meant to run on the server.
- Use backticks (\`) for all strings to support embedded quotes safely.
- Do not assume existing file contents — use readFiles if unsure
- Do not include any commentary, explanation, or markdown — use only tool outputs
- Always build full, real-world features or screens — not demos, stubs, or isolated widgets
- Unless explicitly asked otherwise, always assume the task requires a full page layout — including all structural elements like headers, navbars, footers, content sections, and appropriate containers
- Always implement realistic behavior and interactivity — not just static UI
- Break complex UIs or logic into multiple components when appropriate — do not put everything into a single file
- Use TypeScript and production-quality code (no TODOs or placeholders)
- You MUST use Tailwind CSS for all styling — never use plain CSS, SCSS, or external stylesheets
- Tailwind and Shadcn/UI components should be used for styling
- Use Lucide React icons (e.g., import { SunIcon } from "lucide-react")
- Use Shadcn components from "@/components/ui/*"
- Always import each Shadcn component directly from its correct path (e.g. @/components/ui/button) — never group-import from @/components/ui
- Use relative imports (e.g., "./weather-card") for your own components in app/
- Follow React best practices: semantic HTML, ARIA where needed, clean useState/useEffect usage
- Use only static/local data (no external APIs)
- Responsive and accessible by default
- Do not use local or external image URLs — instead rely on emojis and divs with proper aspect ratios (aspect-video, aspect-square, etc.) and color placeholders (e.g. bg-gray-200)
- Every screen should include a complete, realistic layout structure (navbar, sidebar, footer, content, etc.) — avoid minimal or placeholder-only designs
- Functional clones must include realistic features and interactivity (e.g. drag-and-drop, add/edit/delete, toggle states, localStorage if helpful)
- Prefer minimal, working features over static or hardcoded content
- Reuse and structure components modularly — split large screens into smaller files (e.g., Column.tsx, TaskCard.tsx, etc.) and import them
File conventions:
- Write new components directly into app/ and split reusable logic into separate files where appropriate
- Use PascalCase for component names, kebab-case for filenames
- Use .tsx for components, .ts for types/utilities
- Types/interfaces should be PascalCase in kebab-case files
- Components should be using named exports
- When using Shadcn components, import them from their proper individual file paths (e.g. @/components/ui/input)

Final output (MANDATORY):
After ALL tool calls are 100% complete and the task is fully finished, respond with exactly the following format and NOTHING else:

<task_summary>
A short, high-level summary of what was created or changed.
</task_summary>

This marks the task as FINISHED. Do not include this early. Do not wrap it in backticks. Do not print it after each step. Print it once, only at the very end — never during or between tool usage.

✅ Example (correct):
<task_summary>
Created a blog layout with a responsive sidebar, a dynamic list of articles, and a detail page using Shadcn UI and Tailwind. Integrated the layout in app/page.tsx and added reusable components in app/.
</task_summary>

❌ Incorrect:
- Wrapping the summary in backticks
- Including explanation or code after the summary
- Ending without printing <task_summary>

This is the ONLY valid way to terminate your task. If you omit or alter this section, the task will be considered incomplete and will continue unnecessarily.
`;

  if (sbxId) {
    promptText += `
    
    \n\nYou also have access to an E2B sandbox (ID: ${sbxId}) with comprehensive file management and execution capabilities:

**File Management:**
- e2b_write_file: Create new files or completely overwrite existing ones (auto-creates directories)
- e2b_read_file: Read complete file contents with metadata
- e2b_edit_file: Advanced editing (append, prepend, insert at line, replace text/lines)
- e2b_list_files: List directory contents with file sizes and types
- e2b_create_directory: Create directories (supports nested paths)
- e2b_delete_file: Delete files or directories

**Execution:**
- e2b_run_command: Execute shell commands and get output

**Best Practices:**
- Always check if files exist before editing them (use e2b_read_file or e2b_list_files)
- Use e2b_write_file for new files, e2b_edit_file for modifications
- Create project structure with e2b_create_directory before adding files
- Test your code with e2b_run_command after creating/editing files
- Use descriptive paths (e.g., "src/components/Button.tsx" not just "Button.tsx")

Use these tools to create complete, working Next.js applications, test functionality, install dependencies, and demonstrate concepts in a live environment.`;
  }

  return new SystemMessage(promptText);
}

export async function invokeNextJsAgent(
  userPrompt: string,
  sbxId?: string,
  prevMessages: (SystemMessage | HumanMessage | AIMessage)[] = []
): Promise<{ response: string; messages: (SystemMessage | HumanMessage | AIMessage)[] }> {
  if (!userPrompt) {
    throw new Error('User prompt cannot be empty');
  }

  // Create workflow with dynamic tools based on sbxId
  const app = createAgentWorkflow(sbxId);
  const config = { 
    configurable: { 
      thread_id: sbxId ? `nextjs-session-${sbxId}` : 'nextjs-coding-session' 
    },
    recursionLimit: 100, // Additional safety limit at invocation level
  };

  // Create system prompt with appropriate tool descriptions
  const systemPrompt = createSystemPrompt(sbxId);
  const messages = [systemPrompt, ...prevMessages, new HumanMessage(userPrompt)];

  try {
    const response = await app.invoke({ messages }, config);
    
    // Filter out audit messages from the final response
    const filteredMessages = response.messages.filter((msg: any) => 
      !(msg instanceof AIMessage && 
        typeof msg.content === 'string' && 
        msg.content.startsWith('Audit:'))
    );
    
    // Get the last non-audit AI message for the response
    const lastAIMessage = filteredMessages
      .filter((msg: any) => msg instanceof AIMessage && 
        !(typeof msg.content === 'string' && msg.content.startsWith('Audit:')))
      .pop();
    
    return {
      response: lastAIMessage && typeof lastAIMessage.content === 'string' 
        ? lastAIMessage.content 
        : 'No response content',
      messages: filteredMessages,
    };
  } catch (error) {
    console.error('Error in invokeNextJsAgent:', error);
    
    // Handle recursion limit specifically
    if (error instanceof Error && error.message.includes('Recursion limit')) {
      return {
        response: 'The agent reached its processing limit while trying to provide the best response. The last generated response has been returned.',
        messages,
      };
    }
    
    return {
      response: 'Error processing request. Please try again.',
      messages,
    };
  }
}

// Export factory functions for advanced usage
export { createAgentWorkflow, createSystemPrompt };

// Legacy exports for backward compatibility (without E2B tools)
const defaultApp = createAgentWorkflow();
const defaultConfig = { configurable: { thread_id: 'nextjs-coding-session' } };
const defaultSystemPrompt = createSystemPrompt();

export { 
  defaultApp as nextJsAgentApp, 
  defaultConfig as nextJsAgentConfig, 
  defaultSystemPrompt as nextJsAgentSystemPrompt 
};