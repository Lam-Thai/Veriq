/**
 * Reads a motion design token (e.g. "--duration-slow", "--ease-out") from :root at runtime,
 * so JS-driven animations (rAF loops, imperative timers) stay locked to the same tokens CSS
 * transitions use instead of hardcoding a parallel set of values.
 */
function readCssToken(token: string): string {
  if (typeof window === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim();
}

export function getCssDurationMs(token: string, fallbackMs: number): number {
  const raw = readCssToken(token);
  const match = raw.match(/^(-?[\d.]+)(ms|s)$/);
  if (!match) return fallbackMs;

  const value = parseFloat(match[1]!);
  if (!Number.isFinite(value)) return fallbackMs;

  return match[2] === "s" ? value * 1000 : value;
}

/**
 * Evaluates a `cubic-bezier(x1, y1, x2, y2)` token (e.g. --ease-out) at time `t` (0-1), via
 * Newton-Raphson iteration on the bezier's x(t) to find t-for-x, then reads y(t) — the same
 * curve the CSS token describes, applied to JS-interpolated values (e.g. a count-up number)
 * that CSS transitions can't drive on their own.
 */
export function cssEasingFn(token: string, fallback: [number, number, number, number]): (t: number) => number {
  const raw = readCssToken(token);
  const match = raw.match(/cubic-bezier\(\s*([\d.]+)\s*,\s*([\d.-]+)\s*,\s*([\d.]+)\s*,\s*([\d.-]+)\s*\)/);
  const [x1, y1, x2, y2] = match
    ? [parseFloat(match[1]!), parseFloat(match[2]!), parseFloat(match[3]!), parseFloat(match[4]!)]
    : fallback;

  const a = (u1: number, u2: number) => 1 - 3 * u2 + 3 * u1;
  const b = (u1: number, u2: number) => 3 * u2 - 6 * u1;
  const c = (u1: number) => 3 * u1;

  const bezierX = (t: number) => ((a(x1, x2) * t + b(x1, x2)) * t + c(x1)) * t;
  const bezierY = (t: number) => ((a(y1, y2) * t + b(y1, y2)) * t + c(y1)) * t;
  const derivativeX = (t: number) => 3 * a(x1, x2) * t * t + 2 * b(x1, x2) * t + c(x1);

  return (x: number) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const currentSlope = derivativeX(t);
      if (Math.abs(currentSlope) < 1e-6) break;
      t -= (bezierX(t) - x) / currentSlope;
    }
    return bezierY(t);
  };
}
