import { cn } from "@/lib/cn";
import { PLATFORM_LOGOS } from "@/components/landing/platform-logos";
import type { Platform } from "@/components/landing/platform-data";

type PlatformAvatarProps = {
  platform: Pick<Platform, "slug" | "name">;
  className?: string;
};

/**
 * Shared "Connect what pays you" avatar for both the landing grid and the dashboard's Connected
 * Platforms list. Renders each platform's real brand mark — small, unmodified, in its own brand
 * color, per simple-icons/press-kit fair-use norms for "we integrate with X" contexts — and
 * falls back to the existing letter avatar for any slug simple-icons doesn't carry (currently
 * just VRBO), so the list never shows a broken image. Stays aria-hidden because the adjacent
 * platform name already announces it to screen readers, matching the prior letter-avatar markup.
 */
export function PlatformAvatar({ platform, className }: PlatformAvatarProps) {
  const logo = PLATFORM_LOGOS[platform.slug];

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-canvas-parchment text-(length:--type-tagline-size) font-semibold text-ink",
        className,
      )}
    >
      {logo ? (
        <svg viewBox="0 0 24 24" className="h-5 w-5" focusable="false">
          <path d={logo.path} fill={`#${logo.hex}`} />
        </svg>
      ) : (
        platform.name.charAt(0)
      )}
    </span>
  );
}
