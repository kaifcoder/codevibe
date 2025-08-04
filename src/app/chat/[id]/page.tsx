"use client";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useTRPC } from "@/trpc/client";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { CodeEditor } from "@/components/CodeEditor";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileTree } from "@/components/FileTree";
import { ChatPanel, ChatMessage } from "@/components/ChatPanel";

// Define FileNode type for file tree structure
type FileNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileNode[];
  content?: string;
};

function Page() {
  const trpc = useTRPC();
  const invoke = useMutation(
    trpc.invoke.mutationOptions({
      onSuccess: ({ success }) => {
        toast.success("Function invoked successfully!");
        console.log(success);
      },
      onError: (error) => {
        toast.error(`Error invoking function: ${error.message}`);
      },
    })
  );

  // state for the input message
  const [message, setMessage] = useState("");
  // state for toggling the second panel
  const [showSecondPanel] = useState(true);
  // state for the code editor
  const [code, setCode] = useState("// Write your code here\n");
  // state for iframe loading
  const [iframeLoading, setIframeLoading] = useState(true);

  // sample hierarchical file tree state
  const [fileTree, setFileTree] = useState<FileNode[]>([
    {
      name: "app",
      path: "app",
      type: "folder",
      children: [
        {
          name: "page.tsx",
          path: "app/page.tsx",
          type: "file",
          content: "// Home page code\n",
        },
      ],
    },
    {
      name: "lib",
      path: "lib",
      type: "folder",
      children: [
        {
          name: "utils.ts",
          path: "lib/utils.ts",
          type: "file",
          content: "export function sum(a, b) { return a + b; }\n",
        },
      ],
    },
    {
      name: "components",
      path: "components",
      type: "folder",
      children: [
        {
          name: "Button.tsx",
          path: "components/Button.tsx",
          type: "file",
          content: "export const Button = () => <button>Click</button>;\n",
        },
      ],
    },
  ]);

  // flatten file tree to get all files for selection and editing
  function flattenFiles(nodes: FileNode[]): FileNode[] {
    let files: FileNode[] = [];
    for (const node of nodes) {
      if (node.type === "file") files.push(node);
      if (node.type === "folder" && node.children) files = files.concat(flattenFiles(node.children));
    }
    return files;
  }
  const allFiles = flattenFiles(fileTree);
  const [selectedFile, setSelectedFile] = useState(allFiles[0].path);

  // update code when file changes
  useEffect(() => {
    const file = allFiles.find(f => f.path === selectedFile);
    if (file) setCode(file.content ?? "");
  }, [selectedFile, allFiles]);

  // update file content when code changes
  const handleCodeChange = (val: string | undefined) => {
    setCode(val ?? "");
    setFileTree(prev => {
      interface UpdateNode {
        name: string;
        path: string;
        type: "file" | "folder";
        children?: UpdateNode[];
        content?: string;
      }

      function update(nodes: UpdateNode[]): UpdateNode[] {
        return nodes.map((n: UpdateNode) => {
          if (n.type === "file" && n.path === selectedFile) return { ...n, content: val ?? "" };
          if (n.type === "folder" && n.children) return { ...n, children: update(n.children) };
          return n;
        });
      }
      return update(prev);
    });
  };

  // Chat state for Copilot-like interface
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // Handler for sending a message
  const handleSend = () => {
    if (!message.trim()) return;
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setMessage("");
    // Simulate AI response (replace with real invoke logic)
    setTimeout(() => {
      setMessages((prev) => [...prev, { role: "ai", content: `AI: ${message}` }]);
    }, 800);
    // Optionally, call invoke.mutate({ message }) here for real backend
  };

  return (
    <div className="flex flex-1 flex-col">
      <div className="@container/main flex flex-1 flex-col gap-2">
        <ResizablePanelGroup direction="horizontal" >
          <ResizablePanel defaultSize={30}>
            <ChatPanel
              messages={messages}
              message={message}
              setMessage={setMessage}
              onSend={handleSend}
              isLoading={invoke.isPending}
            />
          </ResizablePanel>
          <ResizableHandle withHandle />
          {showSecondPanel && (
            <ResizablePanel
              defaultSize={70}
              className="animate-in fade-in-0 data-[state=active]:fade-in-100"
            >
              <AnimatePresence mode="wait">
                {showSecondPanel && (
                  <motion.div
                    key="webview-panel"
                    initial={{ x: "100%", opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: "100%", opacity: 0 }}
                    transition={{ type: "tween", duration: 0.35 }}
                    className="flex h-full w-full flex-col gap-2 p-4"
                  >
                    <Tabs defaultValue="live preview" className="flex flex-col flex-1 h-full">
                      <TabsList>
                        <TabsTrigger value="live preview">live preview</TabsTrigger>
                        <TabsTrigger value="code">Code</TabsTrigger>
                      </TabsList>
                      <TabsContent value="code" className="flex flex-row flex-1 h-full gap-2">
                        <div className="w-48 h-full flex-shrink-0">
                          <FileTree
                            nodes={fileTree}
                            selected={selectedFile}
                            onSelect={setSelectedFile}
                          />
                        </div>
                        <div className="flex-1 flex flex-col h-full">
                          <CodeEditor
                            value={code}
                            onChange={handleCodeChange}
                            language="typescript"
                            height={"100%"}
                            label={selectedFile}
                          />
                        </div>
                      </TabsContent>
                      <TabsContent value="live preview" className="flex flex-col flex-1 h-full">
                        <h1 className="text-lg font-semibold">Live Output</h1>
                        <div className="flex-1 w-full rounded-lg overflow-hidden border mt-2 mb-4 relative">
                          {iframeLoading && (
                            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80">
                              <span className="animate-spin rounded-full border-4 border-gray-300 border-t-primary h-10 w-10 block" />
                            </div>
                          )}
                          <iframe
                            src="https://3000-imdglwuvc01tdvu7smh1k.e2b.app"
                            title="ChatGPT"
                            className="w-full h-full min-h-[200px] border-0"
                            allow="clipboard-write; clipboard-read; microphone; camera"
                            onLoad={() => setIframeLoading(false)}
                          />
                        </div>
                      </TabsContent>
                    </Tabs>
                  </motion.div>
                )}
              </AnimatePresence>
            </ResizablePanel>
          )}
        </ResizablePanelGroup>
      </div>
    </div>
  );
}

export default Page;
