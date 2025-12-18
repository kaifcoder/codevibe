/**
 * Memory Utilities
 * 
 * Helper functions for managing agent session memory
 */

import { getSessionMemory, saveSessionMemory, clearSessionMemory } from './agent-memory';

/**
 * Initialize a new session with default context
 */
export async function initializeSession(sessionId: string, userId?: string) {
  const context = {
    sessionId,
    userId,
    startedAt: new Date().toISOString(),
    topics: [],
    files: [],
  };

  await saveSessionMemory(sessionId, 'context', context);
  console.log(`✅ Initialized session memory for ${sessionId}`);
}

/**
 * Get or create session context
 */
export async function getOrCreateSessionContext(sessionId: string, userId?: string) {
  let context = await getSessionMemory(sessionId, 'context');
  
  if (!context) {
    await initializeSession(sessionId, userId);
    context = await getSessionMemory(sessionId, 'context');
  }
  
  return context;
}

/**
 * Record a completed task in session memory
 */
export async function recordCompletedTask(sessionId: string, taskDescription: string) {
  const tasks = await getSessionMemory(sessionId, 'tasks') || { completedTasks: [], pendingTasks: [] };
  
  const updatedTasks = {
    ...tasks,
    completedTasks: [...(tasks.completedTasks || []), {
      description: taskDescription,
      completedAt: new Date().toISOString(),
    }],
  };

  await saveSessionMemory(sessionId, 'tasks', updatedTasks);
}

/**
 * Update conversation context with new files or topics
 */
export async function updateConversationContext(
  sessionId: string,
  updates: {
    files?: string[];
    topics?: string[];
    projectContext?: string;
  }
) {
  const context = await getSessionMemory(sessionId, 'context') || { topics: [], files: [] };
  
  const updatedContext = {
    ...context,
    files: updates.files ? [...new Set([...(context.files || []), ...updates.files])] : context.files,
    topics: updates.topics ? [...new Set([...(context.topics || []), ...updates.topics])] : context.topics,
    projectContext: updates.projectContext || context.projectContext,
    lastActivity: new Date().toISOString(),
  };

  await saveSessionMemory(sessionId, 'context', updatedContext);
}

/**
 * Get session summary for display
 */
export async function getSessionSummary(sessionId: string) {
  const preferences = await getSessionMemory(sessionId, 'preferences');
  const context = await getSessionMemory(sessionId, 'context');
  const tasks = await getSessionMemory(sessionId, 'tasks');

  return {
    hasPreferences: !!preferences,
    fileCount: context?.files?.length || 0,
    topicCount: context?.topics?.length || 0,
    completedTaskCount: tasks?.completedTasks?.length || 0,
    lastActivity: context?.lastActivity,
  };
}

/**
 * Clean up old sessions (call periodically)
 */
export async function cleanupOldSessions(sessionIds: string[], maxAgeMs: number = 7 * 24 * 60 * 60 * 1000) {
  const now = Date.now();
  
  for (const sessionId of sessionIds) {
    const context = await getSessionMemory(sessionId, 'context');
    if (context?.lastActivity) {
      const lastActivityTime = new Date(context.lastActivity).getTime();
      if (now - lastActivityTime > maxAgeMs) {
        await clearSessionMemory(sessionId);
        console.log(`🧹 Cleaned up old session: ${sessionId}`);
      }
    }
  }
}

/**
 * Export memory for backup or analysis
 */
export async function exportSessionMemory(sessionId: string) {
  const preferences = await getSessionMemory(sessionId, 'preferences');
  const context = await getSessionMemory(sessionId, 'context');
  const tasks = await getSessionMemory(sessionId, 'tasks');

  return {
    sessionId,
    exportedAt: new Date().toISOString(),
    preferences,
    context,
    tasks,
  };
}
