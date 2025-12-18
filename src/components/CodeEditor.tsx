/* eslint-disable @typescript-eslint/no-unused-vars */
"use client";

import * as monaco from "monaco-editor";
import { useRef, useEffect, useState } from "react";
import MonacoEditor from "@monaco-editor/react";
import { Card } from "./ui/card";
import { Label } from "./ui/label";
import { Badge } from "./ui/badge";
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
}

export function CodeEditor({ 
  value, 
  onChange, 
  language = "typescript", 
  height = 300, 
  label, 
  autoScroll = false,
  collaborative = false,
  roomId,
  username,
  userId,
  onUsersChange,
}: Readonly<CodeEditorProps>) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const bindingRef = useRef<{ destroy: () => void } | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'connecting'>('disconnected');
  const [activeUsers, setActiveUsers] = useState(0);
  const [editorMounted, setEditorMounted] = useState(false);
  const setupInProgressRef = useRef(false);

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

    // Prevent duplicate setup
    if (setupInProgressRef.current) {
      console.log('[CodeEditor] Setup already in progress, skipping...');
      return;
    }

    console.log('[CodeEditor] Starting collaborative setup...');
    setupInProgressRef.current = true;
    setConnectionStatus('connecting');
    
    const editor = editorRef.current;
    const model = editor.getModel();
    
    if (!model) {
      return;
    }

    try {
      console.log('[CodeEditor] Initializing collaboration for room:', roomId);
      
      // Step 1: Initialize collaboration infrastructure
      const { yText, provider } = initCollaboration({
        roomId,
        username,
        userId,
      });

      console.log('[CodeEditor] Collaboration initialized, awaiting sync...');
      
      // Set initial content after sync
      let initialContentSet = false;
      const setSyncedContent = () => {
        if (!initialContentSet && yText.length === 0 && value) {
          console.log('[CodeEditor] Setting initial content');
          yText.insert(0, value);
          initialContentSet = true;
        }
      };

      if (provider.synced) {
        setSyncedContent();
      } else {
        const onSynced = () => {
          setSyncedContent();
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
        setConnectionStatus(event.status === 'connected' ? 'connected' : 'disconnected');
      });

      provider.on('connection-error', (error: Error) => {
        console.error('[CodeEditor] Connection error:', error);
        setConnectionStatus('disconnected');
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
          onChange(textContent);
        }, 200); // Wait 200ms after last change
      });

      setConnectionStatus('connected');

      // Cleanup on unmount
      return () => {
        console.log('[CodeEditor] Cleaning up collaborative editing...');
        
        if (updateTimeout) clearTimeout(updateTimeout);
        if (changeTimeout) clearTimeout(changeTimeout);
        
        if (bindingRef.current) {
          bindingRef.current.destroy();
          bindingRef.current = null;
        }
        
        setupInProgressRef.current = false;
        setConnectionStatus('disconnected');
      };
    } catch (error) {
      console.error('[Yjs] Failed to setup collaborative editing:', error);
      setupInProgressRef.current = false;
      setConnectionStatus('disconnected');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collaborative, roomId, username, userId, editorMounted]);

  const handleEditorDidMount = (editor: monaco.editor.IStandaloneCodeEditor) => {
    console.log('[CodeEditor] Editor mounted, collaborative:', collaborative, 'roomId:', roomId);
    editorRef.current = editor;
    setEditorMounted(true);
  };
  return (
    <Card className="w-full h-full flex-1 flex flex-col p-0 overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        {label && <Label className="block">{label}</Label>}
        {collaborative && (
          <div className="flex items-center gap-2">
            <Badge 
              variant={connectionStatus === 'connected' ? 'default' : 'secondary'}
              className="text-xs"
            >
              {connectionStatus === 'connected' && (
                <span className="w-2 h-2 rounded-full bg-green-500 mr-1.5 animate-pulse" />
              )}
              {connectionStatus === 'connecting' && (
                <span className="w-2 h-2 rounded-full bg-yellow-500 mr-1.5 animate-pulse" />
              )}
              {connectionStatus === 'disconnected' && (
                <span className="w-2 h-2 rounded-full bg-gray-500 mr-1.5" />
              )}
              {connectionStatus}
            </Badge>
            {connectionStatus === 'connected' && activeUsers > 0 && (
              <Badge variant="outline" className="text-xs">
                {activeUsers} {activeUsers === 1 ? 'user' : 'users'}
              </Badge>
            )}
          </div>
        )}
      </div>
      <div className="flex-1 h-full">
        <MonacoEditor
          value={collaborative ? undefined : value}
          onChange={collaborative ? undefined : onChange}
          language={language}
          height="100%"
          theme="vs-dark"
          onMount={handleEditorDidMount}
          options={{
            fontSize: 14,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: "on",
            automaticLayout: true,
            readOnly: collaborative && connectionStatus !== 'connected',
          }}
        />
      </div>
    </Card>
  );
}
