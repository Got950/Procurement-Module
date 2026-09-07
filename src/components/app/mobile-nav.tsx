"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/domain-types";
import { getNavForRole, type NavLink } from "@/lib/rbac/policies";
import { cn } from "@/lib/utils";
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
  MoreHorizontal,
} from "lucide-react";

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

/** Primary destinations kept in the strip; remaining links live under More. */
const PRIMARY_CAP = 5;

function isActivePath(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  const base = href.split("?")[0];
  return pathname === base || pathname.startsWith(`${base}/`);
}

function NavItem({
  link,
  active,
  onNavigate,
}: {
  link: NavLink;
  active: boolean;
  onNavigate?: () => void;
}) {
  const Icon = iconMap[link.icon as keyof typeof iconMap] ?? LayoutDashboard;
  return (
    <Link
      href={link.href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={cn(
        "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 py-2 text-xs font-medium transition-colors",
        active
          ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
          : "text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-fg)]"
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {link.label}
    </Link>
  );
}

export function MobileNav({ role }: { role: Role | string }) {
  const pathname = usePathname();
  const links = getNavForRole(role);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  const primary = links.slice(0, PRIMARY_CAP);
  const overflow = links.slice(PRIMARY_CAP);
  const overflowActive = overflow.some((l) => isActivePath(pathname, l.href));

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    const onPointer = (e: MouseEvent | TouchEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  return (
    <nav
      className="border-b border-[var(--color-border)] bg-[var(--color-surface)] md:hidden"
      aria-label="Mobile"
    >
      <div className="flex items-stretch gap-0.5 px-2 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {primary.map((l) => (
            <NavItem key={l.href} link={l} active={isActivePath(pathname, l.href)} />
          ))}
        </div>
        {overflow.length > 0 ? (
          <div className="relative shrink-0" ref={moreRef}>
            <button
              type="button"
              aria-expanded={moreOpen}
              aria-haspopup="menu"
              aria-label="More navigation"
              onClick={() => setMoreOpen((o) => !o)}
              className={cn(
                "inline-flex min-h-10 items-center gap-1 rounded-[var(--radius-sm)] px-2.5 py-2 text-xs font-medium transition-colors",
                overflowActive || moreOpen
                  ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                  : "text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-fg)]"
              )}
            >
              <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
              More
            </button>
            {moreOpen ? (
              <div
                role="menu"
                className="absolute right-0 top-full z-40 mt-1 min-w-[12rem] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-[var(--shadow-sm)]"
              >
                {overflow.map((l) => {
                  const active = isActivePath(pathname, l.href);
                  const Icon = iconMap[l.icon as keyof typeof iconMap] ?? LayoutDashboard;
                  return (
                    <Link
                      key={l.href}
                      role="menuitem"
                      href={l.href}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setMoreOpen(false)}
                      className={cn(
                        "flex min-h-11 items-center gap-2 px-3 py-2.5 text-sm",
                        active
                          ? "bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent)]"
                          : "text-[var(--color-fg)] hover:bg-[var(--color-surface-muted)]"
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden />
                      {l.label}
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </nav>
  );
}
