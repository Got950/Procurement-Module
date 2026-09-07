"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Mail, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

type GmailStatus = {
  connected: boolean;
  email?: string | null;
  needsReconnect?: boolean;
  error?: string;
};

export function GmailSyncButton({ canManageMailbox = false }: { canManageMailbox?: boolean }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const loadStatus = async () => {
    try {
      const r = await fetch("/api/integrations/gmail/status");
      const j = (await r.json()) as GmailStatus;
      setStatus(j);
      if (j.needsReconnect && j.error) {
        setMsg(j.error);
      }
    } catch {
      setStatus(null);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const sync = async () => {
    setMsg(null);
    setSyncing(true);
    try {
      const r = await fetch("/api/integrations/gmail/sync", { method: "POST" });
      const text = await r.text();
      let j: Record<string, unknown> = {};
      try {
        if (text) j = JSON.parse(text) as Record<string, unknown>;
      } catch {
        setMsg(
          r.ok
            ? "Sync finished but response was not JSON (check server logs)."
            : `Error ${r.status}: ${text.slice(0, 160)}`
        );
        return;
      }
      setMsg(
        r.ok
          ? `Synced · quotes +${Number(j.quotationsCreated ?? 0)} · vendor mails +${Number(j.vendorMailAlerts ?? 0)}`
          : String(j.error ?? "Error")
      );
      await loadStatus();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Network error");
    } finally {
      setSyncing(false);
    }
  };

  const disconnect = async () => {
    setMsg(null);
    setMenuOpen(false);
    try {
      const r = await fetch("/api/integrations/gmail/disconnect", { method: "POST" });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setMsg(j.error ?? "Disconnect failed");
        return;
      }
      setMsg("Gmail disconnected — click Connect Gmail and sign in again");
      await loadStatus();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Disconnect failed");
    }
  };

  const statusLabel = status?.connected && status.email
    ? status.email
    : status?.needsReconnect
      ? "Reconnect required"
      : "Not connected";

  const statusTone = status?.connected
    ? "text-[var(--color-success)]"
    : status?.needsReconnect
      ? "text-[var(--color-warning)]"
      : "text-[var(--color-muted)]";

  return (
    <div className="relative flex items-center gap-1.5">
      <div className="hidden items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2.5 py-1 lg:flex">
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full bg-current", statusTone)} aria-hidden />
        <span className="max-w-[160px] truncate text-[11px] text-[var(--color-muted)]" title={statusLabel}>
          {statusLabel}
        </span>
      </div>
      <Button variant="outline" size="sm" disabled={syncing} onClick={() => void sync()}>
        <Mail className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{syncing ? "Syncing…" : "Sync Gmail"}</span>
        <span className="sm:hidden">{syncing ? "…" : "Sync"}</span>
      </Button>
      {canManageMailbox && (
        <div className="relative">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Gmail account actions"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
          {menuOpen && (
            <>
              <button
                type="button"
                className="fixed inset-0 z-40 cursor-default"
                aria-label="Close menu"
                onClick={() => setMenuOpen(false)}
              />
              <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white py-1 shadow-[var(--shadow-sm)]">
                <a
                  href="/api/integrations/gmail/start"
                  className="block px-3 py-2 text-[13px] text-[var(--color-fg)] hover:bg-[var(--color-accent-soft)]"
                  onClick={() => setMenuOpen(false)}
                >
                  Connect Gmail
                </a>
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-[13px] text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)]"
                  onClick={() => void disconnect()}
                >
                  Disconnect
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {msg && (
        <span className="absolute left-0 top-full z-30 mt-1 max-w-[280px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-white px-2 py-1 text-[11px] text-[var(--color-fg)] shadow-[var(--shadow-xs)]">
          {msg}
        </span>
      )}
    </div>
  );
}
