import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileCode,
  FileJson,
  FileText,
  File,
} from "lucide-react";

export type FileNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileNode[];
};

// Tiny lookup → much cheaper than the original switch on every node render
// because the result is memoizable per file name.
const FILE_ICON_BY_EXT: Record<string, typeof File> = {
  ts: FileCode,
  tsx: FileCode,
  js: FileCode,
  jsx: FileCode,
  json: FileJson,
  md: FileText,
  txt: FileText,
};
function getFileIcon(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase();
  return (ext && FILE_ICON_BY_EXT[ext]) || File;
}

export interface FileTreeProps {
  nodes: FileNode[];
  selected: string;
  onSelect: (path: string) => void;
  streamingFile?: string | null;
}

// Single-level horizontal indent. We pass an absolute pixel count via inline
// style rather than 11 Tailwind classes, so deeply-nested trees keep working
// past depth 10 (the old class map broke at level 11) and a Tailwind JIT
// pass doesn't have to keep all those `pl-[Npx]` arbitrary values alive.
const LEVEL_INDENT_PX = 12;

/**
 * Public component. Wraps a recursive node list and owns the open-folder
 * state. The previous version recursed via `<FileTree />` itself, which
 * re-instantiated state at every level and meant a folder-toggle at depth
 * 4 also re-rendered the root list. Now state lives at the root and rows
 * are a flat memoized list — toggling a folder only re-runs the visible-
 * list memo, and React reconciles via stable keys.
 */
export function FileTree({ nodes, selected, onSelect, streamingFile }: Readonly<FileTreeProps>) {
  // Dedupe + sort once per nodes prop. The old code ran an O(n²) findIndex
  // dedupe on EVERY render. Now it's O(n log n) once per tree change.
  const cleanedNodes = useMemo(() => dedupeAndSort(nodes), [nodes]);

  // All folder paths in the tree, computed once per tree change.
  const allFolderPaths = useMemo(() => collectFolderPaths(cleanedNodes), [cleanedNodes]);

  // Open-state: defaults to "everything expanded". We also automatically
  // expand any NEW folder that appears in the tree after mount (the agent
  // streams files mid-conversation — without this, those folders stayed
  // collapsed unless the user clicked them). We never auto-collapse a
  // folder the user explicitly opened; we just fill in the gaps.
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {};
    for (const p of allFolderPaths) o[p] = true;
    return o;
  });
  const seenFoldersRef = useRef<Set<string>>(new Set(allFolderPaths));
  useEffect(() => {
    let dirty = false;
    const next: Record<string, boolean> = {};
    for (const p of allFolderPaths) {
      if (!seenFoldersRef.current.has(p)) {
        seenFoldersRef.current.add(p);
        next[p] = true;
        dirty = true;
      }
    }
    if (dirty) setOpen((prev) => ({ ...next, ...prev }));
  }, [allFolderPaths]);

  // Whenever a file is selected (or the agent starts streaming into one),
  // open every ancestor folder so the row is actually visible.
  useEffect(() => {
    const target = streamingFile || selected;
    if (!target) return;
    const parts = target.split("/");
    if (parts.length <= 1) return;
    setOpen((prev) => {
      const next = { ...prev };
      let cur = "";
      let dirty = false;
      for (let i = 0; i < parts.length - 1; i++) {
        cur = cur ? `${cur}/${parts[i]}` : parts[i];
        if (!next[cur]) {
          next[cur] = true;
          dirty = true;
        }
      }
      return dirty ? next : prev;
    });
  }, [streamingFile, selected]);

  // Flatten the tree → only the rows currently visible (collapsed folders
  // contribute zero rows). React.memo on FileTreeRow then makes re-renders
  // O(visibleRows) instead of O(allRows), and we get rid of the recursive
  // <FileTree /> remounting problem altogether.
  const visibleRows = useMemo(
    () => flattenVisible(cleanedNodes, open, 0),
    [cleanedNodes, open],
  );

  const toggle = useCallback((path: string) => {
    setOpen((prev) => ({ ...prev, [path]: !prev[path] }));
  }, []);

  return (
    <div className="w-full flex flex-col h-full overflow-y-auto text-sm bg-muted/20">
      {visibleRows.map((row) => (
        <FileTreeRow
          key={row.path}
          row={row}
          isOpen={!!open[row.path]}
          isSelected={selected === row.path}
          isSelectedDescendant={row.type === "folder" && selected.startsWith(`${row.path}/`)}
          isStreaming={streamingFile === row.path}
          onToggle={toggle}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

// ─── helpers ───────────────────────────────────────────────────────────

interface VisibleRow {
  path: string;
  name: string;
  type: "file" | "folder";
  level: number;
}

function dedupeAndSort(nodes: FileNode[]): FileNode[] {
  const seen = new Set<string>();
  const out: FileNode[] = [];
  for (const n of nodes) {
    if (seen.has(n.path)) continue;
    seen.add(n.path);
    out.push(
      n.type === "folder" && n.children
        ? { ...n, children: dedupeAndSort(n.children) }
        : n,
    );
  }
  // Folders first, then alphabetical within each group — matches VS Code,
  // and means newly-streamed files don't visually push folders around.
  out.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out;
}

function collectFolderPaths(nodes: FileNode[]): string[] {
  const out: string[] = [];
  const walk = (list: FileNode[]) => {
    for (const n of list) {
      if (n.type === "folder") {
        out.push(n.path);
        if (n.children) walk(n.children);
      }
    }
  };
  walk(nodes);
  return out;
}

function flattenVisible(
  nodes: FileNode[],
  open: Record<string, boolean>,
  level: number,
): VisibleRow[] {
  const out: VisibleRow[] = [];
  for (const n of nodes) {
    out.push({ path: n.path, name: n.name, type: n.type, level });
    if (n.type === "folder" && open[n.path] && n.children?.length) {
      const child = flattenVisible(n.children, open, level + 1);
      for (const row of child) out.push(row);
    }
  }
  return out;
}

// ─── row component ─────────────────────────────────────────────────────

const FileTreeRow = memo(function FileTreeRow({
  row,
  isOpen,
  isSelected,
  isSelectedDescendant,
  isStreaming,
  onToggle,
  onSelect,
}: {
  row: VisibleRow;
  isOpen: boolean;
  isSelected: boolean;
  isSelectedDescendant: boolean;
  isStreaming: boolean;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  const padStyle = useMemo(
    () => ({ paddingLeft: row.level * LEVEL_INDENT_PX }),
    [row.level],
  );

  if (row.type === "folder") {
    return (
      <button
        type="button"
        style={padStyle}
        onClick={() => onToggle(row.path)}
        aria-expanded={isOpen}
        className={cn(
          "flex items-center gap-1.5 px-2 py-0.5 text-sm cursor-pointer transition w-full hover:bg-accent/50 text-left select-none",
          isSelectedDescendant && "bg-accent/30",
        )}
      >
        {isOpen ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        )}
        {isOpen ? (
          <FolderOpen className="w-4 h-4 text-blue-500 shrink-0" />
        ) : (
          <Folder className="w-4 h-4 text-blue-500 shrink-0" />
        )}
        <span className="font-medium truncate">{row.name}</span>
      </button>
    );
  }

  const Icon = getFileIcon(row.name);
  return (
    <button
      type="button"
      style={padStyle}
      onClick={() => onSelect(row.path)}
      className={cn(
        "flex items-center gap-1.5 text-left px-2 py-0.5 text-sm transition w-full cursor-pointer select-none",
        isSelected
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent/50",
        isStreaming && "bg-blue-500/10 animate-pulse",
      )}
    >
      <div className="w-3.5 h-3.5 shrink-0" />
      <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
      <span className="truncate">{row.name}</span>
      {isStreaming && (
        <div className="ml-auto shrink-0">
          <div className="w-1.5 h-1.5 bg-yellow-500 rounded-full animate-pulse" />
        </div>
      )}
    </button>
  );
});
