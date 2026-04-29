import { create } from 'zustand';
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
  // Session
  sessionId: string;
  setSessionId: (id: string) => void;

  // Messages
  messages: ChatMessage[];
  setMessages: (msgs: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  addMessage: (msg: ChatMessage) => void;

  // Input
  message: string;
  setMessage: (msg: string) => void;

  // Streaming
  isStreaming: boolean;
  setIsStreaming: (v: boolean) => void;

  // File tree
  fileTree: FileNode[];
  setFileTree: (tree: FileNode[] | ((prev: FileNode[]) => FileNode[])) => void;

  // Editor
  selectedFile: string;
  setSelectedFile: (file: string) => void;
  openFiles: string[];
  setOpenFiles: (files: string[] | ((prev: string[]) => string[])) => void;
  openFile: (path: string) => void;
  closeFile: (path: string) => void;

  // Sandbox
  sandboxId: string | null;
  setSandboxId: (id: string | null) => void;
  sandboxUrl: string | null;
  setSandboxUrl: (url: string | null) => void;
  sandboxCreatedAt: number | null;
  setSandboxCreatedAt: (ts: number | null) => void;
  isSandboxExpired: boolean;
  setIsSandboxExpired: (v: boolean) => void;

  // UI panels
  activeTab: string;
  setActiveTab: (tab: string) => void;
  showSecondPanel: boolean;
  setShowSecondPanel: (v: boolean) => void;
  mobileActivePanel: MobilePanel;
  setMobileActivePanel: (panel: MobilePanel) => void;

  // Sync status
  isSyncingToE2B: boolean;
  setIsSyncingToE2B: (v: boolean) => void;
  isSyncingFilesystem: boolean;
  setIsSyncingFilesystem: (v: boolean) => void;
  iframeLoading: boolean;
  setIframeLoading: (v: boolean) => void;

  // Collaboration
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

// ─── Default file tree ──────────────────────────────────────────────────────

const DEFAULT_FILE_TREE: FileNode[] = [
  {
    name: 'app',
    path: 'app',
    type: 'folder',
    children: [
      { name: 'page.tsx', path: 'app/page.tsx', type: 'file', content: '// Home page code\n' },
    ],
  },
  {
    name: 'lib',
    path: 'lib',
    type: 'folder',
    children: [
      { name: 'utils.ts', path: 'lib/utils.ts', type: 'file', content: 'export function sum(a, b) { return a + b; }\n' },
    ],
  },
  {
    name: 'components',
    path: 'components',
    type: 'folder',
    children: [
      { name: 'Button.tsx', path: 'components/Button.tsx', type: 'file', content: 'export const Button = () => <button>Click</button>;\n' },
    ],
  },
];

// ─── Store ──────────────────────────────────────────────────────────────────

export const useChatStore = create<ChatStore>((set, get) => ({
  // Session
  sessionId: `session-${Date.now()}`,
  setSessionId: (id) => set({ sessionId: id }),

  // Messages
  messages: [{
    role: 'ai',
    content: "Welcome to CodeVibe! I can help you generate code. Try asking me to 'generate some code' or 'create components' to see live file streaming in action!",
    timestamp: Date.now(),
    id: 'welcome',
  }],
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
  fileTree: DEFAULT_FILE_TREE,
  setFileTree: (tree) => set((state) => ({
    fileTree: typeof tree === 'function' ? tree(state.fileTree) : tree,
  })),

  // Editor
  selectedFile: 'app/page.tsx',
  setSelectedFile: (file) => set({ selectedFile: file }),
  openFiles: ['app/page.tsx'],
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
      ? (newOpen.at(-1) ?? state.selectedFile)
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

  // Collaboration
  connectionStatus: 'disconnected',
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  connectedUsers: [],
  setConnectedUsers: (users) => set({ connectedUsers: users }),

  // File content helpers — stable references that don't depend on component closures
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
    // Auto-show second panel if sandbox exists
    if (data.sandboxId || data.sandboxUrl) patch.showSecondPanel = true;
    return { ...state, ...patch };
  }),
}));

// ─── Selectors (for render optimization) ────────────────────────────────────

export const useFileTree = () => useChatStore((s) => s.fileTree);
export const useSelectedFile = () => useChatStore((s) => s.selectedFile);
export const useOpenFiles = () => useChatStore((s) => s.openFiles);
export const useMessages = () => useChatStore((s) => s.messages);
export const useIsStreaming = () => useChatStore((s) => s.isStreaming);
export const useActiveTab = () => useChatStore((s) => s.activeTab);
export const useSandbox = () => useChatStore((s) => ({
  sandboxId: s.sandboxId,
  sandboxUrl: s.sandboxUrl,
  sandboxCreatedAt: s.sandboxCreatedAt,
  isSandboxExpired: s.isSandboxExpired,
}));
