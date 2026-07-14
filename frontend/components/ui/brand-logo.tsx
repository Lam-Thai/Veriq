import Link from "next/link";
import Image from "next/image";
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
      <Image
        src="/Veriq.png"
        alt=""
        aria-hidden="true"
        width={32}
        height={32}
        priority
        className="h-8 w-8 shrink-0 rounded-sm"
      />
      <span className="text-(length:--type-button-utility-size) font-bold text-white">
        Veriq
      </span>
    </Link>
  );
}
