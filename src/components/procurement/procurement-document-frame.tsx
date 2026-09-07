"use client";

import { formatDisplayDateTime } from "@/lib/format-date";

export function ProcurementDocumentFrame({
  reference,
  createdAt,
  children,
  eyebrow = "Purchase indent form",
}: {
  reference: string;
  createdAt?: string;
  children: React.ReactNode;
  /** Small caps label above the reference (title). */
  eyebrow?: string;
}) {
  return (
    <div className="mx-auto max-w-5xl">
      <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-doc-paper)] shadow-[var(--shadow-xs)]">
        <div className="px-4 py-6 sm:px-8 sm:py-8">
          <header className="mb-8 flex flex-col gap-4 border-b border-[var(--color-border)] pb-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-muted)]">
                {eyebrow}
              </p>
              <h1 className="mt-1 font-mono text-xl font-semibold tracking-tight text-[var(--color-fg)] sm:text-2xl">
                {reference}
              </h1>
            </div>
            {createdAt ? (
              <p className="font-mono text-sm text-[var(--color-muted)] sm:text-right">
                {formatDisplayDateTime(createdAt)}
              </p>
            ) : null}
          </header>
          <div className="space-y-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
