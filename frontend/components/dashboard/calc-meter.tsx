import { cn } from "@/lib/cn";

type CalcMeterProps = {
  /** Fill fraction of the track, 0–100. Clamped defensively. */
  valuePct: number;
  className?: string;
};

/**
 * Thin horizontal fill bar shared by the Calculators tab — the stability subscore meters and the
 * per-platform contribution bars. Purely decorative (the adjacent text carries the number), so it
 * stays aria-hidden. Not interactive and has no client state, so it renders on the server.
 */
export function CalcMeter({ valuePct, className }: CalcMeterProps) {
  const width = Math.min(100, Math.max(0, valuePct));

  return (
    <div
      aria-hidden="true"
      className={cn("h-1.5 w-full overflow-hidden rounded-pill bg-black/[0.06]", className)}
    >
      <div className="h-full rounded-pill bg-primary" style={{ width: `${width}%` }} />
    </div>
  );
}
