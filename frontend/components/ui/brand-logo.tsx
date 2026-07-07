import Link from "next/link";
import { cn } from "@/lib/cn";

type BrandLogoProps = {
  href: string;
  className?: string;
};

/**
 * The Veriq wordmark + icon used in every page header (public nav, authenticated shell).
 * Takes `href` since the public nav points at the top of the landing page while the
 * authenticated shell points at "/" — everything else about the mark is identical.
 */
export function BrandLogo({ href, className }: BrandLogoProps) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 rounded-sm",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="flex h-6 w-6 items-center justify-center rounded-sm bg-primary"
      >
        <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5">
          <path
            d="M3 8.5L6 11.5L13 4"
            stroke="white"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="text-(length:--type-button-utility-size) font-bold text-white">
        Veriq
      </span>
    </Link>
  );
}
