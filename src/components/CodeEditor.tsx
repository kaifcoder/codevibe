/* eslint-disable @typescript-eslint/no-unused-vars */
"use client";

import * as monaco from "monaco-editor";
import { useRef, useEffect, useState } from "react";
import MonacoEditor from "@monaco-editor/react";
import { Card } from "./ui/card";
import { useTheme } from "next-themes";
import { initCollaboration } from "@/lib/collaboration/initCollaboration";
import { bindMonaco } from "@/lib/collaboration/bindMonaco";

interface CodeEditorProps {
  value: string;
  onChange: (value: string | undefined) => void;
  language?: string;
  height?: number | string;
  label?: string;
  autoScroll?: boolean;
  collaborative?: boolean;
  roomId?: string;
  username?: string;
  userId?: string;
  onUsersChange?: (users: Array<{ id: string; name: string; color: string }>) => void;
  onConnectionStatusChange?: (status: 'connected' | 'disconnected' | 'connecting') => void;
}

export function CodeEditor({ 
  value, 
  onChange, 
  language = "typescript", 
  label, 
  autoScroll = false,
  collaborative = false,
  roomId,
  username,
  userId,
  onUsersChange,
  onConnectionStatusChange,
}: Readonly<CodeEditorProps>) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const bindingRef = useRef<{ destroy: () => void } | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'connecting'>('disconnected');
  const [activeUsers, setActiveUsers] = useState(0);
  const [editorMounted, setEditorMounted] = useState(false);
  const setupInProgressRef = useRef(false);
  const currentRoomRef = useRef<string>('');
  const { resolvedTheme } = useTheme();

  // Auto-scroll to bottom when content changes and autoScroll is enabled
  useEffect(() => {
    if (autoScroll && editorRef.current) {
      const editor = editorRef.current;
      const model = editor.getModel();
      if (model) {
        const lineCount = model.getLineCount();
        editor.revealLine(lineCount);
        editor.setPosition({ lineNumber: lineCount, column: model.getLineMaxColumn(lineCount) });
      }
    }
  }, [value, autoScroll]);

  // Setup Yjs collaborative editing
  useEffect(() => {
    console.log('[CodeEditor] Effect triggered - collaborative:', collaborative, 'roomId:', roomId, 'editorMounted:', editorMounted, 'editor:', !!editorRef.current);
    
    if (!collaborative || !roomId || !editorMounted || !editorRef.current) {
      console.log('[CodeEditor] Skipping collaborative setup - missing requirements');
      return;
    }

    // Prevent duplicate setup for the same room
    if (setupInProgressRef.current && currentRoomRef.current === roomId) {
      console.log('[CodeEditor] Setup already in progress for this room, skipping...');
      return;
    }

    console.log('[CodeEditor] Starting collaborative setup for room:', roomId);
    setupInProgressRef.current = true;
    currentRoomRef.current = roomId;
    setConnectionStatus('connecting');
    if (onConnectionStatusChange) {
      onConnectionStatusChange('connecting');
    }
    
    const editor = editorRef.current;
    const model = editor.getModel();
    
    if (!model) {
      setupInProgressRef.current = false;
      return;
    }

    try {
      // Step 1: Initialize collaboration infrastructure
      const { yText, provider } = initCollaboration({
        roomId,
        username,
        userId,
      });

      console.log('[CodeEditor] Collaboration initialized for room:', roomId);
      console.log('[CodeEditor] Initial state - Value length:', value?.length || 0, 'Yjs length:', yText.length, 'Provider synced:', provider.synced);
      
      // Wait for provider to sync before setting content
      const handleSync = () => {
        const yjsContent = yText.toJSON();
        console.log('[CodeEditor] Provider synced - Yjs length:', yText.length, 'Value length:', value?.length || 0);
        
        if (yText.length === 0) {
          // Empty Yjs document - initialize with value from props
          if (value && value.length > 0) {
            console.log('[CodeEditor] Initializing empty Yjs document with content from props');
            yText.insert(0, value);
            onChange(value); // Notify parent immediately
          }
        } else {
          // Yjs document has content - this is the source of truth
          console.log('[CodeEditor] Using existing Yjs content as source of truth');
          if (model.getValue() !== yjsContent) {
            model.setValue(yjsContent);
          }
          // Always notify parent of current Yjs content
          onChange(yjsContent);
        }
      };

      if (provider.synced) {
        console.log('[CodeEditor] Provider already synced, applying content immediately');
        handleSync();
      } else {
        console.log('[CodeEditor] Waiting for provider to sync...');
        const onSynced = () => {
          handleSync();
          provider.off('synced', onSynced);
        };
        provider.on('synced', onSynced);
      }

      // Step 2: Bind Monaco to Yjs (handles text sync + selection highlights)
      bindMonaco({
        editor,
        yText,
        awareness: provider.awareness,
      }).then((binding) => {
        bindingRef.current = binding;
        console.log('[CodeEditor] Monaco binding created - remote selections will appear when users select text');
      });

      // Handle connection status
      provider.on('status', (event: { status: string }) => {
        console.log('[CodeEditor] Connection status:', event.status);
        const newStatus = event.status === 'connected' ? 'connected' : 'disconnected';
        setConnectionStatus(newStatus);
        if (onConnectionStatusChange) {
          onConnectionStatusChange(newStatus);
        }
      });

      provider.on('connection-error', (error: Error) => {
        console.error('[CodeEditor] Connection error:', error);
        setConnectionStatus('disconnected');
        if (onConnectionStatusChange) {
          onConnectionStatusChange('disconnected');
        }
      });

      // Track active users with debouncing to prevent excessive updates
      let updateTimeout: NodeJS.Timeout | null = null;
      const updateActiveUsers = () => {
        if (updateTimeout) {
          clearTimeout(updateTimeout);
        }
        updateTimeout = setTimeout(() => {
          if (provider.awareness) {
            const localClientId = provider.awareness.clientID;
            const userCount = provider.awareness.getStates().size;
            console.log('[CodeEditor] Active users:', userCount);
            setActiveUsers(userCount);
            
            // Extract user info for parent component
            if (onUsersChange) {
              const users: Array<{ id: string; name: string; color: string }> = [];
              provider.awareness.getStates().forEach((state: unknown, clientId: number) => {
                if (clientId === localClientId) return; // Skip local user
                const userState = state as { user?: { name?: string; color?: string } };
                if (userState.user?.name) {
                  users.push({
                    id: String(clientId),
                    name: userState.user.name,
                    color: userState.user.color || '#FF6B6B',
                  });
                }
              });
              onUsersChange(users);
            }
          }
        }, 300); // Debounce for 300ms
      };

      if (provider.awareness) {
        provider.awareness.on('change', updateActiveUsers);
        updateActiveUsers();
      }

      // Sync changes back to parent component with debouncing
      let changeTimeout: NodeJS.Timeout | null = null;
      yText.observe(() => {
        // Debounce onChange calls to reduce re-renders
        if (changeTimeout) {
          clearTimeout(changeTimeout);
        }
        changeTimeout = setTimeout(() => {
          const textContent = yText.toJSON();
          console.log('[CodeEditor] Yjs content changed, notifying parent. Length:', textContent.length);
          onChange(textContent);
        }, 200); // Wait 200ms after last change
      });

      setConnectionStatus('connected');
      if (onConnectionStatusChange) {
        onConnectionStatusChange('connected');
      }

      // Cleanup on unmount or when roomId changes
      return () => {
        console.log('[CodeEditor] Cleaning up collaborative editing for room:', roomId);
        
        if (updateTimeout) clearTimeout(updateTimeout);
        if (changeTimeout) clearTimeout(changeTimeout);
        
        if (bindingRef.current) {
          console.log('[CodeEditor] Destroying binding...');
          bindingRef.current.destroy();
          bindingRef.current = null;
        }
        
        if (provider) {
          console.log('[CodeEditor] Disconnecting provider...');
          provider.disconnect();
          provider.destroy();
        }
        
        setupInProgressRef.current = false;
        setConnectionStatus('disconnected');
        if (onConnectionStatusChange) {
          onConnectionStatusChange('disconnected');
        }
      };
    } catch (error) {
      console.error('[Yjs] Failed to setup collaborative editing:', error);
      setupInProgressRef.current = false;
      setConnectionStatus('disconnected');
      if (onConnectionStatusChange) {
        onConnectionStatusChange('disconnected');
      }
    }
    // Only re-run when roomId or collaborative flag changes, not on every prop update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collaborative, roomId, editorMounted]);

  const handleEditorDidMount = (editor: monaco.editor.IStandaloneCodeEditor) => {
    console.log('[CodeEditor] Editor mounted, collaborative:', collaborative, 'roomId:', roomId);
    editorRef.current = editor;
    setEditorMounted(true);
  };
  
  // Update editor read-only state dynamically when agentEditing changes
  useEffect(() => {
    if (editorRef.current && collaborative) {
      // In collaborative mode, only disable editing when not connected
      editorRef.current.updateOptions({
        readOnly: connectionStatus !== 'connected',
      });
    }
  }, [collaborative, connectionStatus]);
  return (
    <Card className="w-full h-full flex-1 flex flex-col p-0 overflow-hidden border-0 shadow-none rounded-none">
      {label && (
        <div className="flex items-center justify-between px-3 py-1.5 border-b text-xs bg-muted/30">
          <div className="flex items-center gap-2">
            <span className="font-medium text-muted-foreground">{label}</span>
          </div>
          {collaborative && (
            <div className="flex items-center gap-1.5">
              <div className="flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${
                  connectionStatus === 'connected' ? 'bg-green-500' : 
                  connectionStatus === 'connecting' ? 'bg-yellow-500 animate-pulse' : 
                  'bg-gray-400'
                }`} />
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  {connectionStatus === 'connected' ? 'Live' : connectionStatus}
                </span>
              </div>
              {connectionStatus === 'connected' && activeUsers > 0 && (
                <span className="text-[10px] text-muted-foreground">
                  • {activeUsers} {activeUsers === 1 ? 'user' : 'users'}
                </span>
              )}
            </div>
          )}
        </div>
      )}
      <div className="flex-1 h-full">
        <MonacoEditor
          value={collaborative ? undefined : value}
          onChange={collaborative ? undefined : onChange}
          language={language}
          height="100%"
          theme={resolvedTheme === 'dark' ? 'vs-dark' : 'light'}
          onMount={handleEditorDidMount}
          options={{
            fontSize: 14,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: "on",
            automaticLayout: true,
            readOnly: collaborative ? connectionStatus !== 'connected' : false,
            cursorStyle: 'line',
          }}
        />
      </div>
    </Card>
  );
}
