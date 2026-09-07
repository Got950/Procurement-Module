import Link from "next/link";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { IndentStatus, Role } from "@/lib/domain-types";
import { indentListWhere } from "@/lib/indent-access";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/page-header";
import {
  INDENT_PAGE_SIZE,
  PaginationControls,
  paginationHref,
  parsePage,
} from "@/components/app/pagination-controls";
import { formatCurrency } from "@/lib/utils";

export default async function IndentsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string; page?: string }>;
}) {
  const session = await getSession();
  if (!session) return null;
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const page = parsePage(sp.page);
  let extra: { currentStatus?: IndentStatus | { in: IndentStatus[] } } = {};
  if (session.role === Role.REQUESTER && sp.filter === "draft") {
    extra = { currentStatus: IndentStatus.DRAFT };
  }
  if (session.role === Role.REQUESTER && sp.filter === "rejected") {
    extra = {
      currentStatus: {
        in: [
          IndentStatus.REJECTED_TL_INDENT,
          IndentStatus.REJECTED_TL_VENDOR,
          IndentStatus.REJECTED_DIRECTOR,
          IndentStatus.REJECTED_MD,
        ],
      },
    };
  }

  let searchClause: Record<string, unknown> = {};
  if (q) {
    const qLower = q.toLowerCase();
    const [allItems, allUsers] = await Promise.all([
      prisma.item.findMany({}),
      prisma.user.findMany({}),
    ]);
    const itemIds = allItems
      .filter((it: { name: string; sku?: string }) => {
        return (
          it.name.toLowerCase().includes(qLower) ||
          String(it.sku ?? "")
            .toLowerCase()
            .includes(qLower)
        );
      })
      .map((it: { id: string }) => it.id);
    const requesterIds = allUsers
      .filter((u: { name: string }) => u.name.toLowerCase().includes(qLower))
      .map((u: { id: string }) => u.id);
    const statusNeedle = q.replace(/\s+/g, "_").toUpperCase();
    const orBranches: Record<string, unknown>[] = [
      { reference: { contains: q, mode: "insensitive" } },
      { currentStatus: { contains: statusNeedle, mode: "insensitive" } },
    ];
    if (itemIds.length) orBranches.push({ itemId: { in: itemIds } });
    if (requesterIds.length) orBranches.push({ requesterId: { in: requesterIds } });
    searchClause = { OR: orBranches };
  }

  const where = { ...indentListWhere(session.role, session.sub), ...extra, ...searchClause };
  const total = await prisma.indent.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / INDENT_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const indents = await prisma.indent.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: INDENT_PAGE_SIZE,
    skip: (safePage - 1) * INDENT_PAGE_SIZE,
    include: { item: true, requester: { select: { name: true } } },
  });

  const buildHref = (p: number) =>
    paginationHref("/indents", { filter: sp.filter, q: q || undefined }, p);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Indents"
        description="Procurement cases and status."
        actions={
          session.role === Role.REQUESTER || session.role === Role.ADMIN ? (
            <Button asChild>
              <Link href="/indents/new">Raise indent</Link>
            </Button>
          ) : undefined
        }
      />
      <form method="get" className="flex flex-wrap items-center gap-2">
        {sp.filter ? <input type="hidden" name="filter" value={sp.filter} /> : null}
        <label htmlFor="indent-search" className="sr-only">
          Search indents
        </label>
        <input
          id="indent-search"
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Search reference, item, requester…"
          className="h-9 w-full max-w-sm rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-muted)]"
        />
        <Button type="submit" variant="outline" size="sm">
          Search
        </Button>
        {q ? (
          <Button variant="ghost" size="sm" asChild>
            <Link href={sp.filter ? `/indents?filter=${encodeURIComponent(sp.filter)}` : "/indents"}>
              Clear
            </Link>
          </Button>
        ) : null}
      </form>
      <div className="app-surface overflow-hidden">
        {/* Mobile: stacked rows */}
        <div className="divide-y divide-[var(--color-border)] md:hidden">
          {indents.map((i) => (
            <Link
              key={i.id}
              href={`/indents/${i.id}`}
              className="flex flex-col gap-2 px-4 py-3.5 transition-colors hover:bg-[var(--color-surface-muted)]"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-[var(--color-accent)]">{i.reference}</span>
                <Badge variant="accent">{i.currentStatus.replace(/_/g, " ")}</Badge>
              </div>
              <p className="text-sm text-[var(--color-fg)]">{i.item.name}</p>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-muted)]">
                <span>{i.requester.name}</span>
                <span className="tabular-nums">
                  {i.estimatedAmount != null ? formatCurrency(Number(i.estimatedAmount)) : "—"}
                </span>
              </div>
            </Link>
          ))}
        </div>
        {/* Desktop: table with reliable horizontal scroll */}
        <div className="hidden overflow-x-auto md:block">
          <table className="app-table w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Item</th>
                <th>Requester</th>
                <th>Status</th>
                <th className="text-right">Est.</th>
              </tr>
            </thead>
            <tbody>
              {indents.map((i) => (
                <tr key={i.id}>
                  <td>
                    <Link
                      href={`/indents/${i.id}`}
                      className="font-medium text-[var(--color-accent)] hover:underline"
                    >
                      {i.reference}
                    </Link>
                  </td>
                  <td className="max-w-[200px] truncate text-[var(--color-fg)]" title={i.item.name}>
                    {i.item.name}
                  </td>
                  <td className="text-[var(--color-muted)]">{i.requester.name}</td>
                  <td>
                    <Badge variant="accent">{i.currentStatus.replace(/_/g, " ")}</Badge>
                  </td>
                  <td className="text-right tabular-nums text-[var(--color-fg)]">
                    {i.estimatedAmount != null ? formatCurrency(Number(i.estimatedAmount)) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {indents.length === 0 && (
          <div className="app-empty">
            <p className="text-sm font-medium text-[var(--color-fg)]">
              {q ? "No indents match your search" : "No indents match your view"}
            </p>
            <p className="max-w-sm text-sm text-[var(--color-muted)]">
              {q
                ? "Try a different term, or clear the search."
                : session.role === Role.REQUESTER || session.role === Role.ADMIN
                  ? "Create your first indent to start a procurement case."
                  : "When cases are assigned to your queue, they will show up here."}
            </p>
            {q ? (
              <Button asChild variant="outline" className="mt-2">
                <Link href={sp.filter ? `/indents?filter=${encodeURIComponent(sp.filter)}` : "/indents"}>
                  Clear search
                </Link>
              </Button>
            ) : null}
            {!q && (session.role === Role.REQUESTER || session.role === Role.ADMIN) && (
              <Button asChild className="mt-2">
                <Link href="/indents/new">Raise indent</Link>
              </Button>
            )}
          </div>
        )}
        {indents.length > 0 ? (
          <PaginationControls
            page={safePage}
            totalPages={totalPages}
            total={total}
            pageSize={INDENT_PAGE_SIZE}
            buildHref={buildHref}
          />
        ) : null}
      </div>
    </div>
  );
}
