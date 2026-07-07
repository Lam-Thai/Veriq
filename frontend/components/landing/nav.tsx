import Link from "next/link";
import { Show, UserButton } from "@clerk/nextjs";
import { BrandLogo } from "@/components/ui/brand-logo";
import { PillButton } from "@/components/ui/pill-button";
import { NAV_LINKS } from "@/components/landing/nav-links";
import { MobileNavMenu } from "@/components/landing/mobile-nav-menu";
import { cn } from "@/lib/cn";

// Hierarchy: logo (left) → nav links (center/right) → primary CTA (far right) → mobile toggle
export function Nav() {
  return (
    <nav className="sticky top-0 z-50 w-full bg-surface-black">
      <div className="relative mx-auto flex h-14 max-w-grid items-center justify-between px-6">
        <BrandLogo href="#" />

        <ul className="hidden items-center gap-7 md:flex">
          {NAV_LINKS.map((link) => (
            <li key={link.label}>
              <a
                href={link.href}
                className={cn(
                  "text-(length:--type-nav-link-size)/(--type-nav-link-lh) tracking-(--type-nav-link-ls) text-white/70",
                  "transition-colors duration-(--duration-fast) hover:text-white",
                  "rounded-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus",
                )}
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="hidden items-center gap-4 md:flex">
          <Show when="signed-out" fallback={<UserButton />}>
            <Link
              href="/sign-in"
              className={cn(
                "text-(length:--type-nav-link-size)/(--type-nav-link-lh) tracking-(--type-nav-link-ls) text-white/70",
                "transition-colors duration-(--duration-fast) hover:text-white",
                "rounded-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus",
              )}
            >
              Sign in
            </Link>
          </Show>
          <PillButton as="a" href="#" variant="primary" size="compact">
            Generate Report
          </PillButton>
        </div>

        <MobileNavMenu />
      </div>
    </nav>
  );
}
