import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Emits a self-contained `.next/standalone` build (minimal traced
  // node_modules + server) so the Docker runtime stage doesn't need to
  // carry devDependencies or the full node_modules tree. No effect on
  // `next dev`/`next start` outside Docker.
  output: "standalone",
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

// `withSentryConfig` wires source-map upload at build time — it no-ops gracefully without
// SENTRY_AUTH_TOKEN/org/project configured (not set up in this repo yet), so this is safe with
// zero additional config; `silent: true` just keeps that "not configured" notice out of normal
// build output.
export default withSentryConfig(nextConfig, {
  silent: true,
  webpack: { treeshake: { removeDebugLogging: true } },
});
