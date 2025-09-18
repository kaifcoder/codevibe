/* eslint-disable @typescript-eslint/no-unused-vars */
"use client";

import type * as monaco from "monaco-editor";
import { useRef, useEffect } from "react";
import MonacoEditor from "@monaco-editor/react";
import { Card } from "./ui/card";
import { Label } from "./ui/label";

interface CodeEditorProps {
  value: string;
  onChange: (value: string | undefined) => void;
  language?: string;
  height?: number | string;
  label?: string;
  autoScroll?: boolean;
}

export function CodeEditor({ value, onChange, language = "typescript", height = 300, label, autoScroll = false }: Readonly<CodeEditorProps>) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  // Auto-scroll to bottom when content changes and autoScroll is enabled
  useEffect(() => {
    if (autoScroll && editorRef.current) {
      const editor = editorRef.current;
      const model = editor.getModel();
      if (model) {
        const lineCount = model.getLineCount();
        editor.revealLine(lineCount);
        editor.setPosition({ lineNumber: lineCount, column: model.getLineMaxColumn(lineCount) });
      }
    }
  }, [value, autoScroll]);


  const handleEditorDidMount = (editor: monaco.editor.IStandaloneCodeEditor) => {
    editorRef.current = editor;
  };
  return (
    <Card className="w-full h-full flex-1 flex flex-col p-0 overflow-hidden">
      {label && <Label className="px-4 pt-4 pb-2 block">{label}</Label>}
      <div className="flex-1 h-full">
        <MonacoEditor
          value={value}
          onChange={onChange}
          language={language}
          height="100%"
          theme="vs-dark"
          onMount={handleEditorDidMount}
          options={{
            fontSize: 14,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: "on",
            automaticLayout: true,
          }}
        />
      </div>
    </Card>
  );
}
