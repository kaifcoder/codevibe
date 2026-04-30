import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { ChatMessage } from '@/components/ChatPanel';

// ─── Types ──────────────────────────────────────────────────────────────────

export type FileNode = {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileNode[];
  content?: string;
};

type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';
type ConnectedUser = { id: string; name: string; color: string };
type MobilePanel = 'chat' | 'preview' | 'code';

// ─── Store Interface ────────────────────────────────────────────────────────

interface ChatStore {
  // Session (persisted)
  sessionId: string;
  setSessionId: (id: string) => void;
  threadId: string | null;
  setThreadId: (id: string | null) => void;
  runId: string | null;
  setRunId: (id: string | null) => void;

  // Messages (managed by useStream — not persisted, hydrated from LangGraph thread)
  messages: ChatMessage[];
  setMessages: (msgs: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  addMessage: (msg: ChatMessage) => void;

  // Input (transient)
  message: string;
  setMessage: (msg: string) => void;

  // Streaming (transient)
  isStreaming: boolean;
  setIsStreaming: (v: boolean) => void;

  // File tree (persisted)
  fileTree: FileNode[];
  setFileTree: (tree: FileNode[] | ((prev: FileNode[]) => FileNode[])) => void;

  // Editor (persisted)
  selectedFile: string;
  setSelectedFile: (file: string) => void;
  openFiles: string[];
  setOpenFiles: (files: string[] | ((prev: string[]) => string[])) => void;
  openFile: (path: string) => void;
  closeFile: (path: string) => void;

  // Sandbox (persisted)
  sandboxId: string | null;
  setSandboxId: (id: string | null) => void;
  sandboxUrl: string | null;
  setSandboxUrl: (url: string | null) => void;
  sandboxCreatedAt: number | null;
  setSandboxCreatedAt: (ts: number | null) => void;
  isSandboxExpired: boolean;
  setIsSandboxExpired: (v: boolean) => void;

  // UI panels (persisted)
  activeTab: string;
  setActiveTab: (tab: string) => void;
  showSecondPanel: boolean;
  setShowSecondPanel: (v: boolean) => void;
  mobileActivePanel: MobilePanel;
  setMobileActivePanel: (panel: MobilePanel) => void;

  // Sync status (transient)
  isSyncingToE2B: boolean;
  setIsSyncingToE2B: (v: boolean) => void;
  isSyncingFilesystem: boolean;
  setIsSyncingFilesystem: (v: boolean) => void;
  iframeLoading: boolean;
  setIframeLoading: (v: boolean) => void;

  // File streaming (transient)
  streamingFiles: string[];
  addStreamingFile: (path: string) => void;
  removeStreamingFile: (path: string) => void;

  // Collaboration (transient)
  connectionStatus: ConnectionStatus;
  setConnectionStatus: (status: ConnectionStatus) => void;
  connectedUsers: ConnectedUser[];
  setConnectedUsers: (users: ConnectedUser[]) => void;

  // File content helpers
  getFileContent: (path: string) => string;
  updateFileContent: (path: string, content: string) => void;

  // Batch hydration from DB
  hydrate: (data: {
    sessionId?: string;
    messages?: ChatMessage[];
    fileTree?: FileNode[];
    sandboxId?: string | null;
    sandboxUrl?: string | null;
    sandboxCreatedAt?: number | null;
    selectedFile?: string;
    openFiles?: string[];
  }) => void;

  // Reset store to fresh state for a new session
  reset: (sessionId: string) => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function flattenFiles(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = [];
  for (const node of nodes) {
    if (node.type === 'file') files.push(node);
    if (node.type === 'folder' && node.children) files.push(...flattenFiles(node.children));
  }
  return files;
}

function updateNodeContent(nodes: FileNode[], path: string, content: string): FileNode[] {
  return nodes.map(node => {
    if (node.type === 'file' && node.path === path) {
      return { ...node, content };
    }
    if (node.type === 'folder' && node.children) {
      return { ...node, children: updateNodeContent(node.children, path, content) };
    }
    return node;
  });
}

// ─── Store ──────────────────────────────────────────────────────────────────

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      // Session
      sessionId: '',
      setSessionId: (id) => set({ sessionId: id }),
      threadId: null,
      setThreadId: (id) => set({ threadId: id }),
      runId: null,
      setRunId: (id) => set({ runId: id }),

      // Messages (not persisted — comes from LangGraph thread on reconnect)
      messages: [],
      setMessages: (msgs) => set((state) => ({
        messages: typeof msgs === 'function' ? msgs(state.messages) : msgs,
      })),
      addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),

      // Input
      message: '',
      setMessage: (msg) => set({ message: msg }),

      // Streaming
      isStreaming: false,
      setIsStreaming: (v) => set({ isStreaming: v }),

      // File tree
      fileTree: [],
      setFileTree: (tree) => set((state) => ({
        fileTree: typeof tree === 'function' ? tree(state.fileTree) : tree,
      })),

      // Editor
      selectedFile: '',
      setSelectedFile: (file) => set({ selectedFile: file }),
      openFiles: [],
      setOpenFiles: (files) => set((state) => ({
        openFiles: typeof files === 'function' ? files(state.openFiles) : files,
      })),
      openFile: (path) => set((state) => {
        const newOpen = state.openFiles.includes(path) ? state.openFiles : [...state.openFiles, path];
        return { selectedFile: path, openFiles: newOpen };
      }),
      closeFile: (path) => set((state) => {
        const newOpen = state.openFiles.filter(f => f !== path);
        const newSelected = path === state.selectedFile
          ? (newOpen.at(-1) ?? '')
          : state.selectedFile;
        return { openFiles: newOpen, selectedFile: newSelected };
      }),

      // Sandbox
      sandboxId: null,
      setSandboxId: (id) => set({ sandboxId: id }),
      sandboxUrl: null,
      setSandboxUrl: (url) => set({ sandboxUrl: url }),
      sandboxCreatedAt: null,
      setSandboxCreatedAt: (ts) => set({ sandboxCreatedAt: ts }),
      isSandboxExpired: false,
      setIsSandboxExpired: (v) => set({ isSandboxExpired: v }),

      // UI panels
      activeTab: 'live preview',
      setActiveTab: (tab) => set({ activeTab: tab }),
      showSecondPanel: false,
      setShowSecondPanel: (v) => set({ showSecondPanel: v }),
      mobileActivePanel: 'chat',
      setMobileActivePanel: (panel) => set({ mobileActivePanel: panel }),

      // Sync status
      isSyncingToE2B: false,
      setIsSyncingToE2B: (v) => set({ isSyncingToE2B: v }),
      isSyncingFilesystem: false,
      setIsSyncingFilesystem: (v) => set({ isSyncingFilesystem: v }),
      iframeLoading: true,
      setIframeLoading: (v) => set({ iframeLoading: v }),

      // File streaming
      streamingFiles: [],
      addStreamingFile: (path) => set((state) => ({
        streamingFiles: state.streamingFiles.includes(path) ? state.streamingFiles : [...state.streamingFiles, path]
      })),
      removeStreamingFile: (path) => set((state) => ({
        streamingFiles: state.streamingFiles.filter(f => f !== path)
      })),

      // Collaboration
      connectionStatus: 'disconnected',
      setConnectionStatus: (status) => set({ connectionStatus: status }),
      connectedUsers: [],
      setConnectedUsers: (users) => set({ connectedUsers: users }),

      // File content helpers
      getFileContent: (path) => {
        const all = flattenFiles(get().fileTree);
        return all.find(f => f.path === path)?.content ?? '';
      },
      updateFileContent: (path, content) => set((state) => ({
        fileTree: updateNodeContent(state.fileTree, path, content),
      })),

      // Batch hydration
      hydrate: (data) => set((state) => {
        const patch: Partial<ChatStore> = {};
        if (data.sessionId) patch.sessionId = data.sessionId;
        if (data.messages) patch.messages = data.messages;
        if (data.fileTree) patch.fileTree = data.fileTree;
        if (data.sandboxId !== undefined) patch.sandboxId = data.sandboxId;
        if (data.sandboxUrl !== undefined) patch.sandboxUrl = data.sandboxUrl;
        if (data.sandboxCreatedAt !== undefined) patch.sandboxCreatedAt = data.sandboxCreatedAt;
        if (data.selectedFile) patch.selectedFile = data.selectedFile;
        if (data.openFiles) patch.openFiles = data.openFiles;
        if (data.sandboxId || data.sandboxUrl) patch.showSecondPanel = true;
        return { ...state, ...patch };
      }),

      // Reset to fresh state
      reset: (sessionId) => set({
        sessionId,
        threadId: null,
        runId: null,
        messages: [],
        message: '',
        isStreaming: false,
        fileTree: [],
        selectedFile: '',
        openFiles: [],
        sandboxId: null,
        sandboxUrl: null,
        sandboxCreatedAt: null,
        isSandboxExpired: false,
        activeTab: 'live preview',
        showSecondPanel: false,
        mobileActivePanel: 'chat' as MobilePanel,
        isSyncingToE2B: false,
        isSyncingFilesystem: false,
        iframeLoading: true,
        streamingFiles: [],
        connectionStatus: 'disconnected' as ConnectionStatus,
        connectedUsers: [],
      }),
    }),
    {
      name: 'codevibe-session',
      storage: createJSONStorage(() => {
        if (typeof window === 'undefined') {
          // SSR: return a no-op storage
          return {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
          };
        }
        return sessionStorage;
      }),
      partialize: (state) => ({
        sessionId: state.sessionId,
        threadId: state.threadId,
        runId: state.runId,
        fileTree: state.fileTree,
        selectedFile: state.selectedFile,
        openFiles: state.openFiles,
        sandboxId: state.sandboxId,
        sandboxUrl: state.sandboxUrl,
        sandboxCreatedAt: state.sandboxCreatedAt,
        showSecondPanel: state.showSecondPanel,
        activeTab: state.activeTab,
      }),
    }
  )
);
