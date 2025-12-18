/* eslint-disable @typescript-eslint/no-explicit-any */
import { InMemoryStore } from '@langchain/langgraph';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

// Create a memory store instance
// NOTE: InMemoryStore persists during server runtime but clears on restart
// For production persistence across restarts, use a database-backed store:
//
// PostgreSQL:
// import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
// export const agentMemoryStore = PostgresSaver.fromConnString(process.env.DATABASE_URL);
//
// Redis:
// import { RedisSaver } from '@langchain/langgraph-checkpoint-redis';
// export const agentMemoryStore = new RedisSaver({ url: process.env.REDIS_URL });
//
// Current setup: InMemoryStore (good for development, persists across prompts)
export const agentMemoryStore = new InMemoryStore();

// Schema for user/session context
export interface AgentContext {
  userId?: string;
  sessionId: string;
  workspaceId?: string;
}

// Memory schemas
const UserPreferencesSchema = z.object({
  language: z.string().optional(),
  codeStyle: z.string().optional(),
  framework: z.string().optional(),
  preferences: z.array(z.string()).optional(),
});

const ConversationContextSchema = z.object({
  topics: z.array(z.string()).optional(),
  files: z.array(z.string()).optional(),
  lastActivity: z.string().optional(),
  projectContext: z.string().optional(),
});

const TaskHistorySchema = z.object({
  completedTasks: z.array(z.string()).optional(),
  pendingTasks: z.array(z.string()).optional(),
  errors: z.array(z.string()).optional(),
});

// Tool to read user preferences and session context
export const getSessionMemoryTool = tool(
  async ({ category }, context: any) => {
    const sessionId = context?.configurable?.thread_id || 'default';
    const namespace = ['sessions', sessionId];

    try {
      const memory = await agentMemoryStore.get(namespace, category);
      
      if (!memory?.value) {
        return `No ${category} memory found for this session.`;
      }

      return JSON.stringify(memory.value, null, 2);
    } catch (error) {
      console.error('Error reading session memory:', error);
      return `Failed to retrieve ${category} memory.`;
    }
  },
  {
    name: 'get_session_memory',
    description: 'Retrieve stored information about the current session including user preferences, conversation context, or task history. Use this to maintain context across conversations.',
    schema: z.object({
      category: z.enum(['preferences', 'context', 'tasks']).describe('The category of memory to retrieve: preferences (user settings), context (conversation topics), or tasks (completed/pending tasks)'),
    }),
  }
);

// Tool to save user preferences and session context
export const saveSessionMemoryTool = tool(
  async ({ category, data }, context: any) => {
    const sessionId = context?.configurable?.thread_id || 'default';
    const namespace = ['sessions', sessionId];

    try {
      // Validate data based on category
      let validatedData: any;
      switch (category) {
        case 'preferences':
          validatedData = UserPreferencesSchema.parse(data);
          break;
        case 'context':
          validatedData = ConversationContextSchema.parse(data);
          break;
        case 'tasks':
          validatedData = TaskHistorySchema.parse(data);
          break;
      }

      // Get existing memory to merge with new data
      const existing = await agentMemoryStore.get(namespace, category);
      const merged = existing?.value 
        ? { ...existing.value, ...validatedData, updatedAt: new Date().toISOString() }
        : { ...validatedData, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };

      await agentMemoryStore.put(namespace, category, merged);

      return `Successfully saved ${category} memory for session ${sessionId}.`;
    } catch (error) {
      console.error('Error saving session memory:', error);
      return `Failed to save ${category} memory: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },
  {
    name: 'save_session_memory',
    description: 'Save information about the current session for future reference. Use this to remember user preferences, conversation topics, files being worked on, or completed tasks.',
    schema: z.object({
      category: z.enum(['preferences', 'context', 'tasks']).describe('The category of memory to save'),
      data: z.union([z.record(z.string(), z.any()), z.object({}).passthrough()]).describe('The data to save as a JSON object with key-value pairs'),
    }),
  }
);

// Tool to search memories across sessions (useful for user history)
export const searchMemoriesTool = tool(
  async ({ query }, context: any) => {
    const sessionId = context?.configurable?.thread_id || 'default';
    const namespace = ['sessions', sessionId];

    try {
      // Search within the session namespace
      const results = await agentMemoryStore.search(namespace, {
        query,
        limit: 5,
      });

      if (results.length === 0) {
        return `No memories found matching "${query}".`;
      }

      const formatted = results.map((result: any) => ({
        key: result.key,
        data: result.value,
        relevance: result.score,
      }));

      return JSON.stringify(formatted, null, 2);
    } catch (error) {
      console.error('Error searching memories:', error);
      return `Failed to search memories: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },
  {
    name: 'search_session_memories',
    description: 'Search through session memories to find relevant information. Useful for recalling specific details from past interactions.',
    schema: z.object({
      query: z.string().describe('The search query to find relevant memories'),
    }),
  }
);

// Helper functions for direct memory access (without tool calls)
export async function getSessionMemory(sessionId: string, category: string) {
  const namespace = ['sessions', sessionId];
  try {
    const memory = await agentMemoryStore.get(namespace, category);
    return memory?.value || null;
  } catch (error) {
    console.error('Error getting session memory:', error);
    return null;
  }
}

export async function saveSessionMemory(sessionId: string, category: string, data: any) {
  const namespace = ['sessions', sessionId];
  try {
    const existing = await agentMemoryStore.get(namespace, category);
    const merged = existing?.value 
      ? { ...existing.value, ...data, updatedAt: new Date().toISOString() }
      : { ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };

    await agentMemoryStore.put(namespace, category, merged);
    return true;
  } catch (error) {
    console.error('Error saving session memory:', error);
    return false;
  }
}

export async function clearSessionMemory(sessionId: string) {
  const namespace = ['sessions', sessionId];
  try {
    // Delete all memory categories for this session
    await agentMemoryStore.delete(namespace, 'preferences');
    await agentMemoryStore.delete(namespace, 'context');
    await agentMemoryStore.delete(namespace, 'tasks');
    await agentMemoryStore.delete(namespace, 'messages');
    await agentMemoryStore.delete(namespace, 'workSummary');
    return true;
  } catch (error) {
    console.error('Error clearing session memory:', error);
    return false;
  }
}

// ============ Chat Message History Functions ============

export type StoredChatMessage = {
  role: 'user' | 'ai';
  content: string;
  ts: number;
};

export type WorkSummary = {
  filesCreated: string[];
  filesModified: string[];
  lastAction: string;
  componentsMade: string[];
  ts: number;
};

const MAX_MESSAGES = 40; // cap per session to avoid unbounded memory

export async function getSessionMessages(sessionId: string): Promise<StoredChatMessage[]> {
  const memory = await getSessionMemory(sessionId, 'messages');
  if (!memory?.messages || !Array.isArray(memory.messages)) {
    return [];
  }
  return memory.messages as StoredChatMessage[];
}

export async function appendSessionMessages(sessionId: string, newMessages: StoredChatMessage[]) {
  if (!sessionId || newMessages.length === 0) return;
  
  const existing = await getSessionMessages(sessionId);
  const merged = [...existing, ...newMessages];
  // Trim oldest if exceeding cap
  const trimmed = merged.slice(-MAX_MESSAGES);
  
  await saveSessionMemory(sessionId, 'messages', { messages: trimmed });
}

export async function resetSession(sessionId: string) {
  await clearSessionMemory(sessionId);
}

export async function getWorkSummary(sessionId: string): Promise<WorkSummary | null> {
  const memory = await getSessionMemory(sessionId, 'workSummary');
  return memory as WorkSummary | null;
}

export async function updateWorkSummary(sessionId: string, summary: Partial<WorkSummary>) {
  if (!sessionId) return;
  
  const existing = await getWorkSummary(sessionId) || {
    filesCreated: [],
    filesModified: [],
    lastAction: '',
    componentsMade: [],
    ts: Date.now()
  };
  
  const updated: WorkSummary = {
    filesCreated: [...existing.filesCreated, ...(summary.filesCreated || [])],
    filesModified: [...existing.filesModified, ...(summary.filesModified || [])],
    lastAction: summary.lastAction || existing.lastAction,
    componentsMade: [...existing.componentsMade, ...(summary.componentsMade || [])],
    ts: Date.now()
  };
  
  await saveSessionMemory(sessionId, 'workSummary', updated);
}

export function getWorkSummaryText(summary: WorkSummary | null): string {
  if (!summary || summary.filesCreated.length === 0) {
    return 'No previous work in this session.';
  }
  
  return `Previous work in this session:
- Files created: ${summary.filesCreated.join(', ')}
- Files modified: ${summary.filesModified.join(', ')}
- Components made: ${summary.componentsMade.join(', ')}
- Last action: ${summary.lastAction}`;
}

// Memory tools array for easy integration
export const memoryTools = [
  getSessionMemoryTool,
  saveSessionMemoryTool,
  searchMemoriesTool,
];
