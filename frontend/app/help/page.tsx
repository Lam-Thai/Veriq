import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { currentUser } from "@clerk/nextjs/server";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/card";
import { ArrowLeftIcon } from "@/components/ui/icons";
import { Disclosure } from "@/components/ui/disclosure";
import { SectionEyebrow } from "@/components/ui/section-eyebrow";
import { HelpHeader } from "@/components/help/help-header";
import { ContactForm } from "@/components/help/contact-form";
import { isContactEmailConfigured } from "@/lib/email";
import { PLAN_LIMITS } from "@/lib/plan-limits";

export const metadata: Metadata = {
  title: "Help & support — Veriq",
  description:
    "How Veriq works, in plain language: connecting the platforms you earn on, reading your income insights, using the calculators, generating a verified report, and sharing it with a lender.",
};

/**
 * Public help page — reachable from the "?" button in the dashboard header, and directly by
 * anyone evaluating Veriq before they sign up (proxy.ts only gates /dashboard and /connect, so
 * this route is deliberately open). Server-rendered: everything except the contact form is static
 * prose, so nothing here needs to become client JS.
 *
 * Structure is one `<section>` per topic, each labelled by its own `<h2>`, under a single `<h1>`
 * — with a "jump to" `<nav>` so the page is navigable by landmark and by heading rather than by
 * scrolling. Numbers that also exist in code (plan limits) are read from their source module
 * instead of retyped, so the docs can't quietly drift out of date.
 */
export default async function HelpPage() {
  const user = await currentUser();

  return (
    <>
      <HelpHeader />
      {/* Parchment, not plain canvas — matching app/pricing/page.tsx. Card's light tone is
          `bg-canvas` (white), so on a white page the feature cards would read as invisible
          rectangles held together by a hairline. */}
      <main className="bg-canvas-parchment px-6 py-(--spacing-section)">
        <div className="mx-auto max-w-text">
          {/* Signed-in only: "back to dashboard" is a dead end for a visitor who doesn't have one
              yet — proxy.ts would bounce them to /sign-in. Signed-out readers reach this page from
              the marketing site and have the header's sign-in link instead. */}
          {user ? (
            <Link
              href="/dashboard"
              className={cn(
                "group mb-6 inline-flex items-center gap-2 rounded-xs text-(length:--type-caption-size) font-semibold text-ink-muted-80",
                "transition-colors duration-(--duration-fast) ease-(--ease-out) hover:text-ink",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus",
              )}
            >
              <ArrowLeftIcon
                className={cn(
                  "h-4 w-4 transition-transform duration-(--duration-fast) ease-(--ease-out)",
                  "group-hover:-translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0",
                )}
              />
              Back to dashboard
            </Link>
          ) : null}

          <SectionEyebrow>Help &amp; support</SectionEyebrow>
          <h1 className="mt-3 text-(length:--type-display-lg-size)/(--type-display-lg-lh) tracking-(--type-display-lg-ls) font-semibold text-ink">
            How Veriq works
          </h1>
          <p className="mt-5 text-(length:--type-body-size)/(--type-body-lh) tracking-(--type-body-ls) text-ink-muted-80">
            Veriq turns the money you earn across gig, freelance, and platform work into a single
            verified income report that a lender, landlord, or agency will accept. This page
            explains every part of the app in plain language. If something still doesn&rsquo;t make
            sense, the contact form at the bottom reaches a real person.
          </p>

          <nav aria-label="On this page" className="mt-8">
            <ul className="flex flex-wrap gap-x-4 gap-y-2">
              {SECTIONS.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="rounded-xs text-(length:--type-caption-size) font-semibold text-primary transition-colors duration-(--duration-fast) hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus"
                  >
                    {section.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="mx-auto mt-12 flex max-w-text flex-col gap-12">
          <HelpSection id="what-is-veriq" title="What Veriq is">
            <Prose>
              If you earn from one employer, proving your income is one payslip. If you drive, deliver,
              host, freelance, or sell across five apps, there is no single document that shows what you
              actually make — and lenders rarely accept a stack of screenshots.
            </Prose>
            <Prose>
              Veriq connects to the platforms that pay you, reads the earnings they report, and adds them
              up into one verified picture: what you earned in total, what you earn in a typical month,
              and how steady it has been. From that, it produces a PDF report you can hand to a lender,
              and a private link they can check for themselves.
            </Prose>
            <Prose>
              Veriq never invents a number. Every figure traces back to earnings a connected platform
              reported for your account.
            </Prose>
          </HelpSection>

          <HelpSection id="getting-started" title="Getting started">
            <ol className="flex flex-col gap-4">
              <Step number={1} title="Create your account">
                Sign up with your email. Your account is what ties your connections, goals, expenses, and
                reports together.
              </Step>
              <Step number={2} title="Connect the platforms that pay you">
                On the <strong>Overview</strong> tab, pick a platform and press connect. A window opens
                where you sign in to that platform and approve read access to your earnings. Approving
                sends your earnings history to Veriq; it never gives Veriq the ability to move money,
                change your account, or post anything.
              </Step>
              <Step number={3} title="Generate your report">
                Once at least one platform is connected, the <strong>Report</strong> tab can build your
                verified income PDF. The <strong>Sharing</strong> tab then turns it into a link you can
                send to whoever asked for proof.
              </Step>
            </ol>
            <Prose>
              Connecting more platforms makes the picture more complete — and more convincing. A lender
              seeing one delivery app sees a side hustle; the same lender seeing every source sees a real
              income.
            </Prose>
          </HelpSection>

          <HelpSection id="connecting-platforms" title="Connecting platforms">
            <Prose>
              Veriq supports rideshare and delivery apps, hosting platforms, freelance marketplaces,
              payment processors, and creator platforms — Uber, Lyft, DoorDash, Instacart, Airbnb, VRBO,
              Upwork, Fiverr, PayPal, Stripe, Venmo, and more.
            </Prose>
            <Prose>
              Each connection is a read-only authorization you approve on the platform&rsquo;s own sign-in
              screen. You can remove a connection at any time from the Overview tab; its earnings stop
              counting toward your totals from that point on. Reports you already generated are
              snapshots and stay as they were.
            </Prose>
            <Prose>
              On the free plan you can connect up to {PLAN_LIMITS.free.maxPlatforms} platforms. Pro and
              Enterprise remove that cap.
            </Prose>
          </HelpSection>

          <HelpSection id="features" title="Every tab, explained">
            <div className="flex flex-col gap-4">
              {FEATURES.map((feature) => (
                <Card key={feature.title}>
                  <h3 className="text-(length:--type-tagline-size)/(--type-tagline-lh) font-semibold text-ink">
                    {feature.title}
                  </h3>
                  <p className="mt-2 text-(length:--type-body-size)/(--type-body-lh) tracking-(--type-body-ls) text-ink-muted-80">
                    {feature.body}
                  </p>
                </Card>
              ))}
            </div>
          </HelpSection>

          <HelpSection id="plans" title="Plans and limits">
            <Prose>
              <strong>Free</strong> — up to {PLAN_LIMITS.free.maxPlatforms} connected platforms, and a
              report that stays current for {PLAN_LIMITS.free.reportValidityDays} days.
            </Prose>
            <Prose>
              <strong>Pro</strong> — unlimited connected platforms, and a report that stays current for{" "}
              {PLAN_LIMITS.pro.reportValidityDays} days.
            </Prose>
            <Prose>
              <strong>Enterprise</strong> — unlimited platforms, a report current for{" "}
              {PLAN_LIMITS.enterprise.reportValidityDays} days, and no waiting period between reports.
            </Prose>
            <Prose>
              &ldquo;Stays current&rdquo; is how long a generated report is treated as up to date. On
              Free and Pro, you wait until the current report&rsquo;s window is up before generating a
              fresh one; a report you already generated stays downloadable either way.
            </Prose>
          </HelpSection>

          <HelpSection id="privacy" title="Your data and privacy">
            <Prose>
              Connections are read-only. Veriq reads what a platform reports you earned; it cannot spend,
              transfer, or change anything in those accounts.
            </Prose>
            <Prose>
              Nothing is shared until you decide to share it. A report exists only when you generate one,
              and it&rsquo;s only reachable by someone else once you create a share link for it. Every
              link expires on a date you choose, and you can revoke one instantly from the Sharing tab —
              anyone holding that link is locked out from that moment.
            </Prose>
            <Prose>
              When someone opens a link you shared, you see that it was viewed and roughly when.
              Veriq deliberately stores only a coarse, one-way fingerprint of the viewer&rsquo;s network
              rather than anything that identifies a person.
            </Prose>
          </HelpSection>

          <HelpSection id="faq" title="Common questions">
            <div className="flex flex-col gap-4">
              {FAQS.map((faq) => (
                <div key={faq.question} className="border-b border-hairline pb-4 last:border-b-0 last:pb-0">
                  <Disclosure label={faq.question}>
                    <p className="text-(length:--type-body-size)/(--type-body-lh) tracking-(--type-body-ls) text-ink-muted-80">
                      {faq.answer}
                    </p>
                  </Disclosure>
                </div>
              ))}
            </div>
          </HelpSection>

          <HelpSection id="contact" title="Still stuck? Contact us">
            <Prose>
              Tell us what you were trying to do and what happened instead. Mentioning the platform and
              the tab you were on helps us get to an answer faster.
            </Prose>
            <div className="mt-2">
              <ContactForm
                signedIn={user !== null}
                configured={isContactEmailConfigured()}
                defaultName={user?.fullName ?? ""}
                defaultEmail={user?.primaryEmailAddress?.emailAddress ?? ""}
              />
            </div>
          </HelpSection>
        </div>
      </main>
    </>
  );
}

// Drives the "jump to" nav and nothing else — each entry's `id` must match the HelpSection below
// it, which is what the anchor scrolls to and what labels the section for assistive tech.
const SECTIONS = [
  { id: "what-is-veriq", title: "What Veriq is" },
  { id: "getting-started", title: "Getting started" },
  { id: "connecting-platforms", title: "Connecting platforms" },
  { id: "features", title: "Every tab, explained" },
  { id: "plans", title: "Plans and limits" },
  { id: "privacy", title: "Your data and privacy" },
  { id: "faq", title: "Common questions" },
  { id: "contact", title: "Contact us" },
] as const;

// One entry per tab in components/dashboard/dashboard-shell.tsx's SECTIONS, in the same order, so
// a reader following along in the app never hits a tab this page doesn't explain.
const FEATURES: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: "Overview — your income at a glance",
    body:
      "The home tab. Three headline figures — total verified income over the last six months, what you've earned this month, and your average month — plus a bar chart of month-by-month earnings, and the list of platforms you've connected. Two short written summaries sit underneath: one generated by AI from your numbers, and one from a fixed set of rules. They're labelled separately on purpose, so you always know which is which.",
  },
  {
    title: "Calculators — what your income means",
    body:
      "Four tools built on your verified earnings. A projection of what the next months look like if things continue as they have; a stability score summarizing how steady your income is; a tax estimator for setting money aside; and an affordability calculator for what rent or repayment your income realistically supports. Each shows its working — expand 'How we calculated this' to see exactly what went into the number.",
  },
  {
    title: "Goals — targets and runway",
    body:
      "Set a monthly income target and track how the current month is tracking against it. You can also record your monthly expenses and cash on hand to see your runway — how many months you could cover if income stopped today. Goals are private to you and never appear in a report or a shared link.",
  },
  {
    title: "Expenses — what you actually keep",
    body:
      "Log business costs by category (vehicle and mileage, supplies, platform fees, phone and internet, home office, other) and mark which are tax-deductible. Veriq subtracts them from verified income to show what you actually keep, and totals your deductible spending so tax time isn't a shoebox of receipts.",
  },
  {
    title: "Report — the document lenders accept",
    body:
      "Generates the verified income PDF: your totals, your month-by-month history, and which platforms the figures came from. Choose whether to include every connected platform or only some. Generating takes a moment — the tab shows progress and the PDF downloads when it's ready. Past reports stay in the list and stay downloadable.",
  },
  {
    title: "Sharing — send proof without sending a file",
    body:
      "Turns a generated report into a private link with an expiry date you choose. Send the link instead of the PDF and the recipient always sees the current version, can't forward a stale copy, and loses access the moment the link expires or you revoke it. You can see when each link was viewed.",
  },
  {
    title: "Account — plan and billing",
    body:
      "Your current plan, what it includes, and where to upgrade or change payment details. Upgrading lifts the connected-platform cap and extends how long each report stays current.",
  },
];

const FAQS: ReadonlyArray<{ question: string; answer: string }> = [
  {
    question: "Does connecting a platform let Veriq touch my money?",
    answer:
      "No. Every connection is read-only: Veriq can read the earnings a platform reports for your account, and nothing else. It cannot move money, change settings, or post on your behalf.",
  },
  {
    question: "Why is my income lower than I expected?",
    answer:
      "The usual reason is a platform that isn't connected yet — only connected platforms count. Check the Overview tab for anything missing. Note also that verified income is what the platform reports as earnings, which may differ from what landed in your bank account after that platform's own fees.",
  },
  {
    question: "How far back does Veriq look?",
    answer:
      "Headline figures cover the last six months, which is the window lenders most often ask for. The monthly chart shows the same period so you can see the shape of it, not just the total.",
  },
  {
    question: "Can I take back a report I've already shared?",
    answer:
      "Yes. Revoke the link from the Sharing tab and it stops working immediately, even for someone who already has it. Links also expire on their own at the date you set.",
  },
  {
    question: "What happens if I disconnect a platform?",
    answer:
      "Its earnings stop counting toward your totals from that point on. Reports you already generated are point-in-time snapshots and don't change.",
  },
  {
    question: "Will a lender trust this?",
    answer:
      "The report is designed for it: figures come from the platforms themselves rather than from you, each source is named, and a share link lets the lender confirm the document is genuine and current rather than taking a PDF on faith.",
  },
];

/** One titled topic. `id` doubles as the anchor target and the heading's id, so the section is
 * labelled by the same heading the "jump to" nav links to. */
function HelpSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-20">
      <h2
        id={`${id}-heading`}
        className="text-(length:--type-lead-size)/(--type-lead-lh) tracking-(--type-lead-ls) font-semibold text-ink"
      >
        {title}
      </h2>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

function Prose({ children }: { children: ReactNode }) {
  return (
    <p className="text-(length:--type-body-size)/(--type-body-lh) tracking-(--type-body-ls) text-ink-muted-80">
      {children}
    </p>
  );
}

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-4">
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-(length:--type-fine-print-size) font-semibold text-on-primary"
      >
        {number}
      </span>
      <div>
        <h3 className="text-(length:--type-body-size)/(--type-body-lh) font-semibold text-ink">{title}</h3>
        <p className="mt-1 text-(length:--type-body-size)/(--type-body-lh) tracking-(--type-body-ls) text-ink-muted-80">
          {children}
        </p>
      </div>
    </li>
  );
}
