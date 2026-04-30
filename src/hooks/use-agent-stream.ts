"use client";

import { useStream } from "@langchain/langgraph-sdk/react";
import { useCallback, useEffect, useRef } from "react";
import { useChatStore } from "@/stores/chat-store";
import type { FileNode } from "@/stores/chat-store";

const AGENT_URL = process.env.NEXT_PUBLIC_LANGGRAPH_URL || "http://localhost:2024";

// Custom event types emitted via config.writer() from the agent
interface CodePatchEvent {
  type: 'codePatch';
  filePath: string;
  content?: string;
  action: 'streaming_start' | 'streaming_chunk' | 'streaming_end';
}

interface FileTreeSyncEvent {
  type: 'fileTreeSync';
  fileTree: FileNode[];
}

interface SandboxCreatedEvent {
  type: 'sandboxCreated';
  sandboxId: string;
  sandboxUrl: string;
  isNew: boolean;
}

interface SandboxExpiredEvent {
  type: 'sandboxExpired';
  sandboxId: string;
}

interface ToolProgressEvent {
  type: 'tool_progress';
  tool: string;
  args?: Record<string, unknown>;
  message: string;
  status: string;
}

interface ToolResultEvent {
  type: 'tool_result';
  tool: string;
  args?: Record<string, unknown>;
  result: string;
}

type CustomEvent =
  | CodePatchEvent
  | FileTreeSyncEvent
  | SandboxCreatedEvent
  | SandboxExpiredEvent
  | ToolProgressEvent
  | ToolResultEvent;

function findFileInTree(nodes: FileNode[], path: string): boolean {
  for (const node of nodes) {
    if (node.type === 'file' && node.path === path) return true;
    if (node.type === 'folder' && node.children && findFileInTree(node.children, path)) return true;
  }
  return false;
}

function addFileToTree(nodes: FileNode[], filePath: string, content: string): FileNode[] {
  const segments = filePath.split('/');
  if (segments.length === 1) {
    // Check if file already exists at this level
    if (nodes.some(n => n.type === 'file' && n.name === segments[0])) {
      return nodes.map(n =>
        n.type === 'file' && n.name === segments[0] ? { ...n, content } : n
      );
    }
    return [...nodes, { name: segments[0], path: filePath, type: 'file' as const, content }];
  }

  const folderName = segments[0];
  const remainingPath = segments.slice(1).join('/');
  const existing = nodes.find(n => n.type === 'folder' && n.name === folderName);

  if (existing && existing.children) {
    return nodes.map(n => {
      if (n === existing) {
        return { ...n, children: addFileToTree(n.children!, remainingPath, content) };
      }
      return n;
    });
  }

  const folderPath = segments.slice(0, segments.length - 1).join('/');
  const newFolder: FileNode = {
    name: folderName,
    path: folderPath.includes('/') ? folderPath : folderName,
    type: 'folder',
    children: addFileToTree([], remainingPath, content),
  };
  return [...nodes, newFolder];
}

function updateFileInTree(nodes: FileNode[], path: string, updater: (existing: string | undefined) => string): FileNode[] {
  return nodes.map(node => {
    if (node.type === 'file' && node.path === path) {
      return { ...node, content: updater(node.content) };
    }
    if (node.type === 'folder' && node.children) {
      return { ...node, children: updateFileInTree(node.children, path, updater) };
    }
    return node;
  });
}

export function useAgentStream(threadId: string | null) {
  const lastSavedContentRef = useRef<Record<string, string>>({});

  const handleCustomEvent = useCallback((event: CustomEvent) => {
    const store = useChatStore.getState();

    switch (event.type) {
      case 'sandboxCreated': {
        store.setSandboxId(event.sandboxId);
        store.setSandboxUrl(event.sandboxUrl);
        store.setShowSecondPanel(true);
        store.setSandboxCreatedAt(Date.now());
        store.setIsSandboxExpired(false);
        store.setActiveTab('live preview');
        store.setIframeLoading(true);
        break;
      }

      case 'sandboxExpired': {
        store.setIsSandboxExpired(true);
        break;
      }

      case 'fileTreeSync': {
        if (event.fileTree && Array.isArray(event.fileTree)) {
          store.setFileTree(event.fileTree);
          const firstFile = findFirstFile(event.fileTree);
          if (firstFile && !store.selectedFile) {
            store.setSelectedFile(firstFile);
            store.setOpenFiles([firstFile]);
          }
        }
        break;
      }

      case 'codePatch': {
        const { filePath, content, action } = event;
        if (!filePath) break;

        if (action === 'streaming_start') {
          store.addStreamingFile(filePath);
          store.setSelectedFile(filePath);
          const currentOpen = store.openFiles;
          if (!currentOpen.includes(filePath)) {
            store.setOpenFiles([...currentOpen, filePath]);
          }
          store.setFileTree(prev => {
            if (!findFileInTree(prev, filePath)) {
              return addFileToTree(prev, filePath, '');
            }
            return prev;
          });
        } else if (action === 'streaming_chunk') {
          if (content) {
            store.setFileTree(prev =>
              updateFileInTree(prev, filePath, () => content)
            );
          }
        } else if (action === 'streaming_end') {
          store.removeStreamingFile(filePath);
          if (content) {
            lastSavedContentRef.current[filePath] = content;
            store.setFileTree(prev => {
              if (!findFileInTree(prev, filePath)) {
                return addFileToTree(prev, filePath, content);
              }
              return updateFileInTree(prev, filePath, () => content);
            });
            // Sync to Yjs
            import('@/lib/collaboration').then(({ updateYjsDocument }) => {
              const sessionId = useChatStore.getState().sessionId;
              const roomId = `${sessionId}-${filePath}`;
              updateYjsDocument(roomId, content).catch((err: Error) => {
                console.error('[Agent] Failed to update Yjs:', err);
              });
            });
          }
        }
        break;
      }

      case 'tool_progress':
      case 'tool_result':
        // These are handled natively by useStream's toolCalls/toolProgress
        break;
    }
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream = useStream({
    apiUrl: AGENT_URL,
    assistantId: "agent",
    threadId: threadId ?? undefined,
    onThreadId: (id: string) => {
      useChatStore.getState().setThreadId(id);
    },
    onCustomEvent: (data: unknown) => {
      handleCustomEvent(data as CustomEvent);
    },
    onCreated: (run: { run_id: string }) => {
      useChatStore.getState().setRunId(run.run_id);
    },
    onFinish: () => {
      useChatStore.getState().setRunId(null);
    },
    onError: (error: unknown) => {
      console.error('[useStream] Error:', error);
    },
  } as any) as any;

  // Sync isStreaming state to the store
  useEffect(() => {
    useChatStore.getState().setIsStreaming(stream.isLoading);
  }, [stream.isLoading]);

  // Attempt to rejoin a running stream on mount (page refresh)
  const rejoinAttemptedRef = useRef(false);
  useEffect(() => {
    if (rejoinAttemptedRef.current) return;
    rejoinAttemptedRef.current = true;

    const { runId } = useChatStore.getState();
    if (runId && stream.joinStream) {
      stream.joinStream(runId);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-rejoin when tab becomes visible (Page Visibility API)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      const { runId } = useChatStore.getState();
      if (runId && !stream.isLoading && stream.joinStream) {
        stream.joinStream(runId);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [stream]);

  return stream;
}

function findFirstFile(nodes: FileNode[]): string | null {
  for (const node of nodes) {
    if (node.type === 'file') return node.path;
    if (node.type === 'folder' && node.children) {
      const found = findFirstFile(node.children);
      if (found) return found;
    }
  }
  return null;
}
