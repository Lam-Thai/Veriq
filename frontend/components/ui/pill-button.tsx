import type { ComponentPropsWithoutRef, ElementType } from "react";
import { cn } from "@/lib/cn";

type PillVariant = "primary" | "secondary-dark" | "secondary-light";

type PillButtonOwnProps = {
  variant?: PillVariant;
  className?: string;
};

// Hierarchy: pill shape → variant background → label. No icon-only pills in this design.
const baseClasses = cn(
  "inline-flex items-center justify-center gap-2 rounded-pill px-6 py-3.5",
  "text-(length:--type-button-large-size)/(--type-button-large-lh) font-semibold",
  "transition-[background-color,opacity,transform] duration-(--duration-base) ease-(--ease-out)",
  "active:scale-(--press-scale)",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus",
  "disabled:pointer-events-none disabled:opacity-50",
);

const variantClasses: Record<PillVariant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary/90",
  "secondary-dark": "bg-white/10 text-white hover:bg-white/15",
  "secondary-light": "bg-transparent text-ink border border-hairline hover:bg-black/[0.03]",
};

/**
 * The signature pill control — used for every primary/secondary CTA in the system.
 * Renders as `<button>` by default; pass `as="a"` (with `href`) to render a link that looks
 * identical, since several CTAs in this static marketing page are anchor-style "buttons."
 */
export function PillButton<T extends ElementType = "button">({
  as,
  variant = "primary",
  className,
  ...props
}: PillButtonOwnProps & { as?: T } & Omit<ComponentPropsWithoutRef<T>, "as" | "className">) {
  const Component = as ?? "button";
  return (
    <Component className={cn(baseClasses, variantClasses[variant], className)} {...props} />
  );
}
