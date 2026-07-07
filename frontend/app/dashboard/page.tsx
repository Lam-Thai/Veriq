import { UserButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import { BrandLogo } from "@/components/ui/brand-logo";
import { Card } from "@/components/ui/card";

export default async function DashboardPage() {
  const user = await currentUser();
  const displayName = user?.firstName ?? user?.primaryEmailAddress?.emailAddress ?? "there";

  return (
    <>
      <header className="sticky top-0 z-50 w-full bg-surface-black">
        <div className="mx-auto flex h-14 max-w-grid items-center justify-between px-6">
          <BrandLogo href="/" />

          <UserButton />
        </div>
      </header>

      <main className="flex min-h-screen flex-col items-center bg-canvas-parchment px-6 py-16">
        <Card className="w-full max-w-lg text-center">
          <h1 className="text-(length:--type-tagline-size)/(--type-tagline-lh) font-semibold text-ink">
            Welcome, {displayName}
          </h1>
          <p className="mt-3 text-(length:--type-body-size)/(--type-body-lh) text-ink-muted-80">
            You&rsquo;re signed in. This is the authenticated area of Veriq.
          </p>
        </Card>
      </main>
    </>
  );
}
