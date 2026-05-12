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
  const valueRef = useRef(value);
  valueRef.current = value;
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
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const attach = async () => {
      const { bindMonaco } = await import("@/lib/collaboration/bindMonaco");
      if (cancelled) return;

      // Wait for provider sync before binding so we know the true doc state
      if (!provider.synced) {
        await new Promise<void>((resolve) => {
          const onSync = () => { provider.off('synced', onSync); resolve(); };
          provider.on('synced', onSync);
          setTimeout(() => { provider.off('synced', onSync); resolve(); }, 2000);
        });
      }
      if (cancelled) return;

      // Seed Yjs with store content if the doc is empty but we have content
      // (happens when user opens code tab after agent finished writing)
      const storeValue = valueRef.current;
      if (yText.length === 0 && storeValue && storeValue.length > 0) {
        yText.doc!.transact(() => {
          yText.insert(0, storeValue);
        });
      }

      const binding = await bindMonaco({
        editor: editorRef.current!,
        yText,
        awareness: provider.awareness ?? null,
      });
      bindingRef.current = binding;
    };

    attach();

    // Observe Yjs changes to sync back to store/E2B (debounced to avoid feedback loops during streaming)
    const observer = () => {
      if (cancelled || isStreaming) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (cancelled) return;
        onChange(yText.toString());
      }, 100);
    };
    yText.observe(observer);

    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      yText.unobserve(observer);
      if (bindingRef.current) {
        bindingRef.current.destroy();
        bindingRef.current = null;
      }
    };
  }, [yText, provider, onChange, isStreaming]);

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
