import { Card } from "./ui/card";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { FolderIcon, FolderOpenIcon, FileIcon } from "lucide-react";

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
    <Card className="w-full flex flex-col p-2 gap-1 h-full overflow-y-auto bg-muted/40 border border-border">
      {nodes.map((node) => (
        <div key={node.path} className="w-full">
          {node.type === "folder" ? (
            <>
              <button
                className={cn(
                  "flex items-center gap-2 px-2 py-1 rounded text-sm cursor-pointer transition w-full group",
                  open[node.path] ? "font-semibold bg-muted/60" : "font-normal hover:bg-muted/40"
                )}
                onClick={() => setOpen((prev) => ({ ...prev, [node.path]: !prev[node.path] }))}
              >
                <span style={{ width: level * 16 }} className="shrink-0" />
                {open[node.path] ? (
                  <FolderOpenIcon className="w-4 h-4 text-primary" />
                ) : (
                  <FolderIcon className="w-4 h-4 text-muted-foreground" />
                )}
                <span className="text-base font-medium text-foreground">{node.name}</span>
              </button>
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
            <button
              className={cn(
                "flex items-center gap-2 text-left px-2 py-1 rounded text-sm cursor-pointer transition w-full group",
                selected === node.path
                  ? "bg-primary/10 text-primary font-semibold"
                  : "hover:bg-muted/40"
              )}
              onClick={() => onSelect(node.path)}
            >
              <span style={{ width: 20 + level * 16 }} className="shrink-0" />
              <FileIcon className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
              <span className="truncate">{node.name}</span>
            </button>
          )}
        </div>
      ))}
    </Card>
  );
}
