"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
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

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [section, setSection] = useState<Section>("apps");
  const [changeTick, setChangeTick] = useState(0);
  const searchParams = useSearchParams();

  const open = useCallback((s: Section = "apps") => {
    setSection(s);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setChangeTick((n) => n + 1);
  }, []);

  // Auto-open on ?settings=apps (used by the OAuth callback redirect to land
  // the user back inside the modal).
  useEffect(() => {
    const requested = searchParams.get("settings");
    if (requested === "apps" || requested === "general") {
      setSection(requested);
      setIsOpen(true);
    }
  }, [searchParams]);

  return (
    <SettingsContext.Provider value={{ open, close, changeTick }}>
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
