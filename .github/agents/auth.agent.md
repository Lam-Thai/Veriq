# Agent: Authentication & Authorization
> Runtime: Next.js · TypeScript

## When to Use This Agent
Any work touching user identity: login flows, session management, route protection,
role-based access control, resource ownership checks, or OAuth setup.

This entire domain lives in Next.js. FastAPI services authenticate by validating the
session token passed in the `Authorization` header from Next.js.

---

## Skills
| Skill | Purpose |
|---|---|
| `#file:.github/skills/typescript.skill.md` | Types, session extension, role enums |
| `#file:.github/skills/nextjs.skill.md` | Middleware, App Router, Server Actions |
| `#file:.github/skills/prisma.skill.md` | Ownership-scoped queries, adapter model |
| `#file:.github/skills/api-contracts.skill.md` | 404-not-403 envelope for ownership failures |
| `#file:.github/skills/security.skill.md` | Cookie flags, token expiry, brute force protection |
| `#file:.github/skills/error-handling.skill.md` | Auth failure handling, structured logging |
| `#file:.github/skills/engineering-standards.skill.md` | Security/scalability/readability bar — applies to all output |

---

## Before You Start
Only ask if the answer isn't already clear from the request or the existing codebase — don't
ask what you can reasonably infer.
- OAuth provider(s), credentials login, or both?
- What roles does the app need, beyond any `Role` enum that already exists in the schema?
- Does this touch an existing session/JWT shape, or is it new?

---

## Task Protocol
1. Clarify: OAuth providers, credentials, or both?
2. Clarify: what roles does this app need?
3. Implement auth provider + session config.
4. Implement middleware guard for all protected routes.
5. Implement per-resource ownership checks in API routes.
6. Generate the session token format that FastAPI services will validate.

---

## Auth Stack: next-auth v5

```ts
// lib/auth.ts
import NextAuth from 'next-auth'
import GitHub from 'next-auth/providers/github'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { db } from '@/lib/db'

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  providers: [GitHub],
  session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 7 }, // 7d
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = user.role
      }
      return token
    },
    session({ session, token }) {
      session.user.id = token.id as string
      session.user.role = token.role as Role
      return session
    },
  },
  pages: { signIn: '/login', error: '/login' },
})
```

## Middleware Guard

```ts
// middleware.ts — runs before every matched request
import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'

export default auth((req) => {
  const authed = !!req.auth
  const appRoute = req.nextUrl.pathname.startsWith('/app')
  // FastAPI routes are internal — only Next.js public API needs guarding here
  const apiRoute = req.nextUrl.pathname.startsWith('/api') &&
    !req.nextUrl.pathname.startsWith('/api/auth')

  if ((appRoute || apiRoute) && !authed) {
    return NextResponse.redirect(new URL('/login', req.url))
  }
})

export const config = { matcher: ['/app/:path*', '/api/:path*'] }
```

## FastAPI Service Authentication

Next.js issues a short-lived JWT that FastAPI validates on every request.

```ts
// lib/service-token.ts — Next.js generates this for internal service calls
import { SignJWT } from 'jose'

export async function createServiceToken(userId: string, role: string) {
  return new SignJWT({ sub: userId, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('5m')  // short-lived, internal use only
    .sign(new TextEncoder().encode(process.env.INTERNAL_JWT_SECRET))
}

// Usage: attach to outbound fetch calls to FastAPI
const token = await createServiceToken(session.user.id, session.user.role)
const res = await fetch(`${process.env.FASTAPI_URL}/process`, {
  headers: { Authorization: `Bearer ${token}` },
})
```

## Resource Ownership Pattern

```ts
// WRONG — fetches by ID alone, IDOR vulnerability
const invoice = await db.invoice.findUnique({ where: { id } })

// CORRECT — scoped to authenticated user
const invoice = await db.invoice.findUnique({
  where: { id, userId: session.user.id },
  select: { id: true, total: true, status: true },
})
if (!invoice) return ApiError.notFound() // 404, not 403
```

## Role Guard

```ts
// lib/permissions.ts
export type Role = 'user' | 'admin' | 'owner'

export function assertRole(session: Session, required: Role) {
  if (session.user.role !== required) throw new ForbiddenError()
}

// Usage in route handler (after auth check)
assertRole(session, 'admin')
```

## Type Extension

```ts
// types/next-auth.d.ts
import 'next-auth'
import type { Role } from '@/lib/permissions'

declare module 'next-auth' {
  interface User { role: Role }
  interface Session { user: User & { id: string } }
}
declare module 'next-auth/jwt' {
  interface JWT { id: string; role: Role }
}
```

## Security Rules
- Never store passwords in plaintext. Hash with `bcryptjs`, 12 rounds minimum.
- Session cookies: `httpOnly`, `secure` (prod), `sameSite: lax`.
- JWT payload: `userId` + `role` only — no email, no PII, no secrets.
- Rate limit `/api/auth/callback/credentials` against brute force.
- Re-authenticate before sensitive operations (delete account, change email, payment).
- 404 for ownership failures — never 403 (information leak).
- Log all auth failures server-side: `{ ip, email, reason, timestamp }`.

## Audit Checklist
- [ ] Session validated before any data access
- [ ] Resource queries scoped to `session.user.id`
- [ ] Role checks on admin-only operations
- [ ] Cookie flags: httpOnly, secure, sameSite
- [ ] No PII in JWT payload
- [ ] Rate limit on credentials login endpoint
- [ ] Service tokens short-lived (<10min) for FastAPI calls
- [ ] Re-auth required for destructive account actions
- [ ] Passes `engineering-standards.skill.md` Definition of Done
