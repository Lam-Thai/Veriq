import { BrandLogo } from "@/components/ui/brand-logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";

/**
 * Minimal authenticated-shell counterpart to components/landing/nav.tsx — same sticky black bar
 * treatment for visual consistency across the app, but the dashboard has no nav links or sign-in
 * CTA of its own (account actions live in the dashboard's own "Account" tab), so this only ever
 * carries the brand mark and the theme toggle. Rendered at the top of app/dashboard/page.tsx and
 * app/dashboard/report/page.tsx.
 */
export function DashboardHeader() {
  return (
    <header className="sticky top-0 z-50 w-full bg-surface-black">
      <div className="mx-auto flex h-14 max-w-grid items-center justify-between px-6">
        <BrandLogo href="/dashboard" />
        <ThemeToggle />
      </div>
    </header>
  );
}
