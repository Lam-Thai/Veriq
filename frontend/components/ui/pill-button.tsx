import type { ComponentPropsWithoutRef, ElementType } from "react";
import { cn } from "@/lib/cn";

type PillVariant = "primary" | "secondary-dark" | "secondary-light";
type PillSize = "default" | "compact";

type PillButtonOwnProps = {
  variant?: PillVariant;
  size?: PillSize;
  className?: string;
};

// Hierarchy: pill shape → size → variant background → label. No icon-only pills in this design.
const sharedClasses = cn(
  "inline-flex items-center justify-center gap-2 rounded-pill font-semibold",
  "transition-[background-color,opacity,transform] duration-(--duration-base) ease-(--ease-out)",
  "hover:-translate-y-0.5 active:scale-(--press-scale) active:translate-y-0",
  "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus",
  "disabled:pointer-events-none disabled:opacity-50",
);

// Each size is one block of non-overlapping utilities (padding + type), never combined with
// the other size's classes — Tailwind's generated stylesheet order, not JSX class order,
// decides which utility wins when two classes touch the same property, so a partial
// className override (e.g. just overriding padding) is not a safe way to get a compact pill.
const sizeClasses: Record<PillSize, string> = {
  default: "px-6 py-3.5 text-(length:--type-button-large-size)/(--type-button-large-lh)",
  compact: "px-5 py-2.5 text-(length:--type-button-utility-size)",
};

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
  size = "default",
  className,
  ...props
}: PillButtonOwnProps & { as?: T } & Omit<ComponentPropsWithoutRef<T>, "as" | "className">) {
  const Component = as ?? "button";
  return (
    <Component
      className={cn(sharedClasses, sizeClasses[size], variantClasses[variant], className)}
      {...props}
    />
  );
}
