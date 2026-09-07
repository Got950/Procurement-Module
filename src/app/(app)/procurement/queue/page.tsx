import Link from "next/link";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { IndentStatus, Role } from "@/lib/domain-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";

const PIPELINE: IndentStatus[] = [
  IndentStatus.PROCUREMENT_ACTIVE,
  IndentStatus.RFQ_SENT,
  IndentStatus.AWAITING_QUOTES,
  IndentStatus.QUOTES_READY,
  IndentStatus.PENDING_TL_VENDOR,
  IndentStatus.PENDING_DIRECTOR,
  IndentStatus.PENDING_MD,
  IndentStatus.PROCUREMENT_PO,
  IndentStatus.PO_DRAFT,
  IndentStatus.PO_SENT,
  IndentStatus.AWAITING_INVOICE,
  IndentStatus.PENDING_FINANCE,
  IndentStatus.PAYMENT_DONE,
];

export default async function ProcurementQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== Role.PROCUREMENT && session.role !== Role.ADMIN) {
    redirect("/dashboard");
  }
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toLowerCase();
  const indents = await prisma.indent.findMany({
    where: { currentStatus: { in: PIPELINE } },
    include: { item: true, requester: { select: { name: true } } },
    orderBy: { updatedAt: "desc" },
  });
  const filtered = q
    ? indents.filter((i) => {
        const hay = [i.reference, i.item.name, i.requester.name, i.currentStatus]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
    : indents;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Procurement queue"
        description="Operational pipeline from RFQ through final invoice upload."
      />
      <form method="get" className="flex flex-wrap items-center gap-2">
        <label htmlFor="queue-search" className="sr-only">
          Search queue
        </label>
        <input
          id="queue-search"
          name="q"
          type="search"
          defaultValue={sp.q ?? ""}
          placeholder="Search reference, item, requester…"
          className="h-9 w-full max-w-sm rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-muted)]"
        />
        <Button type="submit" variant="outline" size="sm">
          Search
        </Button>
        {q ? (
          <Button variant="ghost" size="sm" asChild>
            <Link href="/procurement/queue">Clear</Link>
          </Button>
        ) : null}
      </form>
      <div className="app-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="app-table w-full text-left text-sm">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Item</th>
                <th>Requester</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => (
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="app-empty">
            <p className="text-sm font-medium text-[var(--color-fg)]">
              {q ? "No cases match your search" : "Queue is clear"}
            </p>
            <p className="max-w-sm text-sm text-[var(--color-muted)]">
              {q
                ? "Try a different term, or clear the search."
                : "Active procurement cases will appear here as they enter the pipeline."}
            </p>
            {q ? (
              <Button asChild variant="outline" className="mt-2">
                <Link href="/procurement/queue">Clear search</Link>
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
