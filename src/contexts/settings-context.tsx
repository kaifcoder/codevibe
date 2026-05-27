"use client";

import { createContext, ReactNode, Suspense, useCallback, useContext, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SettingsModal } from "@/components/settings/SettingsModal";

type Section = "general" | "apps";

interface SettingsContextValue {
  open: (section?: Section) => void;
  close: () => void;
  // Bumped every time the settings modal closes. Consumers can include it in
  // a useEffect dep array to refresh state that may have been changed inside
  // settings (e.g. user-added MCP servers).
  changeTick: number;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

// Inner component that calls useSearchParams. Wrapped in <Suspense> below
// because useSearchParams forces CSR bailout, which Next's static prerender
// of /_not-found can't handle without a Suspense boundary.
function SettingsAutoOpener({ onSection }: { onSection: (s: Section) => void }) {
  const searchParams = useSearchParams();
  useEffect(() => {
    const requested = searchParams?.get("settings");
    if (requested === "apps" || requested === "general") {
      onSection(requested);
    }
  }, [searchParams, onSection]);
  return null;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [section, setSection] = useState<Section>("apps");
  const [changeTick, setChangeTick] = useState(0);

  const open = useCallback((s: Section = "apps") => {
    setSection(s);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setChangeTick((n) => n + 1);
  }, []);

  const handleAutoOpen = useCallback((s: Section) => {
    setSection(s);
    setIsOpen(true);
  }, []);

  return (
    <SettingsContext.Provider value={{ open, close, changeTick }}>
      <Suspense fallback={null}>
        <SettingsAutoOpener onSection={handleAutoOpen} />
      </Suspense>
      {children}
      <SettingsModal
        open={isOpen}
        section={section}
        onClose={close}
        onSectionChange={setSection}
      />
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}
