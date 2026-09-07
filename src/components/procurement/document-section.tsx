"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

export function DocumentSection({
  title,
  subtitle,
  badge,
  defaultOpen = true,
  readOnly = false,
  children,
}: {
  title: string;
  subtitle?: string;
  badge?: string;
  defaultOpen?: boolean;
  readOnly?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <motion.section
      layout
      className={cn(
        "proc-doc-section overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] shadow-[var(--shadow-xs)]",
        readOnly ? "bg-[var(--color-surface-muted)]" : "bg-[var(--color-surface)]"
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4 text-left transition-colors hover:bg-[var(--color-surface-muted)]/70"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold tracking-tight text-[var(--color-fg)]">{title}</h2>
            {badge ? (
              <span className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                {badge}
              </span>
            ) : null}
            {readOnly ? (
              <span className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-white px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                Read only
              </span>
            ) : (
              <span className="rounded-[var(--radius-sm)] border border-blue-200/70 bg-[var(--color-accent-soft)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-accent)]">
                Active
              </span>
            )}
          </div>
          {subtitle ? <p className="mt-1 text-xs text-[var(--color-muted)]">{subtitle}</p> : null}
        </div>
        <ChevronDown
          className={cn(
            "mt-0.5 h-4 w-4 shrink-0 text-[var(--color-muted)] transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className={cn("space-y-4 px-5 py-5", readOnly && "opacity-[0.92]")}>
              {children}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.section>
  );
}
