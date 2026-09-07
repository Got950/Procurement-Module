import Link from "next/link";
import { cn } from "@/lib/utils";

export const INDENT_PAGE_SIZE = 25;

export function PaginationControls({
  page,
  totalPages,
  total,
  pageSize,
  buildHref,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  buildHref: (page: number) => string;
}) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const prev = page > 1 ? page - 1 : null;
  const next = page < totalPages ? page + 1 : null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] px-4 py-3 text-sm">
      <p className="text-[var(--color-muted)]">
        Showing <span className="tabular-nums text-[var(--color-fg)]">{from}</span>–
        <span className="tabular-nums text-[var(--color-fg)]">{to}</span> of{" "}
        <span className="tabular-nums text-[var(--color-fg)]">{total}</span>
      </p>
      <div className="flex items-center gap-2">
        {prev ? (
          <Link
            href={buildHref(prev)}
            className="inline-flex min-h-9 items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 text-[var(--color-fg)] hover:bg-[var(--color-surface-muted)]"
          >
            Previous
          </Link>
        ) : (
          <span className="inline-flex min-h-9 cursor-not-allowed items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 text-[var(--color-muted)] opacity-50">
            Previous
          </span>
        )}
        <span className="tabular-nums text-[var(--color-muted)]">
          Page {page} / {totalPages}
        </span>
        {next ? (
          <Link
            href={buildHref(next)}
            className="inline-flex min-h-9 items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 text-[var(--color-fg)] hover:bg-[var(--color-surface-muted)]"
          >
            Next
          </Link>
        ) : (
          <span className="inline-flex min-h-9 cursor-not-allowed items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 text-[var(--color-muted)] opacity-50">
            Next
          </span>
        )}
      </div>
    </div>
  );
}

export function paginationHref(
  basePath: string,
  params: Record<string, string | undefined>,
  page: number
) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) sp.set(k, v);
  }
  if (page > 1) sp.set("page", String(page));
  const qs = sp.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export function parsePage(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "1", 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 10_000);
}

export function pageButtonClass(active: boolean) {
  return cn(
    "inline-flex min-h-9 items-center rounded-[var(--radius-sm)] border px-3",
    active
      ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
      : "border-[var(--color-border)] text-[var(--color-fg)] hover:bg-[var(--color-surface-muted)]"
  );
}
