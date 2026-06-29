"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { CheckIcon } from "@/components/ui/icons";
import { PLATFORMS, type Platform, type PlatformStatus } from "@/components/landing/platform-data";

const PLATFORM_AVATAR_LETTER: Record<string, string> = Object.fromEntries(
  PLATFORMS.map((platform) => [platform.name, platform.name.charAt(0)]),
);

/**
 * Owns the connect/connected toggle state for the platform grid. Visual-only per the spec —
 * there is no backend call, so "Connect" just flips local state to "Connected" on click.
 */
export function PlatformGrid() {
  const [statuses, setStatuses] = useState<Record<string, PlatformStatus>>(() =>
    Object.fromEntries(PLATFORMS.map((platform) => [platform.name, platform.status])),
  );

  const connectedCount = Object.values(statuses).filter((status) => status === "connected").length;

  function handleConnect(name: string) {
    setStatuses((current) => ({ ...current, [name]: "connected" }));
  }

  return (
    <div>
      <p className="text-center text-(length:--type-caption-size) text-ink-muted-48">
        {connectedCount} of {PLATFORMS.length} connected · $47,700 verified
      </p>

      <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PLATFORMS.map((platform) => (
          <PlatformCard
            key={platform.name}
            platform={platform}
            status={statuses[platform.name] ?? platform.status}
            onConnect={() => handleConnect(platform.name)}
          />
        ))}
      </ul>
    </div>
  );
}

type PlatformCardProps = {
  platform: Platform;
  status: PlatformStatus;
  onConnect: () => void;
};

function PlatformCard({ platform, status, onConnect }: PlatformCardProps) {
  const isConnected = status === "connected";

  return (
    <li className="flex items-center gap-4 rounded-lg border border-hairline bg-canvas p-4">
      <span
        aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-canvas-parchment text-(length:--type-tagline-size) font-semibold text-ink"
      >
        {PLATFORM_AVATAR_LETTER[platform.name]}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-(length:--type-body-size) font-semibold text-ink">{platform.name}</p>
        <p className="text-(length:--type-caption-size) text-ink-muted-48">{platform.category}</p>
      </div>

      {isConnected ? (
        <span className="flex shrink-0 items-center gap-1.5 text-(length:--type-caption-size) font-semibold text-verified">
          <CheckIcon className="h-4 w-4" />
          Connected
        </span>
      ) : (
        <button
          type="button"
          onClick={onConnect}
          className={cn(
            "shrink-0 rounded-pill px-3 py-1.5 text-(length:--type-caption-size) font-semibold text-primary",
            "transition-colors duration-(--duration-fast) hover:bg-primary/10",
            "active:scale-(--press-scale)",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus",
          )}
        >
          Connect
        </button>
      )}
    </li>
  );
}
