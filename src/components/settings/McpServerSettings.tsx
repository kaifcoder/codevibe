"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Loader2, Trash2, RotateCcw, Server, CheckCircle2, AlertCircle, Link2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

interface UserMcpServer {
  id: string;
  name: string;
  url: string;
  authType: "bearer" | "none" | "oauth";
  hasToken: boolean;
  oauthAuthorized?: boolean;
  createdAt: string;
}

type AuthType = "bearer" | "none" | "oauth";

export function McpServerSettings() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [servers, setServers] = useState<UserMcpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserMcpServer | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/mcp/servers");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Failed to load servers (${res.status})`);
      }
      const data = await res.json();
      setServers(data.servers ?? []);
    } catch (err) {
      console.error("[McpServerSettings] refresh failed:", err);
      toast.error(err instanceof Error ? err.message : "Failed to load servers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  // Pick up OAuth callback success / failure surfaced as query params on the
  // home page after the redirect.
  useEffect(() => {
    const connected = searchParams.get("connected");
    const connectError = searchParams.get("connectError");
    const settingsParam = searchParams.get("settings");
    if (connected) {
      toast.success("Server connected");
      refresh();
      router.replace(settingsParam ? `/?settings=${settingsParam}` : "/");
    } else if (connectError) {
      toast.error(`Connection failed: ${connectError}`);
      router.replace(settingsParam ? `/?settings=${settingsParam}` : "/");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const onDelete = async (server: UserMcpServer) => {
    setDeleteTarget(null);
    try {
      const res = await fetch(`/api/mcp/servers/${server.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      toast.success(`Removed ${server.name}`);
      setServers((prev) => prev.filter((s) => s.id !== server.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-sm font-medium text-zinc-200">MCP servers</h2>
          <p className="text-xs text-zinc-500">
            Connect Model Context Protocol servers to give the agent more tools and data sources.
          </p>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)} className="gap-2">
          <Plus className="size-4" />
          Add server
        </Button>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-zinc-500">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : servers.length === 0 ? (
        <EmptyState onAdd={() => setAddOpen(true)} />
      ) : (
        <ul className="divide-y divide-white/5 rounded-xl border border-white/5 overflow-hidden">
          {servers.map((server) => (
            <ServerRow key={server.id} server={server} onDelete={() => setDeleteTarget(server)} onConnected={refresh} />
          ))}
        </ul>
      )}

      <AddServerDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={(s) => setServers((prev) => [...prev, s])}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this server?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.name} will be disconnected. The agent will no longer have access to its tools.
              {(deleteTarget?.hasToken || deleteTarget?.oauthAuthorized) &&
                " Stored credentials will also be deleted."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteTarget && onDelete(deleteTarget)}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-white/10 p-10 flex flex-col items-center text-center">
      <div className="size-10 rounded-full bg-white/5 flex items-center justify-center mb-3">
        <Server className="size-5 text-zinc-400" />
      </div>
      <h3 className="text-sm font-medium text-zinc-200">No MCP servers connected</h3>
      <p className="text-xs text-zinc-500 mt-1 max-w-sm">
        Add a remote MCP server to extend what the agent can do — e.g. GitHub, Linear, Notion, your own internal tools.
      </p>
      <Button size="sm" onClick={onAdd} className="mt-4 gap-2">
        <Plus className="size-4" />
        Add server
      </Button>
    </div>
  );
}

function ServerRow({ server, onDelete, onConnected }: { server: UserMcpServer; onDelete: () => void; onConnected: () => void }) {
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; toolCount?: number; error?: string } | null>(null);
  const [loopbackOpen, setLoopbackOpen] = useState(false);

  const test = async () => {
    setTesting(true);
    try {
      const res = await fetch(`/api/mcp/servers/${server.id}`, { method: "POST" });
      const data = await res.json();
      setStatus(data);
      if (data.ok) toast.success(`${server.name}: ${data.toolCount} tools available`);
      else toast.error(`${server.name}: ${data.error}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Test failed";
      setStatus({ ok: false, error: msg });
      toast.error(msg);
    } finally {
      setTesting(false);
    }
  };

  // loopback server and any other server whose IdP doesn't allowlist our host uses
  // a loopback OAuth flow (RFC 8252). The IdP redirects to a dead localhost
  // URL; the user pastes it back here, server completes the exchange.
  const isLoopback = server.url === "";

  const connect = () => {
    if (isLoopback) {
      setLoopbackOpen(true);
    } else {
      window.location.href = `/api/mcp/servers/${server.id}/auth`;
    }
  };

  const isOAuth = server.authType === "oauth";

  return (
    <li className="flex items-center gap-4 p-4 hover:bg-white/[0.02]">
      <div className="size-9 rounded-md bg-white/5 flex items-center justify-center flex-shrink-0">
        <Server className="size-4 text-zinc-300" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-zinc-100 truncate">{server.name}</span>
          {server.authType === "bearer" && (
            <Tag tone="emerald">Bearer</Tag>
          )}
          {isOAuth && (
            <Tag tone={server.oauthAuthorized ? "emerald" : "amber"}>OAuth</Tag>
          )}
          {isOAuth && !server.oauthAuthorized && (
            <span className="text-[10px] text-amber-400 inline-flex items-center gap-1">
              <AlertCircle className="size-3" />
              Not connected
            </span>
          )}
          {isOAuth && server.oauthAuthorized && !status && (
            <span className="text-[10px] text-emerald-400 inline-flex items-center gap-1">
              <CheckCircle2 className="size-3" />
              Connected
            </span>
          )}
          {status?.ok && (
            <span className="text-[10px] text-emerald-400 inline-flex items-center gap-1">
              <CheckCircle2 className="size-3" />
              {status.toolCount} tools
            </span>
          )}
          {status && !status.ok && (
            <span className="text-[10px] text-rose-400 inline-flex items-center gap-1">
              <AlertCircle className="size-3" />
              error
            </span>
          )}
        </div>
        <div className="text-xs text-zinc-500 truncate mt-0.5">{server.url}</div>
      </div>
      <div className="flex items-center gap-1">
        {isOAuth && !server.oauthAuthorized && (
          <Button size="sm" onClick={connect} className="gap-1.5">
            <Link2 className="size-3.5" />
            Connect
          </Button>
        )}
        {isOAuth && server.oauthAuthorized && (
          <Button size="sm" variant="ghost" onClick={connect} className="gap-1.5">
            <Link2 className="size-3.5" />
            Reconnect
          </Button>
        )}
        {(!isOAuth || server.oauthAuthorized) && (
          <Button size="sm" variant="ghost" onClick={test} disabled={testing} className="gap-1.5">
            {testing ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
            Test
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onDelete} className="text-rose-400 hover:text-rose-300">
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      {isLoopback && (
        <LoopbackConnectDialog
          open={loopbackOpen}
          onOpenChange={setLoopbackOpen}
          server={server}
          onConnected={() => {
            setLoopbackOpen(false);
            onConnected();
          }}
        />
      )}
    </li>
  );
}

function Tag({ children, tone }: { children: React.ReactNode; tone: "emerald" | "amber" }) {
  return (
    <span
      className={cn(
        "text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded",
        tone === "emerald" && "text-emerald-400/80 bg-emerald-400/10",
        tone === "amber" && "text-amber-400/90 bg-amber-400/10",
      )}
    >
      {children}
    </span>
  );
}

function AddServerDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (server: UserMcpServer) => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [authType, setAuthType] = useState<AuthType>("none");
  const [bearerToken, setBearerToken] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setName("");
    setUrl("");
    setAuthType("none");
    setBearerToken("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/mcp/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, url, authType, bearerToken: bearerToken || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to add server");
        return;
      }

      onCreated(data.server);
      reset();
      onOpenChange(false);

      if (data.authUrl) {
        // OAuth: bounce the browser into the IdP redirect immediately.
        toast.info(`Connecting to ${data.server.name}…`);
        window.location.href = data.authUrl;
        return;
      }

      toast.success(`${data.server.name}: ${data.toolCount} tools available`);
    } finally {
      setSubmitting(false);
    }
  };

  const cta = authType === "oauth" ? "Connect" : submitting ? "Testing connection…" : "Add server";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!submitting) onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Add MCP server</DialogTitle>
            <DialogDescription>
              {authType === "oauth"
                ? "We'll redirect you to the server to sign in. Tokens stay on this app, encrypted."
                : "We'll connect to the URL to verify it works before saving."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="mcp-name">Name</Label>
            <Input
              id="mcp-name"
              placeholder="GitHub"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="mcp-url">URL</Label>
            <Input
              id="mcp-url"
              placeholder="https://api.example.com/mcp"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
            <p className="text-xs text-zinc-500">Streamable HTTP endpoint.</p>
          </div>

          <div className="space-y-2">
            <Label>Authentication</Label>
            <RadioGroup
              value={authType}
              onValueChange={(v) => setAuthType(v as AuthType)}
              className="space-y-1"
            >
              <label className={cn("flex items-center gap-3 p-2.5 rounded-md border cursor-pointer", authType === "none" ? "border-white/20 bg-white/5" : "border-white/5 hover:border-white/10")}>
                <RadioGroupItem value="none" id="auth-none" />
                <div className="flex-1">
                  <div className="text-sm">None</div>
                  <div className="text-xs text-zinc-500">Public server, no auth required.</div>
                </div>
              </label>
              <label className={cn("flex items-center gap-3 p-2.5 rounded-md border cursor-pointer", authType === "bearer" ? "border-white/20 bg-white/5" : "border-white/5 hover:border-white/10")}>
                <RadioGroupItem value="bearer" id="auth-bearer" />
                <div className="flex-1">
                  <div className="text-sm">Bearer token</div>
                  <div className="text-xs text-zinc-500">Static API key sent as Authorization header.</div>
                </div>
              </label>
              <label className={cn("flex items-center gap-3 p-2.5 rounded-md border cursor-pointer", authType === "oauth" ? "border-white/20 bg-white/5" : "border-white/5 hover:border-white/10")}>
                <RadioGroupItem value="oauth" id="auth-oauth" />
                <div className="flex-1">
                  <div className="text-sm">OAuth</div>
                  <div className="text-xs text-zinc-500">Sign in once at the server. Tokens auto-refresh.</div>
                </div>
              </label>
            </RadioGroup>
          </div>

          {authType === "bearer" && (
            <div className="space-y-2">
              <Label htmlFor="mcp-token">Token</Label>
              <Input
                id="mcp-token"
                type="password"
                placeholder="ghp_... or sk-..."
                value={bearerToken}
                onChange={(e) => setBearerToken(e.target.value)}
                required
              />
              <p className="text-xs text-zinc-500">Stored encrypted at rest.</p>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} className="gap-2">
              {submitting && <Loader2 className="size-3.5 animate-spin" />}
              {cta}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
