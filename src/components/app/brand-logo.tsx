import { cn } from "@/lib/utils";

type BrandLogoProps = {
  size?: "sm" | "md" | "lg";
  className?: string;
};

const sizeClass = {
  sm: "text-xs",
  md: "text-[13px]",
  lg: "text-base",
} as const;

export function BrandLogo({ size = "md", className }: BrandLogoProps) {
  return (
    <span
      className={cn(
        "shrink-0 font-semibold tracking-[0.08em] text-[var(--color-fg)]",
        sizeClass[size],
        className
      )}
    >
      MedFlow
    </span>
  );
}

export function SidebarBrand() {
  return (
    <div className="flex w-full min-w-0 items-center gap-2.5">
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent)] text-[12px] font-bold tracking-tight text-white"
        aria-hidden
      >
        M
      </span>
      <div className="min-w-0">
        <BrandLogo size="md" />
        <p className="truncate text-[11px] text-[var(--color-muted)]">
          Pharmaceutical Procurement
        </p>
      </div>
    </div>
  );
}
