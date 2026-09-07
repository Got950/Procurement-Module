"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { motion } from "framer-motion";
import type { Item } from "@/lib/domain-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProcurementDocumentFrame } from "@/components/procurement/procurement-document-frame";

export function NewIndentForm({
  items,
  requesterName,
  previewReference,
}: {
  items: Item[];
  requesterName: string;
  /** Next IND-YYYY-#### if you save now (same logic as server create). */
  previewReference: string;
}) {
  const router = useRouter();
  const [itemId, setItemId] = useState(items[0]?.id ?? "");
  const [quantity, setQuantity] = useState("1");
  const [priority, setPriority] = useState("NORMAL");
  const [justification, setJustification] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedItem = items.find((i) => i.id === itemId);
  const docStamp = new Date().toISOString();
  const qty = Number(quantity);
  const quantityValid = Number.isFinite(qty) && qty > 0;
  const canSubmit = Boolean(itemId && justification.trim() && quantityValid && !loading);

  async function createIndent(andSubmit: boolean) {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/indents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId,
          quantity: qty,
          priority,
          justification,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        indent?: { id: string };
      };
      if (!res.ok || !j.indent?.id) {
        throw new Error(j.error ?? "Could not save indent.");
      }
      if (andSubmit) {
        const submitRes = await fetch(`/api/indents/${j.indent.id}/submit`, { method: "POST" });
        const submitBody = (await submitRes.json().catch(() => ({}))) as { error?: string };
        if (!submitRes.ok) {
          // Draft exists — send user to it with a clear message via redirect
          router.push(`/indents/${j.indent.id}`);
          throw new Error(submitBody.error ?? "Draft saved, but sending for review failed.");
        }
      }
      router.push(`/indents/${j.indent.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <ProcurementDocumentFrame reference={previewReference} createdAt={docStamp}>
        <div className="mb-6 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
            Indent Request Form
          </p>
          <p className="mt-1 text-sm text-[var(--color-fg)]">
            Requester: <span className="font-medium">{requesterName}</span>
          </p>
        </div>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="indent-item">Name of item</Label>
            {items.length === 0 ? (
              <p className="rounded-[var(--radius-md)] border border-[var(--color-warning)]/40 bg-[var(--color-warning-soft)] px-3 py-2 text-sm text-[var(--color-fg)]">
                No items in the catalog yet. Ask an admin to add items, or run{" "}
                <code className="text-xs">npm run db:seed-items</code> locally.
              </p>
            ) : (
              <select
                id="indent-item"
                className="flex h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-fg)]"
                value={itemId}
                onChange={(e) => setItemId(e.target.value)}
              >
                {items.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.name} ({it.sku})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="indent-quantity">Quantity</Label>
              <Input
                id="indent-quantity"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                type="number"
                min={0.0001}
                step="any"
                aria-invalid={!quantityValid}
              />
              {!quantityValid ? (
                <p className="text-xs text-[var(--color-danger)]">Enter a quantity greater than zero.</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label id="indent-priority-label">Priority</Label>
              <div
                className="flex flex-wrap gap-2 pt-1"
                role="group"
                aria-labelledby="indent-priority-label"
              >
                {(
                  [
                    { v: "HIGH", label: "High", cls: "border-red-200 bg-[var(--color-danger-soft)] text-[var(--color-danger)]" },
                    {
                      v: "NORMAL",
                      label: "Medium",
                      cls: "border-amber-200 bg-[var(--color-warning-soft)] text-[var(--color-warning)]",
                    },
                    {
                      v: "LOW",
                      label: "Low",
                      cls: "border-[var(--color-border)] bg-[var(--color-surface-muted)] text-[var(--color-fg)]",
                    },
                  ] as const
                ).map((p) => (
                  <button
                    key={p.v}
                    type="button"
                    aria-pressed={priority === p.v}
                    onClick={() => setPriority(p.v)}
                    className={`rounded-[var(--radius-sm)] border px-3 py-1.5 text-xs font-medium transition-colors ${
                      priority === p.v
                        ? `${p.cls} ring-2 ring-[var(--color-accent)]/20`
                        : "border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)]"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Specifications</Label>
            <div
              className={`min-h-[72px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm leading-relaxed ${
                selectedItem?.specNotes?.trim()
                  ? "text-[var(--color-fg)]"
                  : "text-[var(--color-muted)]"
              }`}
            >
              {!itemId
                ? "Select an item to load its catalog specifications."
                : selectedItem?.specNotes?.trim()
                  ? selectedItem.specNotes
                  : "No specifications recorded for this item in the catalog."}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="indent-justification">Reason for acquiring product</Label>
            <textarea
              id="indent-justification"
              className="min-h-[120px] w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-muted)]/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/25"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Regulatory context, batch, timeline…"
              required
            />
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-[var(--radius-md)] border border-red-200 bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]"
            >
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-3 border-t border-[var(--color-border)] pt-5">
            <Button
              disabled={!canSubmit}
              variant="outline"
              onClick={() => void createIndent(false)}
            >
              {loading ? "Saving…" : "Save draft"}
            </Button>
            <Button disabled={!canSubmit} onClick={() => void createIndent(true)}>
              {loading ? "Sending…" : "Send"}
            </Button>
          </div>
        </div>
      </ProcurementDocumentFrame>
    </motion.div>
  );
}
