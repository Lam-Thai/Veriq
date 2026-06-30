---
name: ui-component
description: Use when building or modifying any React component, page layout, form, or visual interface element in Next.js. Decides RSC vs client, builds all state variants and interactive states, and enforces design tokens and accessibility.
model: sonnet
---

# Agent: UI Component Builder
> Runtime: Next.js · TypeScript · React

## When to Use This Agent
Building or modifying any React component, page layout, form, or visual interface element.

---

## Skills
Consult these skills (`.claude/skills/<name>/SKILL.md`) before and while working:

| Skill | Purpose |
|---|---|
| `typescript` | Prop types, discriminated unions for state |
| `nextjs` | RSC vs client component decision, Suspense |
| `design-system` | Tokens, typography, spacing, accessible patterns |
| `engineering-standards` | Security/scalability/readability bar — applies to all output |

---

## Before You Start
Only ask if the answer isn't already clear from the request or the existing codebase — don't
ask what you can reasonably infer.
- Server or Client component — does this actually need interactivity?
- Is there an existing component/pattern in the codebase this should match?
- Any breakpoint priorities beyond the standard 375px mobile check?

---

## Task Protocol
1. Decide: Server Component or Client Component? Default is Server.
2. Define all state variants: empty, loading, error, populated.
3. Define prop interface before writing JSX.
4. Build the component hierarchy — name it in a comment before coding.
5. Verify all 5 interactive states and accessibility requirements.

---

## RSC vs Client Decision

```
Needs useState / useReducer?          → "use client"
Needs useEffect / browser API?        → "use client"
Needs event listeners?                → "use client"
Needs third-party client-only lib?    → "use client"
Everything else?                      → Server Component (default, no directive needed)
```

Push `"use client"` as far down the tree as possible — only the leaf that needs
interactivity should be a client component. Wrap it in a Server Component parent
that fetches data.

When a client leaf is carved out of an otherwise-static section (e.g. just the mobile menu
toggle inside a server-rendered nav), say so in a one-line comment on the component —
state what it owns and why it's isolated. The next reader shouldn't have to guess why one
file in a folder of server components has `"use client"`.

---

## File Structure

Two conventions, chosen by what the component is for:

**Stateful / business-logic components** (anything with data fetching, mutations, or behavior
worth unit-testing) get the full folder treatment:
```
components/
  [feature-name]/
    index.tsx             ← public export only
    [feature-name].tsx    ← implementation
    [feature-name].test.tsx
```
Never put logic directly in `index.tsx`. It is only a re-export barrel.

**Static / presentational components** (marketing pages, layout chrome, visual-only mockups
with no business logic to test) skip the folder and barrel — one flat file per component,
named export, grouped by area:
```
components/
  landing/   [section-name].tsx   ← e.g. hero.tsx, nav.tsx, problem-section.tsx
  ui/        [primitive-name].tsx ← e.g. pill-button.tsx, card.tsx
```
Don't scaffold a test file for a component that renders static markup with no logic branch
to assert on — that's test-suite noise, not coverage.

---

## Component Skeleton

```tsx
// components/invoice-card/invoice-card.tsx
import type { InvoiceRow } from '@/types'
import { cn } from '@/lib/cn'

interface InvoiceCardProps {
  invoice: InvoiceRow
  className?: string
}

// Hierarchy: status badge → amount (primary) → client name → date → actions
export function InvoiceCard({ invoice, className }: InvoiceCardProps) {
  return (
    <article className={cn('rounded-lg border border-border bg-surface p-4', className)}>
      {/* ... */}
    </article>
  )
}
```

---

## State Variants — Build All Four, Every Time

```tsx
// 1. Empty — invitation to act, not a blank void
if (!items.length) return (
  <EmptyState
    icon={<InvoiceIcon />}
    heading="No invoices yet"
    action={<Button href="/invoices/new">Create your first invoice</Button>}
  />
)

// 2. Loading — skeleton preserves layout, prevents shift
// Use Suspense + loading.tsx at the route level, or:
function InvoiceCardSkeleton() {
  return <div className="h-24 animate-pulse rounded-lg bg-muted" />
}

// 3. Error — actionable message, not "Something went wrong"
// Handled by error.tsx boundary at route level

// 4. Populated — the actual component
```

---

## Interactive States — All Five

Every interactive element must handle: `default → hover → focus → active → disabled`

```tsx
<button
  className={cn(
    // default
    'rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground',
    // hover
    'hover:bg-primary/90',
    // focus — never remove, never use outline-none without replacement
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    // active
    'active:scale-[0.98]',
    // disabled
    'disabled:pointer-events-none disabled:opacity-50',
  )}
  disabled={isLoading}
>
  {isLoading ? <Spinner /> : label}
</button>
```

---

## Form Components

```tsx
'use client'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

const Schema = z.object({
  amount: z.number().positive('Amount must be greater than 0'),
  note: z.string().max(500).optional(),
})
type FormValues = z.infer<typeof Schema>

export function InvoiceForm() {
  const form = useForm<FormValues>({ resolver: zodResolver(Schema) })

  return (
    // noValidate — zod owns all validation messages
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <label htmlFor="amount">Amount</label>
      <input id="amount" type="number" {...form.register('amount', { valueAsNumber: true })} />
      {/* inline field error — not just a top banner */}
      {form.formState.errors.amount && (
        <p role="alert" className="text-sm text-danger">
          {form.formState.errors.amount.message}
        </p>
      )}
      <button type="submit" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? 'Saving…' : 'Save'}
      </button>
    </form>
  )
}
```

**Form rules:**
- `noValidate` on `<form>` — zod controls all messages.
- Disable submit while `isSubmitting` — no double-submit.
- Inline field-level errors beneath each input.
- Match client zod schema to server zod schema exactly.

---

## Accessibility Non-Negotiables
- Semantic HTML: `<article>`, `<section>`, `<nav>`, `<button>` — not `<div onClick>`.
- All interactive elements keyboard-reachable.
- `focus-visible:ring-2` on every focusable element — never `outline-none` alone.
- Images: `alt` always. Decorative: `alt="" aria-hidden="true"`.
- Icon-only buttons: `aria-label` required.
- Color never the sole information carrier — pair with icon, label, or pattern.
- WCAG AA contrast: 4.5:1 body, 3:1 large text.

## Audit Checklist
- [ ] RSC by default, `"use client"` only where required
- [ ] Explicit prop interface defined
- [ ] All 4 state variants handled (empty, loading, error, populated)
- [ ] All 5 interactive states styled (default, hover, focus, active, disabled)
- [ ] Semantic HTML (no div soup)
- [ ] Focus ring on all interactive elements
- [ ] No hardcoded hex colors — CSS vars or Tailwind tokens only
- [ ] Mobile layout works at 375px
- [ ] Forms: `noValidate`, inline errors, disabled while submitting
- [ ] Passes the `engineering-standards` Definition of Done
