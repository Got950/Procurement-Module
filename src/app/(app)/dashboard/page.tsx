import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { Role, IndentStatus, NotificationType } from "@/lib/domain-types";
import { executiveObserveWhere } from "@/lib/director-indent-filters";
import { indentListWhere } from "@/lib/indent-access";
import Link from "next/link";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/page-header";
import { formatCurrency } from "@/lib/utils";

async function statsFor(role: Role, userId: string) {
  if (role === Role.REQUESTER) {
    const [drafts, pending, rejected] = await Promise.all([
      prisma.indent.count({ where: { requesterId: userId, currentStatus: IndentStatus.DRAFT } }),
      prisma.indent.count({
        where: {
          requesterId: userId,
          currentStatus: {
            notIn: [
              IndentStatus.DRAFT,
              IndentStatus.REJECTED_TL_INDENT,
              IndentStatus.REJECTED_TL_VENDOR,
              IndentStatus.REJECTED_DIRECTOR,
              IndentStatus.REJECTED_MD,
              IndentStatus.CLOSED,
            ],
          },
        },
      }),
      prisma.indent.count({
        where: {
          requesterId: userId,
          currentStatus: {
            in: [
              IndentStatus.REJECTED_TL_INDENT,
              IndentStatus.REJECTED_TL_VENDOR,
              IndentStatus.REJECTED_DIRECTOR,
              IndentStatus.REJECTED_MD,
            ],
          },
        },
      }),
    ]);
    return [
      { label: "Drafts", value: String(drafts), href: "/indents?filter=draft" },
      { label: "In flight", value: String(pending), href: "/indents" },
      { label: "Rejected", value: String(rejected), href: "/indents?filter=rejected" },
    ];
  }
  if (role === Role.TEAM_LEADER) {
    const n = await prisma.indent.count({
      where: {
        currentStatus: {
          in: [IndentStatus.PENDING_TL_INDENT, IndentStatus.PENDING_TL_VENDOR],
        },
      },
    });
    return [{ label: "Team Lead queue", value: String(n), href: "/approvals" }];
  }
  if (role === Role.PROCUREMENT || role === Role.ADMIN) {
    const q = await prisma.indent.count({
      where: {
        currentStatus: {
          in: [
            IndentStatus.PROCUREMENT_ACTIVE,
            IndentStatus.RFQ_SENT,
            IndentStatus.AWAITING_QUOTES,
            IndentStatus.QUOTES_READY,
            IndentStatus.PROCUREMENT_PO,
            IndentStatus.PO_DRAFT,
          ],
        },
      },
    });
    return [
      { label: "Active cases", value: String(q), href: "/procurement/queue" },
      { label: "Vendors", value: String(await prisma.vendor.count()), href: "/vendors" },
    ];
  }
  if (role === Role.DIRECTOR) {
    const [pending, observe] = await Promise.all([
      prisma.indent.count({ where: { currentStatus: IndentStatus.PENDING_DIRECTOR } }),
      prisma.indent.count({ where: executiveObserveWhere() }),
    ]);
    return [
      { label: "Awaiting approval", value: String(pending), href: "/approvals?stage=director" },
      { label: "View only (≤50k)", value: String(observe), href: "/indents" },
    ];
  }
  if (role === Role.MD) {
    const [pending, observe] = await Promise.all([
      prisma.indent.count({ where: { currentStatus: IndentStatus.PENDING_MD } }),
      prisma.indent.count({ where: executiveObserveWhere() }),
    ]);
    return [
      { label: "Awaiting approval", value: String(pending), href: "/approvals?stage=md" },
      { label: "View only (≤50k)", value: String(observe), href: "/indents" },
    ];
  }
  if (role === Role.FINANCE) {
    const n = await prisma.indent.count({
      where: { currentStatus: { in: [IndentStatus.PENDING_FINANCE, IndentStatus.PENDING_FINANCE_FINAL] } },
    });
    return [{ label: "Pending payments", value: String(n), href: "/finance/payments" }];
  }
  return [];
}

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) return null;
  const cards = await statsFor(session.role, session.sub);
  // Same authorization boundary as GET /api/indents — never org-wide for
  // TEAM_LEADER / FINANCE / unknown roles.
  const recent = await prisma.indent.findMany({
    where: indentListWhere(session.role, session.sub),
    take: 5,
    orderBy: { updatedAt: "desc" },
    include: { item: true, requester: { select: { name: true } } },
  });
  let inboxAlerts: Awaited<ReturnType<typeof prisma.notification.findMany>> = [];
  if (session.role === Role.PROCUREMENT || session.role === Role.ADMIN) {
    try {
      const fiveDaysAgo = Date.now() - 5 * 86400000;
      const raw = await prisma.notification.findMany({
        where: {
          userId: session.sub,
          type: NotificationType.VENDOR_GMAIL,
        },
        orderBy: { createdAt: "desc" },
        take: 40,
        include: { indent: { select: { id: true, reference: true } } },
      });
      inboxAlerts = raw
        .filter(
          (n) =>
            n.indentId &&
            n.indent &&
            new Date(String(n.createdAt)).getTime() >= fiveDaysAgo
        )
        .slice(0, 8);
    } catch {
      inboxAlerts = [];
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Overview"
        description={`Welcome back, ${session.name}. Signed in as ${session.role.replace(/_/g, " ").toLowerCase()}.`}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Link key={c.label} href={c.href} className="block focus-visible:rounded-[var(--radius-lg)]">
            <Card className="h-full transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-muted)]/40">
              <CardDescription>{c.label}</CardDescription>
              <CardTitle className="mt-2 text-3xl tabular-nums tracking-tight">
                {c.value}
              </CardTitle>
            </Card>
          </Link>
        ))}
      </div>
      {(session.role === Role.PROCUREMENT || session.role === Role.ADMIN) && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-[var(--color-fg)]">
            Case mail alerts
          </h2>
          <p className="text-[13px] text-[var(--color-muted)]">Last 5 days</p>
          {inboxAlerts.length > 0 ? (
            <div className="app-surface divide-y divide-[var(--color-border)] overflow-hidden">
              {inboxAlerts.map((n) => (
                <div key={n.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <div className="font-medium text-[var(--color-fg)]">{n.title}</div>
                    <p className="mt-1 line-clamp-2 text-sm text-[var(--color-muted)]">{n.body}</p>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs">
                      {n.actionUrl && (
                        <a
                          href={String(n.actionUrl)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-[var(--color-accent)] hover:underline"
                        >
                          Open in Gmail
                        </a>
                      )}
                      {n.indent && (
                        <Link
                          href={`/indents/${n.indent.id}`}
                          className="font-medium text-[var(--color-accent)] hover:underline"
                        >
                          Case {n.indent.reference}
                        </Link>
                      )}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-[var(--color-muted)]">
                    {new Date(n.createdAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="app-surface px-4 py-3 text-sm text-[var(--color-muted)]">
              No case-linked alerts in the last 5 days. Full thread replies for each indent are under{" "}
              <span className="font-medium text-[var(--color-fg)]">Vendor replies (last 5 days)</span> on that indent&apos;s page.
              Use <span className="font-medium text-[var(--color-fg)]">Sync Gmail</span> in the header so notifications stay current.
            </p>
          )}
          <p className="text-xs text-[var(--color-muted)]">
            Open the case from Queue or Indents:{" "}
            <span className="font-medium text-[var(--color-fg)]">Vendor replies (last 5 days)</span> lists mail for that indent only,
            including attachment downloads.
          </p>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-[var(--color-fg)]">Recent indents</h2>
        <div className="app-surface divide-y divide-[var(--color-border)] overflow-hidden">
          {recent.length === 0 ? (
            <div className="app-empty">
              <p className="text-sm font-medium text-[var(--color-fg)]">No indents yet</p>
              <p className="max-w-sm text-sm text-[var(--color-muted)]">
                Cases you can access will appear here as they are created.
              </p>
            </div>
          ) : (
            recent.map((ind) => (
              <Link
                key={ind.id}
                href={`/indents/${ind.id}`}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-[var(--color-accent-soft)]/50"
              >
                <div>
                  <div className="font-medium text-[var(--color-fg)]">{ind.reference}</div>
                  <div className="text-xs text-[var(--color-muted)]">
                    {ind.item.name} · {ind.requester.name}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {ind.estimatedAmount != null && (
                    <span className="text-sm text-[var(--color-fg)]">
                      {formatCurrency(Number(ind.estimatedAmount))}
                    </span>
                  )}
                  <Badge variant="accent">{ind.currentStatus.replace(/_/g, " ")}</Badge>
                </div>
              </Link>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
