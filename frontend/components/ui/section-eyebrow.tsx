import { cn } from "@/lib/cn";

type SectionEyebrowProps = {
  children: string;
  tone?: "light" | "dark";
  className?: string;
};

/**
 * The small bold blue label that opens every section ("The problem", "How it works", ...).
 * `--color-primary` fails AA contrast on the dark tile surfaces (~2.7:1), so dark tiles use
 * `--color-primary-on-dark` instead — same blue family, ~4.9:1 against --color-surface-tile-1.
 */
export function SectionEyebrow({ children, tone = "light", className }: SectionEyebrowProps) {
  return (
    <p
      className={cn(
        "text-(length:--type-tagline-size)/(--type-tagline-lh) font-semibold",
        tone === "dark" ? "text-primary-on-dark" : "text-primary",
        className,
      )}
    >
      {children}
    </p>
  );
}
