import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { FolderIcon, FileIcon } from "lucide-react";

export type FileNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileNode[];
};

export interface FileTreeProps {
  nodes: FileNode[];
  selected: string;
  onSelect: (path: string) => void;
  level?: number;
  streamingFile?: string | null;
}

export function FileTree({ nodes, selected, onSelect, level = 0, streamingFile }: Readonly<FileTreeProps>) {
  // Initialize with all folders expanded by default
  const [open, setOpen] = useState<{ [key: string]: boolean }>(() => {
    const initialOpen: { [key: string]: boolean } = {};
    
    const expandAllFolders = (nodeList: FileNode[]) => {
      nodeList.forEach(node => {
        if (node.type === "folder") {
          initialOpen[node.path] = true;
          if (node.children) {
            expandAllFolders(node.children);
          }
        }
      });
    };
    
    expandAllFolders(nodes);
    return initialOpen;
  });

  // Auto-expand folders when streaming starts or when a file inside is selected
  useEffect(() => {
    if (streamingFile || selected) {
      const targetPath = streamingFile || selected;
      const pathParts = targetPath.split('/');
      
      // Build folder paths that need to be opened
      const foldersToOpen: { [key: string]: boolean } = {};
      let currentPath = '';
      
      for (let i = 0; i < pathParts.length - 1; i++) {
        currentPath += (currentPath ? '/' : '') + pathParts[i];
        foldersToOpen[currentPath] = true;
      }
      
      setOpen(prev => ({ ...prev, ...foldersToOpen }));
    }
  }, [streamingFile, selected]);

  return (
    <div className="w-full flex flex-col gap-0.5 h-full overflow-y-auto">
      {nodes.map((node) => (
        <div key={node.path} className="select-none flex">
          {/* Indentation lines */}
          {Array.from({ length: level }).map((_, i) => (
            <div key={`indent-${level}-${i}`} className="w-4 border-l border-border h-full" />
          ))}
          <div className="flex-1">
            {node.type === "folder" ? (
              <>
                <button
                  type="button"
                  className={cn(
                    "flex items-center gap-2 py-1 rounded text-sm cursor-pointer transition w-full font-semibold hover:bg-muted/40",
                    open[node.path] && "bg-muted/60"
                  )}
                  onClick={() => setOpen((prev) => ({ ...prev, [node.path]: !prev[node.path] }))}
                  aria-expanded={open[node.path] ? "true" : "false"}
                >
                  <span className="w-4 flex items-center justify-center">
                    <span className={cn("inline-block transition-transform", open[node.path] && "rotate-90")}>▶</span>
                  </span>
                  <FolderIcon className={cn("w-4 h-4", open[node.path] ? "text-primary" : "text-muted-foreground")} />
                  <span className="text-base font-medium text-foreground">{node.name}</span>
                </button>
                {open[node.path] && node.children && (
                  <FileTree
                    nodes={node.children}
                    selected={selected}
                    onSelect={onSelect}
                    level={level + 1}
                    streamingFile={streamingFile}
                  />
                )}
              </>
            ) : (
              <button
                type="button"
                className={cn(
                  "flex items-center gap-2 text-left py-1 rounded text-sm cursor-pointer transition w-full",
                  selected === node.path
                    ? "bg-primary/10 text-primary font-semibold"
                    : "hover:bg-muted/40",
                  streamingFile === node.path && "bg-yellow-100 dark:bg-yellow-900/20 animate-pulse"
                )}
                onClick={() => onSelect(node.path)}
              >
                <FileIcon className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
                <span className="truncate">{node.name}</span>
                {streamingFile === node.path && (
                  <div className="ml-auto">
                    <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />
                  </div>
                )}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
