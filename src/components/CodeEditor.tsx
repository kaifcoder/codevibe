/* eslint-disable @typescript-eslint/no-unused-vars */
"use client";

import { useRef } from "react";
import MonacoEditor from "@monaco-editor/react";
import { Card } from "./ui/card";
import { Label } from "./ui/label";

interface CodeEditorProps {
  value: string;
  onChange: (value: string | undefined) => void;
  language?: string;
  height?: number | string;
  label?: string;
}

export function CodeEditor({ value, onChange, language = "typescript", height = 300, label }: CodeEditorProps) {
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
