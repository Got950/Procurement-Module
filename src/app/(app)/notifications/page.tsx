import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { MarkReadButton } from "./mark-read-button";

export default async function NotificationsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const notifications = await prisma.notification.findMany({
    where: { userId: session.sub },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { indent: { select: { id: true, reference: true } } },
  });
  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="State changes and approval prompts."
        actions={<MarkReadButton />}
      />
      <div className="app-surface divide-y divide-[var(--color-border)] overflow-hidden">
        {notifications.map((n) => (
          <div
            key={n.id}
            className={`px-5 py-4 ${n.readAt ? "opacity-60" : "bg-[var(--color-accent-soft)]/40"}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  {!n.readAt ? (
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)]"
                      aria-hidden
                    />
                  ) : null}
                  <div className="font-medium text-[var(--color-fg)]">{n.title}</div>
                </div>
                <p className="mt-1 text-sm text-[var(--color-muted)]">{n.body}</p>
                <div className="mt-2 flex flex-wrap gap-3">
                  {n.actionUrl && (
                    <a
                      href={String(n.actionUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block text-xs font-medium text-[var(--color-accent)] hover:underline"
                    >
                      Open in Gmail
                    </a>
                  )}
                  {n.indent && (
                    <Link
                      href={`/indents/${n.indent.id}`}
                      className="inline-block text-xs font-medium text-[var(--color-accent)] hover:underline"
                    >
                      Open case {n.indent.reference}
                    </Link>
                  )}
                </div>
              </div>
              <span className="text-xs text-[var(--color-muted)]">
                {new Date(n.createdAt).toLocaleString()}
              </span>
            </div>
          </div>
        ))}
        {notifications.length === 0 && (
          <div className="app-empty">
            <p className="text-sm font-medium text-[var(--color-fg)]">You are all caught up</p>
            <p className="max-w-sm text-sm text-[var(--color-muted)]">
              Approvals, vendor mail, and status changes will appear here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
