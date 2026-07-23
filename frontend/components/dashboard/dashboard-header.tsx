import { UserButton } from "@clerk/nextjs";
import { BrandLogo } from "@/components/ui/brand-logo";
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
          <ThemeToggle />
          <UserButton />
        </div>
      </div>
    </header>
  );
}
