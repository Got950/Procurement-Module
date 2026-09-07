"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { WorkflowTrackerIndex } from "@/lib/procurement-workflow-ui";

export function WorkflowTimeline({
  steps,
  activeIndex,
}: {
  steps: readonly string[];
  activeIndex: WorkflowTrackerIndex;
}) {
  return (
    <div className="proc-workflow-timeline sticky top-[56px] z-30 -mx-4 mb-6 border-y border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 sm:-mx-6 lg:-mx-8 lg:px-6">
      <div className="mx-auto max-w-6xl">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
          Workflow
        </p>
        <div className="flex flex-wrap items-center gap-1 sm:gap-0">
          {steps.map((label, idx) => {
            const done = idx < activeIndex;
            const current = idx === activeIndex;
            return (
              <div key={label} className="flex min-w-0 flex-1 items-center sm:min-w-[80px] sm:flex-1">
                <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                  <motion.div
                    layout
                    className={cn(
                      "relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold transition-colors",
                      done &&
                        "border-[var(--color-accent)]/30 bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
                      current &&
                        "border-[var(--color-accent)] bg-[var(--color-accent)] text-white",
                      !done &&
                        !current &&
                        "border-[var(--color-border)] bg-white text-[var(--color-muted)]"
                    )}
                  >
                    {done ? "✓" : idx + 1}
                  </motion.div>
                  <span
                    className={cn(
                      "hidden max-w-[100px] truncate text-center text-[9px] font-medium uppercase leading-tight tracking-wide sm:block",
                      current ? "text-[var(--color-fg)]" : "text-[var(--color-muted)]"
                    )}
                  >
                    {label.replace(/ /g, "\u00A0")}
                  </span>
                </div>
                {idx < steps.length - 1 ? (
                  <div
                    className={cn(
                      "mx-0.5 hidden h-px min-w-[8px] flex-1 sm:block",
                      idx < activeIndex ? "bg-[var(--color-accent)]/40" : "bg-[var(--color-border)]"
                    )}
                    aria-hidden
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
