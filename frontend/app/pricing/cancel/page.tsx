import type { Metadata } from "next";
import { Nav } from "@/components/landing/nav";
import { Card } from "@/components/ui/card";
import { PillButton } from "@/components/ui/pill-button";

export const metadata: Metadata = {
  title: "Checkout canceled — Veriq",
  description: "Your Veriq checkout was canceled.",
};

export default function PricingCancelPage() {
  return (
    <>
      <Nav />
      <main className="flex min-h-screen items-center justify-center bg-canvas-parchment px-6 py-16">
        <Card className="w-full max-w-sm text-center">
          <h1 className="text-(length:--type-tagline-size)/(--type-tagline-lh) tracking-(--type-tagline-ls) font-semibold text-ink">
            Checkout canceled
          </h1>
          <p className="mt-3 text-(length:--type-body-size)/(--type-body-lh) tracking-(--type-body-ls) text-ink-muted-80">
            Checkout canceled — you have not been charged.
          </p>
          <PillButton as="a" href="/pricing" className="mt-6 w-full">
            Back to pricing
          </PillButton>
        </Card>
      </main>
    </>
  );
}
