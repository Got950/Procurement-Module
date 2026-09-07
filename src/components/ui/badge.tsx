import { cn } from "@/lib/utils";

const variants: Record<string, string> = {
  default:
    "bg-[var(--color-surface-muted)] text-[var(--color-fg)] border border-[var(--color-border)]",
  success:
    "bg-[var(--color-success-soft)] text-[var(--color-success)] border border-emerald-200/80",
  warning:
    "bg-[var(--color-warning-soft)] text-[var(--color-warning)] border border-amber-200/80",
  danger: "bg-[var(--color-danger-soft)] text-[var(--color-danger)] border border-red-200/80",
  accent:
    "bg-[var(--color-accent-soft)] text-[var(--color-accent)] border border-blue-200/70",
};

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: keyof typeof variants }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[var(--radius-sm)] px-2 py-0.5 text-xs font-medium",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}
