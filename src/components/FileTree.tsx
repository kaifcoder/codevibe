import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { 
  ChevronRight, 
  ChevronDown,
  Folder,
  FolderOpen,
  FileCode,
  FileJson,
  FileText,
  File
} from "lucide-react";

export type FileNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileNode[];
};

function getFileIcon(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
      return FileCode;
    case 'json':
      return FileJson;
    case 'md':
    case 'txt':
      return FileText;
    default:
      return File;
  }
}

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
    <div className="w-full flex flex-col h-full overflow-y-auto text-sm bg-muted/20">
      {nodes.map((node) => {
        const FileIconComponent = node.type === "file" ? getFileIcon(node.name) : null;
        return (
        <div key={node.path} className="select-none">
          <div style={{ paddingLeft: `${level * 12}px` }}>
            {node.type === "folder" ? (
              <>
                <button
                  type="button"
                  className={cn(
                    "flex items-center gap-1.5 px-2 py-0.5 text-sm cursor-pointer transition w-full hover:bg-accent/50",
                    selected.startsWith(node.path) && "bg-accent/30"
                  )}
                  onClick={() => setOpen((prev) => ({ ...prev, [node.path]: !prev[node.path] }))}
                  aria-expanded={open[node.path] ? "true" : "false"}
                >
                  {open[node.path] ? (
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  )}
                  {open[node.path] ? (
                    <FolderOpen className="w-4 h-4 text-blue-500 shrink-0" />
                  ) : (
                    <Folder className="w-4 h-4 text-blue-500 shrink-0" />
                  )}
                  <span className="font-medium truncate">{node.name}</span>
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
                  "flex items-center gap-1.5 text-left px-2 py-0.5 text-sm transition w-full cursor-pointer",
                  selected === node.path
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50",
                  streamingFile === node.path && "bg-blue-500/10 animate-pulse"
                )}
                onClick={() => onSelect(node.path)}
              >
                <div className="w-3.5 h-3.5 shrink-0" />
                {FileIconComponent && <FileIconComponent className="w-4 h-4 text-muted-foreground shrink-0" />}
                <span className="truncate">{node.name}</span>
                {streamingFile === node.path && (
                  <div className="ml-auto shrink-0">
                    <div className="w-1.5 h-1.5 bg-yellow-500 rounded-full animate-pulse" />
                  </div>
                )}
              </button>
            )}
          </div>
        </div>
      );
      })}
    </div>
  );
}
