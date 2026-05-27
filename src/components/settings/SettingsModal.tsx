"use client";

import { useEffect } from "react";
import { X, Settings as SettingsIcon, Boxes } from "lucide-react";
import { cn } from "@/lib/utils";
import { McpServerSettings } from "@/components/settings/McpServerSettings";

type Section = "general" | "apps";

interface SettingsModalProps {
  open: boolean;
  section: Section;
  onClose: () => void;
  onSectionChange: (s: Section) => void;
}

const SECTIONS: Array<{ id: Section; label: string; icon: typeof SettingsIcon }> = [
  { id: "general", label: "General", icon: SettingsIcon },
  { id: "apps", label: "Apps", icon: Boxes },
];

const TITLES: Record<Section, { title: string; subtitle?: string }> = {
  general: { title: "General" },
  apps: { title: "Apps", subtitle: "Manage MCP servers the agent can use in your chats." },
};

export function SettingsModal({ open, section, onClose, onSectionChange }: SettingsModalProps) {
  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const { title, subtitle } = TITLES[section];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-5xl h-[85vh] bg-zinc-950 rounded-2xl shadow-2xl ring-1 ring-white/10 overflow-hidden flex">
        <aside className="border-r border-white/5 bg-zinc-950 flex-shrink-0 w-64 hidden md:block">
          <div className="p-3">
            <button
              type="button"
              onClick={onClose}
              className="size-8 rounded-md hover:bg-white/5 flex items-center justify-center cursor-pointer"
              aria-label="Close settings"
            >
              <X className="size-4 text-zinc-400" />
            </button>
          </div>
          <nav className="p-3 space-y-0.5">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => onSectionChange(id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition text-left cursor-pointer",
                  section === id
                    ? "bg-white/10 text-white"
                    : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200",
                )}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </nav>
        </aside>

        <main className="flex-1 flex flex-col min-w-0">
          <header className="flex items-center justify-between gap-4 px-6 py-4 border-b border-white/5">
            <div className="min-w-0">
              <h1 className="text-base font-medium text-white truncate">{title}</h1>
              {subtitle && (
                <p className="text-xs text-zinc-500 mt-0.5 truncate">{subtitle}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="md:hidden size-8 rounded-md hover:bg-white/5 flex items-center justify-center cursor-pointer"
              aria-label="Close settings"
            >
              <X className="size-4 text-zinc-400" />
            </button>
          </header>
          <div className="flex-1 overflow-y-auto">
            {section === "general" && (
              <div className="p-6 space-y-6">
                <section className="space-y-2">
                  <h2 className="text-sm font-medium text-zinc-200">Account</h2>
                  <p className="text-sm text-zinc-500">
                    Use the Apps tab to add and manage MCP servers your AI agent can access.
                  </p>
                </section>
              </div>
            )}
            {section === "apps" && <McpServerSettings />}
          </div>
        </main>
      </div>
    </div>
  );
}
