import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const variants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-md)] text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/35 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] shadow-[var(--shadow-xs)]",
        ghost:
          "bg-transparent text-[var(--color-fg)] hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-fg)]",
        outline:
          "border border-[var(--color-border)] bg-white text-[var(--color-fg)] hover:bg-[var(--color-surface-muted)] hover:border-[var(--color-border-strong)]",
        danger:
          "border border-red-200 bg-[var(--color-danger-soft)] text-[var(--color-danger)] hover:bg-red-100",
        secondary:
          "bg-[var(--color-surface-muted)] text-[var(--color-fg)] hover:bg-[var(--color-bg-2)] border border-[var(--color-border)]",
      },
      size: {
        default: "h-9 px-3.5 py-2",
        sm: "h-8 rounded-[var(--radius-sm)] px-3 text-[13px]",
        lg: "h-10 rounded-[var(--radius-md)] px-5",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof variants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(variants({ variant, size, className }))} ref={ref} {...props} />
    );
  }
);
Button.displayName = "Button";
