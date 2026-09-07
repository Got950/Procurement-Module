"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function MarkReadButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        size="sm"
        disabled={loading}
        onClick={async () => {
          setLoading(true);
          setError(null);
          try {
            const res = await fetch("/api/notifications/read", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "{}",
            });
            if (!res.ok) {
              const j = (await res.json().catch(() => ({}))) as { error?: string };
              throw new Error(j.error ?? "Could not mark notifications as read.");
            }
            router.refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Could not mark as read.");
          } finally {
            setLoading(false);
          }
        }}
      >
        {loading ? "Updating…" : "Mark all read"}
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
