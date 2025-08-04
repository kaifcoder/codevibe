import { useState } from "react";
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
}

export function FileTree({ nodes, selected, onSelect, level = 0 }: FileTreeProps) {
  const [open, setOpen] = useState<{ [key: string]: boolean }>({});

  return (
    <div className="w-full flex flex-col gap-0.5 h-full overflow-y-auto">
      {nodes.map((node) => (
        <div key={node.path} className="select-none flex">
          {/* Indentation lines */}
          {Array.from({ length: level }).map((_, i) => (
            <div key={i} className="w-4 border-l border-border h-full" />
          ))}
          <div className="flex-1">
            {node.type === "folder" ? (
              <>
                <div
                  className={cn(
                    "flex items-center gap-2 py-1 rounded text-sm cursor-pointer transition w-full font-semibold hover:bg-muted/40",
                    open[node.path] && "bg-muted/60"
                  )}
                  onClick={() => setOpen((prev) => ({ ...prev, [node.path]: !prev[node.path] }))}
                  role="button"
                  tabIndex={0}
                >
                  <span className="w-4 flex items-center justify-center">
                    <span className={cn("inline-block transition-transform", open[node.path] && "rotate-90")}>▶</span>
                  </span>
                  <FolderIcon className={cn("w-4 h-4", open[node.path] ? "text-primary" : "text-muted-foreground")} />
                  <span className="text-base font-medium text-foreground">{node.name}</span>
                </div>
                {open[node.path] && node.children && (
                  <FileTree
                    nodes={node.children}
                    selected={selected}
                    onSelect={onSelect}
                    level={level + 1}
                  />
                )}
              </>
            ) : (
              <div
                className={cn(
                  "flex items-center gap-2 text-left py-1 rounded text-sm cursor-pointer transition w-full",
                  selected === node.path
                    ? "bg-primary/10 text-primary font-semibold"
                    : "hover:bg-muted/40"
                )}
                onClick={() => onSelect(node.path)}
                role="button"
                tabIndex={0}
              >
                <FileIcon className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
                <span className="truncate">{node.name}</span>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
