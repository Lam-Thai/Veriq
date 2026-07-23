"use client";

import { useState } from "react";
import Link from "next/link";
import { Show, UserButton } from "@clerk/nextjs";
import { cn } from "@/lib/cn";
import { CloseIcon, MenuIcon } from "@/components/ui/icons";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { NAV_LINKS } from "@/components/landing/nav-links";

/**
 * Hamburger menu for the nav bar on small viewports. Isolated as the only client leaf in
 * the nav so the rest of the page stays server-rendered — this component owns nothing but
 * its own open/closed boolean.
 */
export function MobileNavMenu() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-controls="mobile-nav-panel"
        aria-label={isOpen ? "Close menu" : "Open menu"}
        className={cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-sm text-white",
          "transition-colors duration-(--duration-fast) hover:bg-white/10",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus",
          "active:scale-(--press-scale)",
        )}
      >
        {isOpen ? <CloseIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
      </button>

      {isOpen && (
        <div
          id="mobile-nav-panel"
          className="absolute inset-x-0 top-full border-t border-white/10 bg-surface-black px-6 py-4"
        >
          <ul className="flex flex-col gap-1">
            {NAV_LINKS.map((link) => {
              const linkClassName = cn(
                "block rounded-sm px-2 py-2.5 text-(length:--type-button-utility-size) font-normal text-white/80",
                "transition-colors duration-(--duration-fast) hover:text-white",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus",
              );
              return (
                <li key={link.label}>
                  {link.href.startsWith("#") ? (
                    <a href={link.href} onClick={() => setIsOpen(false)} className={linkClassName}>
                      {link.label}
                    </a>
                  ) : (
                    <Link href={link.href} onClick={() => setIsOpen(false)} className={linkClassName}>
                      {link.label}
                    </Link>
                  )}
                </li>
              );
            })}
            <li>
              <Show
                when="signed-out"
                fallback={
                  <div className="flex items-center gap-2 px-2 py-2.5">
                    <UserButton />
                    <span className="text-(length:--type-button-utility-size) font-normal text-white/80">
                      Account
                    </span>
                  </div>
                }
              >
                <Link
                  href="/sign-in"
                  onClick={() => setIsOpen(false)}
                  className={cn(
                    "block rounded-sm px-2 py-2.5 text-(length:--type-button-utility-size) font-normal text-white/80",
                    "transition-colors duration-(--duration-fast) hover:text-white",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus",
                  )}
                >
                  Sign in
                </Link>
              </Show>
            </li>
            <li className="flex items-center justify-between px-2 py-2.5">
              <span className="text-(length:--type-button-utility-size) font-normal text-white/80">Appearance</span>
              <ThemeToggle />
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
