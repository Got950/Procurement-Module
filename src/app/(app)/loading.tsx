import { Skeleton } from "@/components/ui/skeleton";

export default function AppLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Skeleton className="h-24 rounded-[var(--radius-lg)]" />
        <Skeleton className="h-24 rounded-[var(--radius-lg)]" />
        <Skeleton className="h-24 rounded-[var(--radius-lg)]" />
      </div>
      <Skeleton className="h-64 w-full rounded-[var(--radius-lg)]" />
    </div>
  );
}
