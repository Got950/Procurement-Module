import Link from "next/link";
import type { SessionPayload } from "@/lib/session";
import type { Role } from "@/lib/domain-types";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/db";
import { GmailSyncButton } from "@/components/app/gmail-sync-button";
import { UserMenu } from "@/components/app/user-menu";

export async function AppTopbar({
  session,
}: {
  session: SessionPayload;
  /** @deprecated kept for call-site compatibility; profile menu owns sign-out */
  logout?: React.ReactNode;
}) {
  const unread = await prisma.notification.count({
    where: { userId: session.sub, readAt: null },
  });
  return (
    <header className="sticky top-0 z-40 h-[var(--header-height)] border-b border-[var(--color-border)] bg-[var(--color-surface)]/95 backdrop-blur-sm">
      <div className="flex h-full items-center justify-between gap-3 px-4 lg:px-6">
        <div className="min-w-0 md:hidden">
          <div className="truncate text-[13px] font-semibold tracking-[0.08em] text-[var(--color-fg)]">
            MedFlow
          </div>
        </div>
        <div className="hidden min-w-0 flex-1 md:block">
          <p className="truncate text-sm text-[var(--color-muted)]">
            Pharmaceutical procurement workspace
          </p>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          {(session.role === "PROCUREMENT" || session.role === "ADMIN") && (
            <GmailSyncButton canManageMailbox={session.role === "ADMIN"} />
          )}
          <Button
            variant="ghost"
            size="icon"
            asChild
            className="relative text-[var(--color-muted)] hover:text-[var(--color-fg)]"
          >
            <Link href="/notifications" aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}>
              <Bell className="h-[18px] w-[18px]" />
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-accent)] px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-white">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </Link>
          </Button>
          <div className="mx-0.5 hidden h-6 w-px bg-[var(--color-border)] sm:block" />
          <UserMenu name={session.name} role={session.role as Role} />
        </div>
      </div>
    </header>
  );
}
