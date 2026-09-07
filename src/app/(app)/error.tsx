"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-semibold text-[var(--color-fg)]">Something went wrong</h1>
      <p className="text-sm text-[var(--color-muted)]">
        An unexpected error occurred while loading this page. You can try again or return to Overview.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button onClick={() => reset()}>Try again</Button>
        <Button variant="outline" asChild>
          <Link href="/dashboard">Back to Overview</Link>
        </Button>
      </div>
    </div>
  );
}
