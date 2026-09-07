import type { SessionPayload } from "@/lib/session";
import { AppSidebar } from "@/components/app/app-sidebar";
import { AppTopbar } from "@/components/app/app-topbar";
import { MobileNav } from "@/components/app/mobile-nav";
import { NotificationSoundListener } from "@/components/app/notification-sound-listener";
import { prisma } from "@/lib/db";

export async function AppShell({
  session,
  children,
}: {
  session: SessionPayload;
  children: React.ReactNode;
}) {
  const initialUnread = await prisma.notification.count({
    where: { userId: session.sub, readAt: null },
  });
  return (
    <div className="flex min-h-screen bg-[var(--color-bg)]">
      <NotificationSoundListener role={session.role} initialUnread={initialUnread} />
      <AppSidebar role={session.role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopbar session={session} />
        <MobileNav role={session.role} />
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-7">{children}</main>
      </div>
    </div>
  );
}
