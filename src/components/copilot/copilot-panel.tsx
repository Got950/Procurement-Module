"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Download,
  History,
  Loader2,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Send,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ResourceRef = {
  type: "indent" | "vendor" | "item" | "document" | "route";
  id: string;
  label: string;
  href?: string;
};

type ConfirmationPreview = {
  title: string;
  target: string;
  details: { label: string; value: string }[];
  externalEffect: string | null;
};

type PendingConfirmation = {
  confirmationId: string;
  toolName: string;
  preview: ConfirmationPreview;
};

type ClientAction =
  | { type: "download"; url: string; filename: string }
  | { type: "navigate"; href: string };

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  data?: {
    references?: ResourceRef[];
    clientActions?: ClientAction[];
    pendingConfirmation?: PendingConfirmation | null;
    toolCalls?: { name: string; status: string; message?: string }[];
  } | null;
};

type TurnResponse = {
  conversationId: string;
  reply: string;
  messageId: string;
  references?: ResourceRef[];
  clientActions?: ClientAction[];
  pendingConfirmation?: PendingConfirmation | null;
  toolCalls?: { name: string; status: string; message?: string }[];
};

type ConversationSummary = {
  id: string;
  title: string | null;
  messageCount: number;
  lastActiveAt: string;
};

const SUGGESTED_PROMPTS = [
  "Show my pending indents",
  "What approvals are waiting for me?",
  "List active vendors",
  "What should happen next on my open cases?",
] as const;

function hrefFor(ref: ResourceRef) {
  if (ref.href?.startsWith("/")) return ref.href;
  if (ref.type === "indent") return `/indents/${ref.id}`;
  if (ref.type === "vendor") return `/vendors`;
  if (ref.type === "route") return ref.id.startsWith("/") ? ref.id : "/dashboard";
  return "#";
}

async function triggerDownload(action: Extract<ClientAction, { type: "download" }>) {
  const res = await fetch(action.url, { credentials: "same-origin" });
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? "Download failed — file not found or not authorized."
        : `Download failed (${res.status}).`
    );
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = action.filename || "download.pdf";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

async function readError(res: Response) {
  try {
    const body = (await res.json()) as { error?: string; errorDetail?: { message?: string } };
    return body.errorDetail?.message || body.error || `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

export function CopilotPanel() {
  const router = useRouter();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending, busy, statusLine]);

  const runClientActions = useCallback(
    async (actions: ClientAction[] | undefined) => {
      if (!actions?.length) return;
      for (const action of actions) {
        if (action.type === "download") {
          setStatusLine(`Downloading ${action.filename}…`);
          await triggerDownload(action);
          setStatusLine(`Downloaded ${action.filename}`);
        } else if (action.type === "navigate") {
          setStatusLine("Opening page…");
          router.push(action.href);
        }
      }
    },
    [router]
  );

  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch("/api/copilot/conversations");
      if (!res.ok) return;
      const body = (await res.json()) as { conversations?: ConversationSummary[] };
      setConversations(body.conversations ?? []);
    } catch {
      /* history is optional UI; chat still works */
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (historyOpen) void refreshHistory();
  }, [historyOpen, refreshHistory]);

  const pushAssistant = useCallback(
    (turn: TurnResponse) => {
      setConversationId(turn.conversationId);
      setPending(turn.pendingConfirmation ?? null);
      setMessages((prev) => [
        ...prev,
        {
          id: turn.messageId,
          role: "assistant",
          content: turn.reply,
          data: {
            references: turn.references,
            clientActions: turn.clientActions,
            pendingConfirmation: turn.pendingConfirmation,
            toolCalls: turn.toolCalls,
          },
        },
      ]);
      void runClientActions(turn.clientActions).catch((err) => {
        setError(err instanceof Error ? err.message : "Client action failed.");
        setStatusLine(null);
      });
    },
    [runClientActions]
  );

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy || pending) return;
    setError(null);
    setStatusLine("Working…");
    setBusy(true);
    const optimisticId = `local-${Date.now()}`;
    setMessages((prev) => [...prev, { id: optimisticId, role: "user", content: trimmed }]);
    setInput("");
    try {
      const res = await fetch("/api/copilot/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conversationId ?? undefined,
          message: trimmed,
        }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const turn = (await res.json()) as TurnResponse;
      pushAssistant(turn);
      void refreshHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach the Copilot.");
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      setInput(trimmed);
    } finally {
      setBusy(false);
      setStatusLine(null);
      inputRef.current?.focus();
    }
  }

  async function decide(decision: "confirm" | "cancel") {
    if (!conversationId || !pending || confirmBusy) return;
    setConfirmBusy(true);
    setError(null);
    setStatusLine(decision === "confirm" ? "Applying confirmed action…" : "Cancelling…");
    try {
      const res = await fetch("/api/copilot/confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `copilot-confirm:${pending.confirmationId}:${decision}`,
        },
        body: JSON.stringify({
          conversationId,
          confirmationId: pending.confirmationId,
          decision,
        }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const result = (await res.json()) as {
        reply: string;
        messageId: string;
        status: string;
        clientActions?: ClientAction[];
      };
      setPending(null);
      setMessages((prev) => [
        ...prev,
        {
          id: result.messageId,
          role: "assistant",
          content: result.reply,
          data: {
            pendingConfirmation: null,
            clientActions: result.clientActions,
          },
        },
      ]);
      void runClientActions(result.clientActions).catch((err) => {
        setError(err instanceof Error ? err.message : "Client action failed.");
      });
      void refreshHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Confirmation failed.");
    } finally {
      setConfirmBusy(false);
      setStatusLine(null);
    }
  }

  async function openConversation(id: string) {
    if (loadingConversation || busy || id === conversationId) return;
    setLoadingConversation(true);
    setError(null);
    try {
      const res = await fetch(`/api/copilot/conversations/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(await readError(res));
      const body = (await res.json()) as {
        conversationId: string;
        messages: ChatMessage[];
      };
      setConversationId(body.conversationId);
      setMessages(
        body.messages.map((m) => ({
          id: m.id,
          role: m.role === "user" ? "user" : "assistant",
          content: m.content,
          data: m.data ?? null,
        }))
      );
      const lastWithPending = [...body.messages]
        .reverse()
        .find((m) => m.data?.pendingConfirmation);
      setPending(lastWithPending?.data?.pendingConfirmation ?? null);
      setHistoryOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load conversation.");
    } finally {
      setLoadingConversation(false);
    }
  }

  function startNewChat() {
    if (busy || confirmBusy) return;
    setConversationId(null);
    setMessages([]);
    setPending(null);
    setError(null);
    setInput("");
    setStatusLine(null);
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  }

  return (
    <div className="flex h-full min-h-0">
      <aside
        className={cn(
          "flex shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface-muted)] transition-[width] duration-200",
          historyOpen ? "w-64" : "w-0 overflow-hidden border-r-0"
        )}
        aria-hidden={!historyOpen}
      >
        <div className="flex h-12 items-center justify-between border-b border-[var(--color-border)] px-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            History
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Close history"
            onClick={() => setHistoryOpen(false)}
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {historyLoading ? (
            <p className="px-2 py-3 text-xs text-[var(--color-muted)]">Loading…</p>
          ) : conversations.length === 0 ? (
            <p className="px-2 py-3 text-xs text-[var(--color-muted)]">No conversations yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {conversations.map((c) => {
                const active = c.id === conversationId;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      disabled={loadingConversation}
                      onClick={() => void openConversation(c.id)}
                      className={cn(
                        "w-full rounded-[var(--radius-md)] px-2.5 py-2 text-left transition-colors",
                        active
                          ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                          : "hover:bg-white text-[var(--color-fg)]"
                      )}
                    >
                      <span className="line-clamp-2 text-[13px] font-medium">
                        {c.title?.trim() || "Untitled conversation"}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-[var(--color-muted)]">
                        {c.messageCount} messages ·{" "}
                        {new Date(c.lastActiveAt).toLocaleDateString()}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 md:px-4">
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5 text-[var(--color-muted)]"
              onClick={() => setHistoryOpen((v) => !v)}
              aria-pressed={historyOpen}
            >
              {historyOpen ? (
                <PanelLeftClose className="h-3.5 w-3.5" />
              ) : (
                <PanelLeftOpen className="h-3.5 w-3.5" />
              )}
              <History className="h-3.5 w-3.5 md:hidden" />
              <span className="hidden sm:inline">History</span>
            </Button>
            <div className="hidden h-4 w-px bg-[var(--color-border)] sm:block" />
            <div className="hidden items-center gap-1.5 text-[13px] text-[var(--color-muted)] sm:flex">
              <Sparkles className="h-3.5 w-3.5 text-[var(--color-accent)]" />
              <span>Procurement assistant</span>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || confirmBusy}
            onClick={startNewChat}
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            New chat
          </Button>
        </div>

        <div
          className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5 md:px-6"
          role="log"
          aria-live="polite"
        >
          {loadingConversation ? (
            <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading conversation…
            </div>
          ) : null}

          {messages.length === 0 && !busy && !loadingConversation && (
            <div className="mx-auto max-w-2xl pt-4 md:pt-8">
              <div className="mb-6 text-center">
                <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-accent-soft)]">
                  <Sparkles className="h-5 w-5 text-[var(--color-accent)]" />
                </div>
                <h2 className="text-lg font-semibold text-[var(--color-fg)]">
                  How can I help with procurement?
                </h2>
                <p className="mt-1.5 text-sm text-[var(--color-muted)]">
                  Ask to open, download, edit drafts, approve, or look up vendors and quotations.
                  Consequential actions require your confirmation.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    disabled={busy || !!pending}
                    onClick={() => void sendMessage(prompt)}
                    className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white px-3.5 py-3 text-left text-sm text-[var(--color-fg)] transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-accent-soft)] disabled:opacity-60"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <article
              key={m.id}
              className={cn(
                "max-w-3xl rounded-[var(--radius-lg)] px-4 py-3 text-sm leading-relaxed",
                m.role === "user"
                  ? "ml-auto bg-[var(--color-accent)] text-white"
                  : "mr-auto border border-[var(--color-border)] bg-white text-[var(--color-fg)] shadow-[var(--shadow-xs)]"
              )}
            >
              <p className="whitespace-pre-wrap">{m.content}</p>
              {m.role === "assistant" && m.data?.toolCalls && m.data.toolCalls.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5 border-t border-[var(--color-border)] pt-2">
                  {m.data.toolCalls.map((t, i) => (
                    <span
                      key={`${t.name}-${i}`}
                      className="rounded-[var(--radius-sm)] bg-[var(--color-surface-muted)] px-1.5 py-0.5 text-[11px] text-[var(--color-muted)]"
                    >
                      {t.name.replace(/_/g, " ")}
                      {t.status ? ` · ${t.status}` : ""}
                    </span>
                  ))}
                </div>
              )}
              {m.role === "assistant" &&
                ((m.data?.references && m.data.references.length > 0) ||
                  (m.data?.clientActions && m.data.clientActions.length > 0)) && (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--color-border)] pt-3">
                    {m.data.references?.map((ref) => (
                      <Link
                        key={`${ref.type}:${ref.id}`}
                        href={hrefFor(ref)}
                        className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1 text-xs font-medium text-[var(--color-fg)] hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent)]"
                      >
                        {ref.type === "indent"
                          ? "Open indent"
                          : ref.type === "vendor"
                            ? "View vendors"
                            : "Open"}{" "}
                        · {ref.label}
                      </Link>
                    ))}
                    {m.data.clientActions
                      ?.filter(
                        (a): a is Extract<ClientAction, { type: "download" }> =>
                          a.type === "download"
                      )
                      .map((action) => (
                        <Button
                          key={`${action.url}:${action.filename}`}
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1.5 text-xs"
                          onClick={() => {
                            setStatusLine(`Downloading ${action.filename}…`);
                            void triggerDownload(action)
                              .then(() => setStatusLine(`Downloaded ${action.filename}`))
                              .catch((err) => {
                                setError(err instanceof Error ? err.message : "Download failed.");
                                setStatusLine(null);
                              });
                          }}
                        >
                          <Download className="h-3.5 w-3.5" />
                          Download {action.filename}
                        </Button>
                      ))}
                  </div>
                )}
            </article>
          ))}

          {(busy || statusLine) && (
            <div
              className="mr-auto flex max-w-3xl items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white px-4 py-3 text-sm text-[var(--color-muted)] shadow-[var(--shadow-xs)]"
              aria-busy={busy}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin text-[var(--color-accent)]" /> : null}
              {statusLine ?? "Looking up procurement records…"}
            </div>
          )}

          {pending && (
            <section
              className="max-w-3xl rounded-[var(--radius-lg)] border border-amber-200 bg-[var(--color-warning-soft)] px-4 py-4 text-sm text-[var(--color-fg)]"
              aria-label="Action confirmation"
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-warning)]">
                Confirmation required
              </p>
              <h2 className="mt-1 text-base font-semibold">{pending.preview.title}</h2>
              <p className="mt-1 text-[var(--color-muted)]">
                Target:{" "}
                <span className="font-medium text-[var(--color-fg)]">{pending.preview.target}</span>
              </p>
              <dl className="mt-3 space-y-1.5">
                {pending.preview.details.map((d) => (
                  <div key={d.label} className="flex gap-2">
                    <dt className="w-36 shrink-0 text-[var(--color-muted)]">{d.label}</dt>
                    <dd className="font-medium">{d.value}</dd>
                  </div>
                ))}
              </dl>
              {pending.preview.externalEffect && (
                <p className="mt-3 rounded-[var(--radius-md)] border border-amber-200 bg-amber-100/70 px-3 py-2 text-xs">
                  {pending.preview.externalEffect}
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={confirmBusy}
                  onClick={() => void decide("confirm")}
                >
                  {confirmBusy ? "Working…" : "Confirm"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={confirmBusy}
                  onClick={() => void decide("cancel")}
                >
                  Cancel
                </Button>
              </div>
            </section>
          )}

          {error && (
            <div className="max-w-3xl rounded-[var(--radius-md)] border border-red-200 bg-[var(--color-danger-soft)] px-4 py-3 text-sm text-[var(--color-danger)]">
              <p>{error}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => {
                  setError(null);
                  if (input.trim()) void sendMessage(input);
                }}
              >
                Retry
              </Button>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <form
          className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 md:px-6"
          onSubmit={(e) => {
            e.preventDefault();
            void sendMessage(input);
          }}
        >
          <label htmlFor="copilot-input" className="sr-only">
            Message the Procurement Copilot
          </label>
          <div className="flex items-end gap-2">
            <textarea
              id="copilot-input"
              ref={inputRef}
              rows={2}
              value={input}
              maxLength={2000}
              disabled={busy || !!pending || loadingConversation}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={
                pending
                  ? "Confirm or cancel the pending action first"
                  : "Ask to open, download, edit, or approve…"
              }
              className="min-h-[2.75rem] flex-1 resize-none rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-fg)] outline-none placeholder:text-[var(--color-muted)]/70 focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/25 disabled:opacity-60"
            />
            <Button type="submit" disabled={busy || !!pending || !input.trim() || loadingConversation}>
              <Send className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Send</span>
            </Button>
          </div>
          <p className="mt-1.5 text-xs text-[var(--color-muted)]">
            Enter to send · Shift+Enter for a new line
          </p>
        </form>
      </div>
    </div>
  );
}
