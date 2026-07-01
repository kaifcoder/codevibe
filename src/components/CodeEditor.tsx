"use client";

import type * as MonacoTypes from "monaco-editor";
import { useRef, useEffect, useCallback, useState } from "react";
import MonacoEditor, { type Monaco } from "@monaco-editor/react";
import { Card } from "./ui/card";
import { useTheme } from "next-themes";
import type * as Y from "yjs";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import type { BoundMonaco } from "@/lib/collaboration/bindMonaco";

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
  const [editor, setEditor] = useState<MonacoTypes.editor.IStandaloneCodeEditor | null>(null);
  const bindingRef = useRef<BoundMonaco | null>(null);
  // Normalize CRLF → LF at every entry point. Files cloned from Windows-touched
  // repos ship `\r\n` line endings; Monaco silently rewrites them to `\n` when
  // it renders the model, but Y.Text still holds the `\r`s. That size mismatch
  // is what breaks remote-cursor rendering — every `\r` before the caret adds
  // one to the Y offset, so peers see the remote caret one line below actual
  // (and pressing right at EOL jumps two lines because it crosses a `\r\n`).
  const normalizedInitial = (initialContent ?? "").replace(/\r\n/g, "\n");
  const initialContentRef = useRef(normalizedInitial);
  initialContentRef.current = normalizedInitial;
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (!editor || !yText || !provider) return;

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
      // Mark with a known origin so the E2B-sync observer can ignore it —
      // the seed content originated from the agent's E2B write, so bouncing
      // it back through /api/write-to-sandbox would either be redundant or
      // (if the agent wrote a newer version meanwhile) overwrite real code.
      //
      // `seed` was already CRLF-normalized when we captured it into the
      // ref — see the note at the top of this component for why that
      // matters for remote-cursor rendering.
      const seed = initialContentRef.current;
      if (yText.length === 0 && seed.length > 0) {
        yText.doc!.transact(() => {
          yText.insert(0, seed);
        }, "local-seed");
      } else if (yText.length > 0 && yText.toString().includes("\r")) {
        // Legacy repair: an earlier session (before we normalized at ingress)
        // may have populated this room with CRLF content. Rewrite it in place
        // with LF-only so remote cursors line up. Uses the same "local-seed"
        // origin so the E2B observer treats it as inert.
        const current = yText.toString();
        const cleaned = current.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        if (cleaned !== current) {
          yText.doc!.transact(() => {
            yText.delete(0, yText.length);
            yText.insert(0, cleaned);
          }, "local-seed");
        }
      }

      const binding = await bindMonaco({ editor, yText, awareness: provider.awareness ?? null });
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
  }, [editor, yText, provider]);

  const handleEditorDidMount = useCallback(
    (mountedEditor: MonacoTypes.editor.IStandaloneCodeEditor) => {
      // Lock the model to LF line endings. Yjs stores raw bytes and Monaco's
      // renderer collapses `\r\n` to `\n` silently — that size drift is what
      // makes remote y-monaco cursors render one line below actual. Setting
      // EOL explicitly + normalizing every source at ingress keeps Y.Text
      // and Monaco in exact byte-for-byte agreement.
      const model = mountedEditor.getModel();
      if (model) {
        // 0 = EndOfLineSequence.LF (using the numeric enum value avoids
        // pulling the monaco namespace into this file just for one constant).
        model.setEOL(0);
      }
      setEditor(mountedEditor);
    },
    [],
  );

  const handleEditorWillMount = useCallback((monaco: Monaco) => {
    // Monaco's bundled TS checker doesn't know about the project's deps or
    // path aliases, so semantic errors are pure noise. Real typechecking runs
    // in the E2B sandbox. Keep syntax validation — those errors are real.
    const opts = {
      noSemanticValidation: true,
      noSyntaxValidation: false,
    };
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions(opts);
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions(opts);
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
