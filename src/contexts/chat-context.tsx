"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useUser } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";

export type FileNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileNode[];
  content?: string;
};

export type ConnectionStatus = "connected" | "connecting" | "disconnected";
export type ConnectedUser = { id: string; name: string; color: string };
export type MobilePanel = "chat" | "preview" | "code";
export type TemplateType = "nextjs" | "n8n" | "chat";

const DISPLAY_NAME_STORAGE_KEY = "codevibe.guestDisplayName";

interface ChatContextValue {
  sessionId: string;

  // Identity used for Yjs awareness ("who is in the room"). Comes from Clerk
  // when signed in, otherwise localStorage, otherwise null until the visitor
  // is prompted.
  displayName: string | null;
  setDisplayName: (name: string) => void;
  isClerkAuthed: boolean;
  // False until Clerk has finished hydrating. Consumers should wait on this
  // before branching on isClerkAuthed to avoid a flash of the unauthed UI.
  isAuthLoaded: boolean;

  // Share-link credential for collaborators. Null for the owner. When set,
  // the client appends it to write endpoints so the server can re-authorize.
  shareToken: string | null;

  // LangGraph thread / run identifiers (mirrored from useStream callbacks)
  threadId: string | null;
  setThreadId: Dispatch<SetStateAction<string | null>>;
  runId: string | null;
  setRunId: Dispatch<SetStateAction<string | null>>;

  // File tree
  fileTree: FileNode[];
  setFileTree: Dispatch<SetStateAction<FileNode[]>>;
  getFileContent: (path: string) => string;
  updateFileContent: (path: string, content: string) => void;

  // Editor
  selectedFile: string;
  setSelectedFile: Dispatch<SetStateAction<string>>;
  openFiles: string[];
  setOpenFiles: Dispatch<SetStateAction<string[]>>;

  // Sandbox
  sandboxId: string | null;
  setSandboxId: Dispatch<SetStateAction<string | null>>;
  sandboxUrl: string | null;
  setSandboxUrl: Dispatch<SetStateAction<string | null>>;
  sandboxCreatedAt: number | null;
  setSandboxCreatedAt: Dispatch<SetStateAction<number | null>>;
  isSandboxExpired: boolean;
  setIsSandboxExpired: Dispatch<SetStateAction<boolean>>;

  // GitHub link — set after the user creates / pushes / imports. When set,
  // the GitHub button switches from "Connect" to "Push commit".
  githubRepo: string | null;
  setGithubRepo: Dispatch<SetStateAction<string | null>>;
  githubBranch: string | null;
  setGithubBranch: Dispatch<SetStateAction<string | null>>;

  // Template (set by HITL classification on first prompt)
  templateType: TemplateType;
  setTemplateType: Dispatch<SetStateAction<TemplateType>>;
  templateDecided: boolean;
  setTemplateDecided: Dispatch<SetStateAction<boolean>>;

  // n8n: latest imported workflow id — iframe deep-links to /workflow/<id>
  // when set so the user lands on the workflow the agent just built.
  n8nWorkflowId: string | null;
  setN8nWorkflowId: Dispatch<SetStateAction<string | null>>;

  // UI panels
  activeTab: string;
  setActiveTab: Dispatch<SetStateAction<string>>;
  showSecondPanel: boolean;
  setShowSecondPanel: Dispatch<SetStateAction<boolean>>;
  mobileActivePanel: MobilePanel;
  setMobileActivePanel: Dispatch<SetStateAction<MobilePanel>>;

  // Sync status
  isSyncingToE2B: boolean;
  setIsSyncingToE2B: Dispatch<SetStateAction<boolean>>;
  isSyncingFilesystem: boolean;
  setIsSyncingFilesystem: Dispatch<SetStateAction<boolean>>;
  iframeLoading: boolean;
  setIframeLoading: Dispatch<SetStateAction<boolean>>;

  // Collaboration
  connectionStatus: ConnectionStatus;
  setConnectionStatus: Dispatch<SetStateAction<ConnectionStatus>>;
  connectedUsers: ConnectedUser[];
  setConnectedUsers: Dispatch<SetStateAction<ConnectedUser[]>>;

  // Token usage / cost tracking — populated by the `tokenUsage` custom event
  // emitted from usageTrackingMiddleware on every model call. Per-thread
  // running totals; resets when the agent server restarts. Shown in the dev
  // UI; persist to DB later if you want durable per-session totals.
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    threadCalls: number;
    threadTotalUsd: number;
  };
  setTokenUsage: Dispatch<SetStateAction<{
    inputTokens: number;
    outputTokens: number;
    threadCalls: number;
    threadTotalUsd: number;
  }>>;

  // n8n build canvas state — drives the custom React Flow canvas that shows
  // the agent's workflow being assembled before the n8n iframe loads. Phase
  // transitions:
  //   idle      — no n8n activity yet
  //   exploring — agent has called get_node on at least one node type;
  //               canvas shows pulsing placeholders
  //   drafting  — agent has written workflow.json; canvas shows the canonical
  //               workflow with positioned nodes and connections
  //   finalized — `workflowReady` fired; iframe takes over
  n8nBuildState: {
    phase: "idle" | "exploring" | "drafting" | "finalized";
    exploredNodeTypes: string[];
    draft: {
      name: string;
      nodes: Array<{
        id?: string;
        name: string;
        type: string;
        typeVersion?: number;
        position: [number, number];
      }>;
      connections: Record<string, {
        main?: Array<Array<{ node: string; type: string; index: number }>>;
      }>;
    } | null;
  };
  setN8nBuildState: Dispatch<SetStateAction<{
    phase: "idle" | "exploring" | "drafting" | "finalized";
    exploredNodeTypes: string[];
    draft: {
      name: string;
      nodes: Array<{
        id?: string;
        name: string;
        type: string;
        typeVersion?: number;
        position: [number, number];
      }>;
      connections: Record<string, {
        main?: Array<Array<{ node: string; type: string; index: number }>>;
      }>;
    } | null;
  }>>;
}

const ChatContext = createContext<ChatContextValue | null>(null);

function flattenFiles(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = [];
  for (const node of nodes) {
    if (node.type === "file") files.push(node);
    if (node.type === "folder" && node.children) files.push(...flattenFiles(node.children));
  }
  return files;
}

function updateNodeContent(nodes: FileNode[], path: string, content: string): FileNode[] {
  return nodes.map((node) => {
    if (node.type === "file" && node.path === path) {
      return { ...node, content };
    }
    if (node.type === "folder" && node.children) {
      return { ...node, children: updateNodeContent(node.children, path, content) };
    }
    return node;
  });
}

export function ChatProvider({
  sessionId,
  children,
}: {
  sessionId: string;
  children: ReactNode;
}) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);

  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>("");
  const [openFiles, setOpenFiles] = useState<string[]>([]);

  const [sandboxId, setSandboxId] = useState<string | null>(null);
  const [sandboxUrl, setSandboxUrl] = useState<string | null>(null);
  const [sandboxCreatedAt, setSandboxCreatedAt] = useState<number | null>(null);
  const [isSandboxExpired, setIsSandboxExpired] = useState(false);
  const [githubRepo, setGithubRepo] = useState<string | null>(null);
  const [githubBranch, setGithubBranch] = useState<string | null>(null);

  const [templateType, setTemplateType] = useState<TemplateType>("nextjs");
  const [templateDecided, setTemplateDecided] = useState(false);
  const [n8nWorkflowId, setN8nWorkflowId] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<string>("live preview");
  const [showSecondPanel, setShowSecondPanel] = useState(false);
  const [mobileActivePanel, setMobileActivePanel] = useState<MobilePanel>("chat");

  const [isSyncingToE2B, setIsSyncingToE2B] = useState(false);
  const [isSyncingFilesystem, setIsSyncingFilesystem] = useState(false);
  const [iframeLoading, setIframeLoading] = useState(true);

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected");
  const [connectedUsers, setConnectedUsers] = useState<ConnectedUser[]>([]);
  const [tokenUsage, setTokenUsage] = useState({
    inputTokens: 0,
    outputTokens: 0,
    threadCalls: 0,
    threadTotalUsd: 0,
  });
  const [n8nBuildState, setN8nBuildState] = useState<{
    phase: "idle" | "exploring" | "drafting" | "finalized";
    exploredNodeTypes: string[];
    draft: {
      name: string;
      nodes: Array<{
        id?: string;
        name: string;
        type: string;
        typeVersion?: number;
        position: [number, number];
      }>;
      connections: Record<string, {
        main?: Array<Array<{ node: string; type: string; index: number }>>;
      }>;
    } | null;
  }>({
    phase: "idle",
    exploredNodeTypes: [],
    draft: null,
  });

  const { isSignedIn, isLoaded, user } = useUser();
  const searchParams = useSearchParams();
  const shareToken = searchParams?.get("token") ?? null;
  const clerkName = isSignedIn
    ? user?.fullName || user?.firstName || user?.username || user?.primaryEmailAddress?.emailAddress || null
    : null;

  const [displayName, setDisplayNameState] = useState<string | null>(() => {
    if (clerkName) return clerkName;
    if (typeof globalThis !== "undefined" && "localStorage" in globalThis) {
      try {
        return globalThis.localStorage.getItem(DISPLAY_NAME_STORAGE_KEY);
      } catch {
        return null;
      }
    }
    return null;
  });

  // Once Clerk hydrates, prefer the authenticated name over any cached guest name.
  useEffect(() => {
    if (clerkName && displayName !== clerkName) {
      setDisplayNameState(clerkName);
    }
  }, [clerkName, displayName]);

  const setDisplayName = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setDisplayNameState(trimmed);
    try {
      globalThis.localStorage?.setItem(DISPLAY_NAME_STORAGE_KEY, trimmed);
    } catch {
      // ignore quota / private-mode errors
    }
  }, []);

  const getFileContent = useCallback(
    (path: string) => flattenFiles(fileTree).find((f) => f.path === path)?.content ?? "",
    [fileTree],
  );

  const updateFileContent = useCallback((path: string, content: string) => {
    setFileTree((prev) => updateNodeContent(prev, path, content));
  }, []);

  const value: ChatContextValue = {
    sessionId,
    displayName,
    setDisplayName,
    isClerkAuthed: !!isSignedIn,
    isAuthLoaded: !!isLoaded,
    shareToken,
    threadId,
    setThreadId,
    runId,
    setRunId,
    fileTree,
    setFileTree,
    getFileContent,
    updateFileContent,
    selectedFile,
    setSelectedFile,
    openFiles,
    setOpenFiles,
    sandboxId,
    setSandboxId,
    sandboxUrl,
    setSandboxUrl,
    sandboxCreatedAt,
    setSandboxCreatedAt,
    isSandboxExpired,
    setIsSandboxExpired,
    githubRepo,
    setGithubRepo,
    githubBranch,
    setGithubBranch,
    templateType,
    setTemplateType,
    templateDecided,
    setTemplateDecided,
    n8nWorkflowId,
    setN8nWorkflowId,
    activeTab,
    setActiveTab,
    showSecondPanel,
    setShowSecondPanel,
    mobileActivePanel,
    setMobileActivePanel,
    isSyncingToE2B,
    setIsSyncingToE2B,
    isSyncingFilesystem,
    setIsSyncingFilesystem,
    iframeLoading,
    setIframeLoading,
    connectionStatus,
    setConnectionStatus,
    connectedUsers,
    setConnectedUsers,
    tokenUsage,
    setTokenUsage,
    n8nBuildState,
    setN8nBuildState,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within a ChatProvider");
  return ctx;
}
