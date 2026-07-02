import { notFound } from "next/navigation";
import { findPlatformBySlug } from "@/components/landing/platform-data";
import { Card } from "@/components/ui/card";
import { ShieldIcon } from "@/components/ui/icons";
import { ConsentActions } from "@/app/connect/[slug]/consent/consent-actions";

type ConsentPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ state?: string }>;
};

/**
 * Mock provider login screen. No platform here has a registered OAuth app yet (see
 * getAuthorizationUrl in platform-data.ts), so this Veriq-branded, clearly-labeled screen stands
 * in for the real thing until a per-provider follow-up wires up an actual authorize URL.
 */
export default async function ConsentPage({ params, searchParams }: ConsentPageProps) {
  const { slug } = await params;
  const { state } = await searchParams;

  const platform = findPlatformBySlug(slug);
  if (!platform || !state) {
    notFound();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas-parchment px-6 py-16">
      <Card className="w-full max-w-sm text-center">
        <span
          aria-hidden="true"
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-pill bg-canvas-parchment text-(length:--type-tagline-size) font-semibold text-ink"
        >
          {platform.name.charAt(0)}
        </span>

        <h1 className="mt-4 text-(length:--type-tagline-size)/(--type-tagline-lh) tracking-(--type-tagline-ls) font-semibold text-ink">
          Sign in to {platform.name}
        </h1>

        <p className="mt-3 flex items-center justify-center gap-1.5 text-(length:--type-caption-size) text-ink-muted-48">
          <ShieldIcon className="h-4 w-4" />
          Simulated authorization — Veriq is not affiliated with {platform.name}
        </p>

        <p className="mt-4 text-(length:--type-body-size)/(--type-body-lh) tracking-(--type-body-ls) text-ink-muted-80">
          Veriq is requesting access to your {platform.category.toLowerCase()} account activity
          to verify your income. This screen stands in for {platform.name}&rsquo;s real sign-in
          page until that integration is built.
        </p>

        <ConsentActions slug={platform.slug} state={state} />
      </Card>
    </main>
  );
}
