import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-[13px] font-semibold tracking-[0.08em] text-[var(--color-muted)]">404</p>
      <h1 className="text-xl font-semibold text-[var(--color-fg)]">Page not found</h1>
      <p className="text-sm text-[var(--color-muted)]">
        This route does not exist, or you may not have access to it.
      </p>
      <Button asChild>
        <Link href="/dashboard">Back to Overview</Link>
      </Button>
    </div>
  );
}
