import Link from "next/link";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { IndentStatus, Role } from "@/lib/domain-types";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/page-header";
import { formatCurrency } from "@/lib/utils";

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const sp = await searchParams;
  // Stage query only applies for the matching role (or Admin overview) — never overrides another role's queue
  const directorStage = sp.stage === "director" && (session.role === Role.DIRECTOR || session.role === Role.ADMIN);
  const mdStage = sp.stage === "md" && (session.role === Role.MD || session.role === Role.ADMIN);
  const allowed =
    session.role === Role.TEAM_LEADER ||
    session.role === Role.DIRECTOR ||
    session.role === Role.MD ||
    session.role === Role.ADMIN;
  if (!allowed) redirect("/dashboard");

  let title = "Team Lead queue";
  let subtitle = "Review and decide with mandatory remarks.";
  let statuses: IndentStatus[] = [
    IndentStatus.PENDING_TL_INDENT,
    IndentStatus.PENDING_TL_VENDOR,
  ];

  if (session.role === Role.MD || mdStage) {
    title = "MD approval queue";
    subtitle = "Cases above ₹5,00,000 after Director sign-off.";
    statuses = [IndentStatus.PENDING_MD];
  } else if (session.role === Role.DIRECTOR || directorStage) {
    title = "Director approval queue";
    subtitle = "Vendor selections requiring your sign-off (budget above ₹50,000).";
    statuses = [IndentStatus.PENDING_DIRECTOR];
  } else if (session.role === Role.ADMIN) {
    title = "All approval queues";
    subtitle = "Pending Team Lead, Director, and MD decisions.";
    statuses = [
      IndentStatus.PENDING_TL_INDENT,
      IndentStatus.PENDING_TL_VENDOR,
      IndentStatus.PENDING_DIRECTOR,
      IndentStatus.PENDING_MD,
    ];
  }

  const indents = await prisma.indent.findMany({
    where: { currentStatus: { in: statuses } },
    include: { item: true, requester: { select: { name: true } } },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <PageHeader title={title} description={subtitle} />
      <div className="app-surface divide-y divide-[var(--color-border)] overflow-hidden">
        {indents.map((i) => (
          <Link
            key={i.id}
            href={`/indents/${i.id}`}
            className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-[var(--color-accent-soft)]/50"
          >
            <div>
              <div className="font-medium text-[var(--color-fg)]">{i.reference}</div>
              <div className="text-xs text-[var(--color-muted)]">
                {i.item.name} · {i.requester.name}
                {i.approvalBudgetAmount != null
                  ? ` · ${formatCurrency(Number(i.approvalBudgetAmount))}`
                  : i.estimatedAmount != null
                    ? ` · est. ${formatCurrency(Number(i.estimatedAmount))}`
                    : ""}
              </div>
            </div>
            <Badge variant="warning">{i.currentStatus.replace(/_/g, " ")}</Badge>
          </Link>
        ))}
        {indents.length === 0 && (
          <div className="app-empty">
            <p className="text-sm font-medium text-[var(--color-fg)]">No pending approvals</p>
            <p className="max-w-sm text-sm text-[var(--color-muted)]">
              Cases waiting for your decision will appear here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
