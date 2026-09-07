"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function LogoutButton() {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-[var(--color-muted)] hover:text-[var(--color-fg)]"
      onClick={async () => {
        await fetch("/api/session", { method: "DELETE" });
        router.push("/login");
        router.refresh();
      }}
    >
      Sign out
    </Button>
  );
}
