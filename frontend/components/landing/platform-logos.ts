import {
  siAirbnb,
  siDoordash,
  siFiverr,
  siInstacart,
  siLyft,
  siPaypal,
  siStripe,
  siUber,
  siUpwork,
  siVenmo,
} from "simple-icons";

export type PlatformLogo = {
  title: string;
  hex: string;
  path: string;
};

// Keyed by Platform.slug (see platform-data.ts). VRBO has no entry — simple-icons doesn't ship
// its mark — so PlatformAvatar falls back to the letter avatar for that slug only.
export const PLATFORM_LOGOS: Record<string, PlatformLogo> = {
  uber: siUber,
  lyft: siLyft,
  doordash: siDoordash,
  instacart: siInstacart,
  airbnb: siAirbnb,
  upwork: siUpwork,
  fiverr: siFiverr,
  paypal: siPaypal,
  stripe: siStripe,
  venmo: siVenmo,
};
