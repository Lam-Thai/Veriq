---
name: nextjs
description: Next.js App Router patterns — RSC vs client component decision, folder conventions, data fetching/caching, Server Actions, middleware auth guards, and security headers. Use when building Next.js routes, pages, layouts, or mutations.
---

# Skill: Next.js (App Router)

## Check the Installed Version First
This repo can pin a Next.js major version newer than your training data (check
`frontend/package.json`). If `frontend/AGENTS.md` says so explicitly, treat it as
authoritative: skim `node_modules/next/dist/docs/` for the APIs you're about to use before
relying on patterns from memory — caching defaults, config shape, and route conventions have
all changed across majors.

## RSC Decision Rule
Default: Server Component. Add `"use client"` only when you need:
- `useState` / `useReducer` / `useEffect`
- Browser APIs (`window`, `document`, `navigator`)
- Event handlers attached to DOM elements
- Third-party client-only libraries

## Folder Conventions
```
app/
  (marketing)/        ← route group, shared layout, no URL segment
    page.tsx
    layout.tsx
  (app)/
    dashboard/
      page.tsx
      loading.tsx     ← Suspense fallback (auto-wrapped by Next.js)
      error.tsx       ← Error boundary
    [resource]/
      page.tsx
      [id]/page.tsx
  api/
    [resource]/
      route.ts        ← GET list, POST create
      [id]/route.ts   ← GET single, PATCH, DELETE
components/           ← shared UI
lib/                  ← business logic, db, auth, utils
lib/prompts/          ← AI prompt files, one per feature
types/                ← shared TypeScript types
```

## Data Fetching
```ts
// Fetch in Server Components — not useEffect
async function InvoicePage({ params }: { params: { id: string } }) {
  const invoice = await getInvoice(params.id)
  return <InvoiceView invoice={invoice} />
}

// Cache control
fetch(url, { cache: 'no-store' })           // user-specific — no cache
fetch(url, { next: { revalidate: 3600 } })  // shared data — revalidate hourly

// Request-level deduplication
import { cache } from 'react'
export const getUser = cache(async (id: string) => db.user.findUnique({ where: { id } }))
```

## Server Actions (mutations)
```ts
'use server'
import { auth } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

export async function createInvoice(formData: FormData) {
  const session = await auth()
  if (!session) throw new Error('Unauthorized')  // auth first

  const parsed = InvoiceSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.flatten() }

  await db.invoice.create({ data: { ...parsed.data, userId: session.user.id } })
  revalidatePath('/app/invoices')
}
```

## Middleware
```ts
// middleware.ts
import { auth } from '@/lib/auth'

export default auth((req) => {
  const authed = !!req.auth
  const appRoute = req.nextUrl.pathname.startsWith('/app')
  const apiRoute = req.nextUrl.pathname.startsWith('/api') &&
    !req.nextUrl.pathname.startsWith('/api/auth')

  if ((appRoute || apiRoute) && !authed) {
    return NextResponse.redirect(new URL('/login', req.url))
  }
})
export const config = { matcher: ['/app/:path*', '/api/:path*'] }
```

## Security Headers (next.config.ts)
```ts
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]
export default { async headers() { return [{ source: '/(.*)', headers: securityHeaders }] } }
```

## Rules
- `revalidatePath` / `revalidateTag` after every mutation
- `loading.tsx` at every route fetching async data
- `error.tsx` at every route — never let raw errors reach the user
- Avoid client-side `fetch('/api/...')` when Server Action or RSC fetch works
