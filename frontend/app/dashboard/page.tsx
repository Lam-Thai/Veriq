import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import { Card } from "@/components/ui/card";

export default async function DashboardPage() {
  const user = await currentUser();
  const displayName = user?.firstName ?? user?.primaryEmailAddress?.emailAddress ?? "there";

  return (
    <>
      <header className="sticky top-0 z-50 w-full bg-surface-black">
        <div className="mx-auto flex h-14 max-w-grid items-center justify-between px-6">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus"
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
