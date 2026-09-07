import Link from "next/link";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { IndentStatus, Role } from "@/lib/domain-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";

export default async function FinancePaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== Role.FINANCE && session.role !== Role.ADMIN) {
    redirect("/dashboard");
  }
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toLowerCase();
  const indents = await prisma.indent.findMany({
    where: {
      currentStatus: { in: [IndentStatus.PENDING_FINANCE, IndentStatus.PENDING_FINANCE_FINAL] },
    },
    include: { item: true, purchaseOrders: true, invoices: true, payments: true },
    orderBy: { updatedAt: "desc" },
  });
  const filtered = q
    ? indents.filter((i) => {
        const hay = [
          i.reference,
          i.item.name,
          i.currentStatus,
          ...i.invoices.map((inv) => inv.vendorName),
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
    : indents;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Finance workspace"
        description="Review proforma and accounts, then final vendor invoice."
      />
      <form method="get" className="flex flex-wrap items-center gap-2">
        <label htmlFor="payments-search" className="sr-only">
          Search payments
        </label>
        <input
          id="payments-search"
          name="q"
          type="search"
          defaultValue={sp.q ?? ""}
          placeholder="Search reference, item, vendor…"
          className="h-9 w-full max-w-sm rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-muted)]"
        />
        <Button type="submit" variant="outline" size="sm">
          Search
        </Button>
        {q ? (
          <Button variant="ghost" size="sm" asChild>
            <Link href="/finance/payments">Clear</Link>
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
                <th>Documents</th>
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
                  <td className="text-[12px] text-[var(--color-muted)]">
                    POs: {i.purchaseOrders.length} · Invoices: {i.invoices.length} · Payments:{" "}
                    {i.payments.length}
                  </td>
                  <td>
                    <Badge
                      variant={
                        i.currentStatus === "PENDING_FINANCE"
                          ? "warning"
                          : i.currentStatus === "PENDING_FINANCE_FINAL"
                            ? "accent"
                            : "success"
                      }
                    >
                      {i.currentStatus.replace(/_/g, " ")}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="app-empty">
            <p className="text-sm font-medium text-[var(--color-fg)]">
              {q ? "No payment cases match your search" : "No payment cases"}
            </p>
            <p className="max-w-sm text-sm text-[var(--color-muted)]">
              {q
                ? "Try a different term, or clear the search."
                : "Cases awaiting finance review will show up here."}
            </p>
            {q ? (
              <Button asChild variant="outline" className="mt-2">
                <Link href="/finance/payments">Clear search</Link>
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
