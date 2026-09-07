"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, LogOut, Settings } from "lucide-react";
import type { Role } from "@/lib/domain-types";
import { cn } from "@/lib/utils";

function roleLabel(r: Role | string) {
  return String(r).replace(/_/g, " ");
}

export function UserMenu({
  name,
  role,
}: {
  name: string;
  role: Role | string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await fetch("/api/session", { method: "DELETE" });
      router.push("/login");
      router.refresh();
    } finally {
      setSigningOut(false);
      setOpen(false);
    }
  };

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "U";

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-2 rounded-[var(--radius-md)] border border-transparent px-1.5 py-1 text-left transition-colors",
          "hover:border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]",
          open && "border-[var(--color-border)] bg-[var(--color-surface-muted)]"
        )}
      >
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-[11px] font-semibold text-[var(--color-accent)]"
          aria-hidden
        >
          {initials}
        </span>
        <span className="hidden min-w-0 sm:block">
          <span className="block truncate text-sm font-medium leading-tight text-[var(--color-fg)]">
            {name}
          </span>
          <span className="block truncate text-[11px] capitalize leading-tight text-[var(--color-muted)]">
            {roleLabel(role).toLowerCase()}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "hidden h-3.5 w-3.5 shrink-0 text-[var(--color-muted)] sm:block",
            open && "rotate-180"
          )}
        />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1.5 w-56 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-[var(--shadow-md)]"
        >
          <div className="border-b border-[var(--color-border)] px-3 py-2.5 sm:hidden">
            <div className="text-sm font-medium text-[var(--color-fg)]">{name}</div>
            <div className="text-[11px] capitalize text-[var(--color-muted)]">
              {roleLabel(role).toLowerCase()}
            </div>
          </div>
          <Link
            href="/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[var(--color-fg)] hover:bg-[var(--color-accent-soft)]"
          >
            <Settings className="h-3.5 w-3.5 text-[var(--color-muted)]" />
            Settings
          </Link>
          <button
            type="button"
            role="menuitem"
            disabled={signingOut}
            onClick={() => void signOut()}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[var(--color-fg)] hover:bg-[var(--color-accent-soft)] disabled:opacity-60"
          >
            <LogOut className="h-3.5 w-3.5 text-[var(--color-muted)]" />
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
