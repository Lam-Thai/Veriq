---
name: engineering-standards
description: The non-negotiable quality bar for ALL generated code in every runtime — the Security, Scalability, and Readability gates plus the Definition of Done checklist. Use as the final lens to judge any code change before calling a task complete.
---

# Skill: Engineering Standards
> Shared — non-negotiable baseline for ALL generated code, every agent, every runtime.

## Purpose
Other skills own the *how* (security, postgresql, etc.). This skill owns the *bar*:
nothing is "done" until it clears three gates — Security, Scalability, Readability. Every
code-generating agent references this skill in addition to its runtime-specific skills.

---

## Gate 1 — Security
Implementation detail lives in the `security` skill. This gate is the checkpoint: no code ships
without passing it.

- Auth/ownership check is always the first line of logic — never bolted on after.
- Every query that touches user data is scoped to the authenticated user — no bare ID lookups.
- All external input (body, query params, file content, webhook payloads) validated before use.
- Secrets never reach client-side code, logs, or error responses.
- No raw user input in SQL strings, shell commands, or `dangerouslySetInnerHTML`.
- Ownership failures return `404`, never `403` (don't confirm a resource exists).

## Gate 2 — Scalability
Code that works at 100 rows and falls over at 100k isn't done.

- Every list endpoint is paginated. Offset pagination is fine until a table could realistically
  exceed ~100k rows — past that, cursor/keyset (see the `postgresql` skill).
- Every column used in `WHERE`, `JOIN`, or `ORDER BY` is indexed.
- No N+1: batch-fetch or `select`/`include` related data in one query — never loop-and-query.
- Anything expected to take >500ms is dispatched as a background job (`202` pattern), not run
  inline in the request/response cycle — move it to FastAPI (`fastapi-route` agent) if it's
  Python-portable, or keep it in Next.js behind the `after()`-based async job pattern (`nextjs`
  skill) if it depends on a Node-only library. Either way, the request that kicks it off returns
  fast; the work itself never blocks a response.
- Handlers are stateless — no in-memory state that breaks on a restart or a second instance.
- Before optimizing a computation, ask whether the result should just be cached
  (Redis, `revalidate`, materialized aggregate) instead.

## Gate 3 — Readability & Maintainability
Optimize for the next developer, not just for shipping today.

- Names describe intent, not type or mechanism (`invoice`, not `invoiceData`; `isExpired`,
  not `flag`).
- A function does one thing. If describing it needs "and," split it.
- Early returns over nested conditionals — flatten, don't pyramid.
- No magic numbers or strings — named constants that carry units
  (`MAX_FILE_SIZE_BYTES`, not a bare `10485760`).
- Comments explain *why* a decision was made, not *what* the next line does — the code
  already says what.
- Exported functions/types have explicit return types and, if the name doesn't make the
  behavior obvious on its own, a one-line comment.
- Target: a new teammate understands the file's purpose within ~60 seconds of opening it.

---

## Definition of Done
Before any agent's output is considered finished:
- [ ] Security gate clear (auth first, input validated, queries user-scoped, no leaked secrets)
- [ ] No N+1; FK/WHERE/ORDER BY columns indexed; list endpoints paginated
- [ ] Anything slow (>500ms) is backgrounded, not inline
- [ ] Naming is intention-revealing; no magic numbers
- [ ] Functions are single-purpose; early-return over nesting
- [ ] A new dev could onboard to this file in under a minute

This skill doesn't replace the runtime-specific ones — it's the lens every agent checks its
own output through before calling a task complete.
