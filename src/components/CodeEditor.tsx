"use client";

import type * as MonacoTypes from "monaco-editor";
import { useRef, useEffect, useCallback } from "react";
import MonacoEditor, { type Monaco } from "@monaco-editor/react";
import { Card } from "./ui/card";
import { useTheme } from "next-themes";
import type * as Y from "yjs";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import type { MonacoBinding } from "y-monaco";

interface CodeEditorProps {
  yText: Y.Text | null;
  provider: HocuspocusProvider | null;
  language?: string;
  /** Used once to seed the Y.Doc if Hocuspocus has no content for this room yet. */
  initialContent?: string;
}

export function CodeEditor({
  yText,
  provider,
  language = "typescript",
  initialContent,
}: Readonly<CodeEditorProps>) {
  const editorRef = useRef<MonacoTypes.editor.IStandaloneCodeEditor | null>(null);
  const bindingRef = useRef<MonacoBinding | null>(null);
  const initialContentRef = useRef(initialContent ?? "");
  initialContentRef.current = initialContent ?? "";
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (!editorRef.current || !yText || !provider) return;

    let cancelled = false;

    const attach = async () => {
      const { bindMonaco } = await import("@/lib/collaboration/bindMonaco");
      if (cancelled) return;

      // Wait for provider sync before binding so we know the true doc state.
      if (!provider.synced) {
        await new Promise<void>((resolve) => {
          const onSync = () => {
            provider.off("synced", onSync);
            resolve();
          };
          provider.on("synced", onSync);
          setTimeout(() => {
            provider.off("synced", onSync);
            resolve();
          }, 2000);
        });
      }
      if (cancelled) return;

      // Seed the Y.Doc on first open if Hocuspocus has no content yet.
      const seed = initialContentRef.current;
      if (yText.length === 0 && seed.length > 0) {
        yText.doc!.transact(() => {
          yText.insert(0, seed);
        });
      }

      const binding = await bindMonaco({
        editor: editorRef.current!,
        yText,
        awareness: provider.awareness ?? null,
      });
      if (cancelled) {
        binding.destroy();
        return;
      }
      bindingRef.current = binding;
    };

    attach();

    return () => {
      cancelled = true;
      if (bindingRef.current) {
        bindingRef.current.destroy();
        bindingRef.current = null;
      }
    };
  }, [yText, provider]);

  const handleEditorDidMount = useCallback(
    (editor: MonacoTypes.editor.IStandaloneCodeEditor) => {
      editorRef.current = editor;
    },
    [],
  );

  const handleEditorWillMount = useCallback((monaco: Monaco) => {
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
      diagnosticCodesToIgnore: [7027, 7028, 6133, 6196],
    });
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
      diagnosticCodesToIgnore: [7027, 7028, 6133, 6196],
    });
  }, []);

  return (
    <Card className="w-full h-full flex-1 flex flex-col p-0 overflow-hidden border-0 shadow-none rounded-none">
      <div className="flex-1 h-full">
        <MonacoEditor
          language={language}
          height="100%"
          theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
          beforeMount={handleEditorWillMount}
          onMount={handleEditorDidMount}
          options={{
            fontSize: 14,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: "on",
            automaticLayout: true,
            cursorStyle: "line",
          }}
        />
      </div>
    </Card>
  );
}
