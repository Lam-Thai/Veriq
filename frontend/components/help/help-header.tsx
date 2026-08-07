import Link from "next/link";
import { Show, UserButton } from "@clerk/nextjs";
import { cn } from "@/lib/cn";
import { BrandLogo } from "@/components/ui/brand-logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";

/**
 * Header for the public /help page — the same black bar as the landing nav and the authenticated
 * shell, minus the landing nav's in-page anchor links, which point at sections
 * (`#why-veriq`, `#how-it-works`, ...) that only exist on the marketing page and would dead-end
 * here. Signed-in visitors (the ones arriving via the dashboard's "?" button) get a way back to
 * the dashboard; signed-out ones get the sign-in link instead.
 */
export function HelpHeader() {
  const linkClassName = cn(
    "rounded-xs text-(length:--type-nav-link-size)/(--type-nav-link-lh) tracking-(--type-nav-link-ls) text-white/70",
    "transition-colors duration-(--duration-fast) hover:text-white",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus",
  );

  return (
    <header className="sticky top-0 z-50 w-full bg-surface-black">
      <div className="mx-auto flex h-14 max-w-grid items-center justify-between px-6">
        <BrandLogo href="/" />
        <div className="flex items-center gap-4">
          <Show when="signed-in">
            <Link href="/dashboard" className={linkClassName}>
              Dashboard
            </Link>
          </Show>
          <ThemeToggle />
          <Show when="signed-out" fallback={<UserButton />}>
            <Link href="/sign-in" className={linkClassName}>
              Sign in
            </Link>
          </Show>
        </div>
      </div>
    </header>
  );
}
