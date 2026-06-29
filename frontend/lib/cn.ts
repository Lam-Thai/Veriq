/**
 * Joins class names, filtering out falsy values.
 * Lightweight stand-in for `clsx` — this project has no other use for the dependency.
 */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
