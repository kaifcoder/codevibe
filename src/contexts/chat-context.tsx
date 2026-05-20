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

const DISPLAY_NAME_STORAGE_KEY = "codevibe.guestDisplayName";

interface ChatContextValue {
  sessionId: string;

  // Identity used for Yjs awareness ("who is in the room"). Comes from Clerk
  // when signed in, otherwise localStorage, otherwise null until the visitor
  // is prompted.
  displayName: string | null;
  setDisplayName: (name: string) => void;
  isClerkAuthed: boolean;

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

  const [activeTab, setActiveTab] = useState<string>("live preview");
  const [showSecondPanel, setShowSecondPanel] = useState(false);
  const [mobileActivePanel, setMobileActivePanel] = useState<MobilePanel>("chat");

  const [isSyncingToE2B, setIsSyncingToE2B] = useState(false);
  const [isSyncingFilesystem, setIsSyncingFilesystem] = useState(false);
  const [iframeLoading, setIframeLoading] = useState(true);

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected");
  const [connectedUsers, setConnectedUsers] = useState<ConnectedUser[]>([]);

  const { isSignedIn, user } = useUser();
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
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within a ChatProvider");
  return ctx;
}
