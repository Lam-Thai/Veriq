import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type CardTone = "light" | "dark";

type CardProps = {
  children: ReactNode;
  tone?: CardTone;
  className?: string;
};

const toneClasses: Record<CardTone, string> = {
  light: "border-hairline bg-canvas",
  dark: "border-white/10 bg-surface-tile-2",
};

/**
 * The flat, hairline-bordered card used across every grid (problem, security, use-cases,
 * how-it-works, platform list). Never carries a shadow — elevation is reserved exclusively
 * for product-screenshot mockups per the design system. Hover lifts the card a couple of
 * pixels (spatial separation, not a shadow) to signal interactivity.
 */
export function Card({ children, tone = "light", className }: CardProps) {
  return (
    <article
      className={cn(
        "rounded-lg border p-6",
        "transition-transform duration-(--duration-base) ease-(--ease-out) hover:-translate-y-1 motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </article>
  );
}
