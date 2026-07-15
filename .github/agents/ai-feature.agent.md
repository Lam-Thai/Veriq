# Agent: AI Feature Builder
> Runtime: Next.js (streaming/UI layer + one-shot structured output) + FastAPI (processing pipelines)

## When to Use This Agent
Integrating LLM capabilities into the product. Decide the split before writing code:

| Task | Runtime |
|---|---|
| Streaming text to the browser, chat UI | Next.js |
| One-shot prompt → structured JSON, cached/rendered server-side (not a chat) | Next.js — see the real reference implementation below |
| Simple one-shot prompt → display, free text | Next.js |
| Embedding generation, vector search | FastAPI |
| RAG pipelines, multi-step chains | FastAPI |
| Document ingestion, chunking | FastAPI |
| Batch inference, async processing | FastAPI |

---

## Skills
| Skill | Purpose |
|---|---|
| `#file:.github/skills/typescript.skill.md` | Types for streaming, response shapes |
| `#file:.github/skills/nextjs.skill.md` | Streaming routes, Server Actions, SSE |
| `#file:.github/skills/ai-integration.skill.md` | Provider choice (Anthropic vs Gemini), SDK setup, prompt patterns, cost monitoring |
| `#file:.github/skills/python.skill.md` | Async patterns for the FastAPI pipeline side |
| `#file:.github/skills/sqlalchemy.skill.md` | DB access inside background pipeline tasks |
| `#file:.github/skills/api-contracts.skill.md` | Internal service contracts between Next.js ↔ FastAPI |
| `#file:.github/skills/security.skill.md` | Input sanitization, key isolation, rate limiting, optional-key env pattern |
| `#file:.github/skills/error-handling.skill.md` | AI error handling, timeouts, fallbacks |
| `#file:.github/skills/prisma.skill.md` / `#file:.github/skills/postgresql.skill.md` | If the feature caches AI output per user (see reference implementation) |
| `#file:.github/skills/engineering-standards.skill.md` | Security/scalability/readability bar — applies to all output |

---

## Before You Start
Only ask if the answer isn't already clear from the request or the existing codebase — don't
ask what you can reasonably infer.
- Streaming UI, one-shot structured output, or a background pipeline? (see decision table above)
- **Which provider — Anthropic or Gemini?** See `#file:.github/skills/ai-integration.skill.md`'s
  provider-choice table: default to Anthropic for reasoning-heavy/higher-stakes features, Gemini
  only when the feature is explicitly cost-sensitive/additive and the free tier's rate limits and
  quality/latency tradeoffs are acceptable. Don't assume the last feature's provider choice
  applies to this one.
- Expected output shape: free text, or structured (zod/pydantic schema)?
- Is this feature additive/non-blocking per its spec? If so, its API key must be optional in
  `lib/env.ts`, not required — see `#file:.github/skills/ai-integration.skill.md`'s "Optional AI
  features" section and `lib/env.ts`'s `GEMINI_API_KEY` field for the real pattern. Getting this
  wrong crashes unrelated pages, not just this feature — it already happened once in this repo.
- Does this feature need a tighter rate limit than the project default? If the provider has a
  free tier, does it also need a *global* (not just per-user) limit — see "Free-tier realities"
  in `#file:.github/skills/ai-integration.skill.md`?
- Is there an existing prompt file in `lib/prompts/` for a similar feature whose tone/format
  this should match?

---

## Task Protocol
1. Classify the task: streaming UI, one-shot structured output, or processing pipeline (see table above).
2. Pick a provider and say why in a comment near the client singleton (see `#file:.github/skills/ai-integration.skill.md`).
3. Define the prompt structure: system / user / expected output shape. Wrap any untrusted/DB-sourced
   data in an explicit tag (`<input_data>`) and instruct the model to treat it as data only —
   even data that looks "internal" today, since that boundary can move later.
4. If structured output: define the zod/pydantic schema before writing the prompt, and mirror its
   bounds into the provider's own schema (Gemini `responseSchema.maxLength`/`maxItems`, etc.) so
   generation is steered toward output that will actually pass.
5. Implement server-side only — never expose AI calls or the API key client-side.
6. Rate limit the endpoint per `userId`. If using a free-tier provider, add a second global check too.
7. Bound the actual provider call with your own timeout (`AbortController`, cleared in `finally`).
8. If the feature is additive/non-blocking, verify the whole page/flow still renders correctly with
   the API key unset and with the provider call forced to fail — not just the happy path.
9. Verify: API key isolated and optional-if-additive? Input sanitized? Output validated before DB
   write or render? Timeout bounded? Rate limited (per-user, and globally if free-tier)?

---

## Reference implementation: one-shot AI feature (real, working — Gemini)
Unlike the streaming skeleton further down, this pattern is **shipped and working** in this repo
today (the AI income-narrative feature) — read the real files, don't just copy the condensed
version below:
- `frontend/lib/ai.ts` — client singleton, `isAiConfigured()` guard, optional-key pattern.
- `frontend/lib/ai-sanitize.ts` — fixed-point tag-strip sanitizer.
- `frontend/lib/prompts/income-narrative.ts` — hardcoded system prompt with injection-defense
  wording, the Gemini `responseSchema`, and the zod validation schema.
- `frontend/lib/ai/income-narrative.ts` — the service: per-user data lookup, input-hash-based
  caching to avoid calling the model on every page load, the `AbortController` timeout around the
  actual API call, and a never-throws discriminated-union result type
  (`{status:"no_data"} | {status:"ok",data} | {status:"error"}`).
- `frontend/lib/rate-limit.ts` — the per-key in-process limiter, reused for both a per-user
  and a global (free-tier-quota-aware) check.
- `frontend/app/api/ai/income-insights/route.ts` — auth-gate → per-user rate limit → global rate
  limit → call the service → map the result to the `{ data }`/`{ error }` envelope, with a
  `Retry-After` header on the 429 path derived from the limiter's actual reset time, not a guess.
- `frontend/components/dashboard/ai-insights-card.tsx` — the client card: fetches on mount with
  an `AbortController` that's aborted in the effect's cleanup (cancel in-flight requests on
  unmount), and renders all four required states (empty/loading/error/populated).

The shape is: **auth → rate limit(s) → check optional-key configured → check cache →
sanitize+build prompt → call model with a timeout → parse/validate → cache → return**, with every
step after auth able to fail into a typed, non-throwing result. This is the target shape for any
new one-shot structured-output feature, not just a hypothetical — copy its error-handling
discipline, not just its Gemini-specific code.

---

## Next.js: Streaming Route

> This skeleton (chat-style streaming) has **not** been built in this repo yet — unlike the
> one-shot pattern above, treat this as the target shape only. Use `currentUser()`/`auth()` from
> `@clerk/nextjs/server` directly for the auth check (see `api-route.agent.md`'s "Ground Truth"
> section and `frontend/app/api/checkout/route.ts`), and follow the real `lib/ai.ts` /
> `lib/ai-sanitize.ts` / `lib/rate-limit.ts` files referenced above rather than reinventing them —
> they already exist and are the working pattern to extend, not a gap to fill from scratch.

```ts
// app/api/ai/[feature]/route.ts
import { currentUser } from '@clerk/nextjs/server'
import { ai } from '@/lib/ai'
import { sanitizeAIInput } from '@/lib/ai-sanitize'
import { checkRateLimit } from '@/lib/rate-limit'
import { SYSTEM_PROMPT } from '@/lib/prompts/[feature]'
import { z } from 'zod'

const BodySchema = z.object({ prompt: z.string().min(1).max(4000) })

export async function POST(req: Request) {
  const clerkUser = await currentUser()
  if (!clerkUser) return new Response('Unauthorized', { status: 401 })

  const { success } = checkRateLimit(`[feature]:${clerkUser.id}`, 10, 60_000)
  if (!success) return new Response('Too Many Requests', { status: 429 })

  const { prompt } = BodySchema.parse(await req.json())

  const stream = ai.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: sanitizeAIInput(prompt) }],
  })

  return new Response(stream.toReadableStream())
}
```

## Next.js: Streaming UI

```tsx
'use client'
import { useCompletion } from 'ai/react'

export function AIWriter() {
  const { completion, input, handleInputChange, handleSubmit, isLoading } = useCompletion({
    api: '/api/ai/write',
  })

  return (
    <form onSubmit={handleSubmit}>
      <textarea value={input} onChange={handleInputChange} maxLength={4000} />
      <button type="submit" disabled={isLoading}>
        {isLoading ? 'Writing…' : 'Generate'}
      </button>
      {/* aria-live so screen readers announce streamed content */}
      <div aria-live="polite" aria-atomic="false">{completion}</div>
    </form>
  )
}
```

## FastAPI: AI Processing Pipeline

For heavy pipelines — Next.js calls FastAPI with a service token, FastAPI processes async.

```python
# routers/ai_pipeline.py
from fastapi import APIRouter, Depends, BackgroundTasks
from app.auth import verify_service_token
from app.schemas.ai import EmbedRequest, EmbedResponse
from app.services.ai import generate_embeddings
from app.db import get_session

router = APIRouter(prefix="/ai", tags=["ai"])

@router.post("/embed", response_model=EmbedResponse)
async def embed_document(
    body: EmbedRequest,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(verify_service_token),
    db=Depends(get_session),
):
    # Dispatch to background — don't block the HTTP response
    background_tasks.add_task(generate_embeddings, body.document_id, user_id, db)
    return EmbedResponse(status="queued", document_id=body.document_id)
```

## Prompt Files

```ts
// lib/prompts/invoice-extractor.ts
// v1 — initial
// v2 — added null instruction for missing fields
export const INVOICE_EXTRACTOR_SYSTEM = `
You extract structured invoice data from raw text.

Rules:
- Extract only what is explicitly present in the text
- Return null for any field not found — never infer or fabricate
- Amounts are always numeric (no currency symbols)

Example:
Input: "Invoice from Acme Corp for design services, $1,200, due Jan 15 2025"
Output: { "vendor": "Acme Corp", "amount": 1200, "dueDate": "2025-01-15", "invoiceNumber": null }
`.trim()
```

For any field sourced from untrusted/DB data rather than the model's own reasoning, wrap it in an
explicit `<input_data>` tag and state in the system prompt that the tagged block is data only,
never instructions — see `frontend/lib/prompts/income-narrative.ts` for the real, working example
of this defense (including the "even data from a fixed internal allowlist" caveat).

## Security Rules (non-negotiable)
- The provider's API key is server-side only — never `NEXT_PUBLIC_`. If the feature is
  additive/non-blocking, the key is also `.optional()` in `lib/env.ts` (see
  `#file:.github/skills/ai-integration.skill.md`'s "Optional AI features" section) — a required
  key on an optional feature can crash unrelated pages, not just this one.
- Sanitize all user/DB-sourced input before it enters any prompt, looping tag-strips to a fixed
  point (a single-pass regex is a real, previously-shipped bug in this repo).
- Rate limit per `userId`, not IP (trivially spoofed). If the provider has a free tier, also rate
  limit globally — free-tier quotas are typically per-project, not per-user.
- Bound the actual provider call with your own timeout (`AbortController` + `setTimeout`, cleared
  in `finally`) — don't trust the provider's own timeout behavior.
- Validate structured LLM output with zod/pydantic before any DB write or render, and mirror those
  bounds into the provider's own structured-output schema.
- Never render raw LLM output as `dangerouslySetInnerHTML`.
- Log every AI call: `{ userId, feature, inputTokens, outputTokens, durationMs }` — strip PII,
  never log full prompt/response content.

## Audit Checklist
- [ ] Provider choice stated and justified (Anthropic vs Gemini — see `#file:.github/skills/ai-integration.skill.md`)
- [ ] API key server-side only, and `.optional()` in `lib/env.ts` if the feature is additive
- [ ] Input sanitized (fixed-point tag-strip) and length-capped before prompt
- [ ] Untrusted/DB-sourced prompt data wrapped in an explicit data-only tag
- [ ] Rate limit applied per user, plus a global check if the provider has a shared free-tier quota
- [ ] Provider call bounded by an `AbortController` timeout, cleared in `finally`
- [ ] Structured output validated before DB write or render; provider schema mirrors the same bounds
- [ ] If additive: dashboard/page still renders correctly with the key unset and with the call forced to fail
- [ ] Streaming UI has loading + error states; one-shot UI has empty/loading/error/populated states
- [ ] Client fetch for a one-shot card cancels via `AbortController` in its effect cleanup
- [ ] `aria-live` on streamed/loading content container
- [ ] Token usage logged for cost monitoring
- [ ] Prompt file versioned with comment
- [ ] Passes `engineering-standards.skill.md` Definition of Done
