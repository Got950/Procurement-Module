"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SidebarBrand } from "@/components/app/brand-logo";
import type { Role } from "@/lib/domain-types";
import {
  LayoutDashboard,
  FileText,
  Bell,
  CheckCircle,
  Inbox,
  Building2,
  Package,
  FolderOpen,
  Shield,
  Banknote,
  MessageSquare,
} from "lucide-react";
import { getNavForRole } from "@/lib/rbac/policies";
import { cn } from "@/lib/utils";

const iconMap = {
  LayoutDashboard,
  FileText,
  Bell,
  CheckCircle,
  Inbox,
  Building2,
  Package,
  FolderOpen,
  Shield,
  Banknote,
  MessageSquare,
} as const;

function isActivePath(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  const base = href.split("?")[0];
  return pathname === base || pathname.startsWith(`${base}/`);
}

export function AppSidebar({ role }: { role: Role | string }) {
  const pathname = usePathname();
  const links = getNavForRole(role);
  return (
    <aside className="sticky top-0 hidden h-screen w-[var(--sidebar-width)] shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--chrome-bg)] md:flex">
      <div className="flex h-[var(--header-height)] items-center border-b border-[var(--color-border)] px-4">
        <Link href="/dashboard" className="min-w-0" aria-label="MedFlow home">
          <SidebarBrand />
        </Link>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3" aria-label="Main">
        {links.map((l) => {
          const Icon = iconMap[l.icon as keyof typeof iconMap] ?? LayoutDashboard;
          const active = isActivePath(pathname, l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-2 text-[13px] font-medium transition-colors",
                active
                  ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                  : "text-[var(--color-fg)]/75 hover:bg-[var(--color-bg-2)] hover:text-[var(--color-fg)]"
              )}
            >
              {active ? (
                <span
                  className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-[var(--color-accent)]"
                  aria-hidden
                />
              ) : null}
              <Icon
                className={cn(
                  "h-4 w-4 shrink-0",
                  active ? "text-[var(--color-accent)]" : "text-[var(--color-muted)] group-hover:text-[var(--color-fg)]"
                )}
              />
              {l.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
