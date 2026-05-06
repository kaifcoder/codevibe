"use client";

import type * as MonacoTypes from "monaco-editor";
import { useRef, useEffect, useCallback } from "react";
import MonacoEditor, { type Monaco } from "@monaco-editor/react";
import { Card } from "./ui/card";
import { useTheme } from "next-themes";
import type * as Y from "yjs";
import type { HocuspocusProvider } from "@hocuspocus/provider";

interface CodeEditorProps {
  value: string;
  onChange: (value: string | undefined) => void;
  language?: string;
  autoScroll?: boolean;
  isStreaming?: boolean;
  yText?: Y.Text | null;
  provider?: HocuspocusProvider | null;
}

export function CodeEditor({
  value,
  onChange,
  language = "typescript",
  autoScroll = false,
  isStreaming = false,
  yText,
  provider,
}: Readonly<CodeEditorProps>) {
  const editorRef = useRef<MonacoTypes.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const prevStreamValueRef = useRef<string>('');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bindingRef = useRef<any>(null);
  const { resolvedTheme } = useTheme();

  const isCollaborative = !!yText && !!provider;

  // Incremental streaming: apply only the new delta (non-collaborative mode only)
  useEffect(() => {
    if (!isStreaming || !editorRef.current || !monacoRef.current || isCollaborative) return;

    const editor = editorRef.current;
    const model = editor.getModel();
    if (!model) return;

    const newValue = value || '';
    const prev = prevStreamValueRef.current;

    if (prev.length === 0 && newValue.length > 0) {
      model.setValue(newValue);
    } else if (newValue.startsWith(prev) && newValue.length > prev.length) {
      const delta = newValue.slice(prev.length);
      const lastLine = model.getLineCount();
      const lastCol = model.getLineMaxColumn(lastLine);
      editor.executeEdits('streaming', [{
        range: new (monacoRef.current.Range)(lastLine, lastCol, lastLine, lastCol),
        text: delta,
        forceMoveMarkers: true,
      }]);
    } else if (newValue !== prev) {
      model.setValue(newValue);
    }

    prevStreamValueRef.current = newValue;

    if (autoScroll) {
      const lineCount = model.getLineCount();
      editor.revealLine(lineCount);
    }
  }, [value, isStreaming, autoScroll, isCollaborative]);

  // Reset ref when streaming ends
  useEffect(() => {
    if (!isStreaming) {
      prevStreamValueRef.current = '';
    }
  }, [isStreaming]);

  // Yjs binding: attach/detach when yText or provider changes
  useEffect(() => {
    if (!editorRef.current || !yText || !provider) return;

    let cancelled = false;

    const attach = async () => {
      const { bindMonaco } = await import("@/lib/collaboration/bindMonaco");
      if (cancelled) return;
      const binding = await bindMonaco({
        editor: editorRef.current!,
        yText,
        awareness: provider.awareness ?? null,
      });
      bindingRef.current = binding;
    };

    attach();

    // Observe Yjs changes to sync back to store/E2B
    const observer = () => {
      if (cancelled) return;
      const content = yText.toString();
      onChange(content);
    };
    yText.observe(observer);

    return () => {
      cancelled = true;
      yText.unobserve(observer);
      if (bindingRef.current) {
        bindingRef.current.destroy();
        bindingRef.current = null;
      }
    };
  }, [yText, provider, onChange]);

  const handleEditorDidMount = useCallback((editor: MonacoTypes.editor.IStandaloneCodeEditor, monaco: Monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
  }, []);

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
          value={isCollaborative ? undefined : (isStreaming ? undefined : value)}
          onChange={isCollaborative ? undefined : (isStreaming ? undefined : onChange)}
          language={language}
          height="100%"
          theme={resolvedTheme === 'dark' ? 'vs-dark' : 'light'}
          beforeMount={handleEditorWillMount}
          onMount={handleEditorDidMount}
          options={{
            fontSize: 14,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: "on",
            automaticLayout: true,
            readOnly: isStreaming,
            cursorStyle: 'line',
          }}
        />
      </div>
    </Card>
  );
}
