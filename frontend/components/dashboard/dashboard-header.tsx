import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { cn } from "@/lib/cn";
import { BrandLogo } from "@/components/ui/brand-logo";
import { HelpIcon } from "@/components/ui/icons";
import { ThemeToggle } from "@/components/ui/theme-toggle";

/**
 * Sole sticky header for the authenticated shell — same black bar treatment as
 * components/landing/nav.tsx. Rendered once, from app/dashboard/layout.tsx, so it wraps every
 * /dashboard/* route without each page re-rendering its own copy.
 */
export function DashboardHeader() {
  return (
    <header className="sticky top-0 z-50 w-full bg-surface-black">
      <div className="mx-auto flex h-14 max-w-grid items-center justify-between px-6">
        <BrandLogo href="/dashboard" />
        <div className="flex items-center gap-3">
          <Link
            href="/help"
            aria-label="Help"
            className={cn(
              "rounded-full p-1.5 text-white/70",
              "transition-colors duration-(--duration-fast) hover:bg-white/10 hover:text-white",
              "active:scale-(--press-scale)",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus",
            )}
          >
            <HelpIcon className="h-4 w-4" />
          </Link>
          <ThemeToggle />
          <UserButton />
        </div>
      </div>
    </header>
  );
}
