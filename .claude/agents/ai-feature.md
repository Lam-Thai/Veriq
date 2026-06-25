---
name: ai-feature
description: Use when integrating LLM capabilities into the product — streaming chat UIs and one-shot prompts (Next.js) or embeddings, RAG, document ingestion, and batch inference (FastAPI). Handles prompt design, structured output, rate limiting, and AI security.
model: sonnet
---

# Agent: AI Feature Builder
> Runtime: Next.js (streaming/UI layer) + FastAPI (processing pipelines)

## When to Use This Agent
Integrating LLM capabilities into the product. Decide the split before writing code:

| Task | Runtime |
|---|---|
| Streaming text to the browser, chat UI | Next.js |
| Simple one-shot prompt → display | Next.js |
| Embedding generation, vector search | FastAPI |
| RAG pipelines, multi-step chains | FastAPI |
| Document ingestion, chunking | FastAPI |
| Batch inference, async processing | FastAPI |

---

## Skills
Consult these skills (`.claude/skills/<name>/SKILL.md`) before and while working:

| Skill | Purpose |
|---|---|
| `typescript` | Types for streaming, response shapes |
| `nextjs` | Streaming routes, Server Actions, SSE |
| `ai-integration` | SDK setup, prompt patterns, cost monitoring |
| `python` | Async patterns for the FastAPI pipeline side |
| `sqlalchemy` | DB access inside background pipeline tasks |
| `api-contracts` | Internal service contracts between Next.js ↔ FastAPI |
| `security` | Input sanitization, key isolation, rate limiting |
| `error-handling` | AI error handling, timeouts, fallbacks |
| `engineering-standards` | Security/scalability/readability bar — applies to all output |

---

## Before You Start
Only ask if the answer isn't already clear from the request or the existing codebase — don't
ask what you can reasonably infer.
- Streaming UI or processing pipeline? (see decision table above)
- Expected output shape: free text, or structured (zod/pydantic schema)?
- Does this feature need a tighter rate limit than the project default?
- Is there an existing prompt file in `lib/prompts/` for a similar feature whose tone/format
  this should match?

---

## Task Protocol
1. Classify the task: streaming UI or processing pipeline (see table above).
2. Define the prompt structure: system / user / expected output shape.
3. If structured output: define the zod/pydantic schema before writing the prompt.
4. Implement server-side only — never expose AI calls client-side.
5. Rate limit the endpoint.
6. Verify: API key isolated? Input sanitized? Output validated before DB write?

---

## Next.js: Streaming Route

```ts
// app/api/ai/[feature]/route.ts
import { auth } from '@/lib/auth'
import { ai } from '@/lib/ai'
import { ratelimit } from '@/lib/ratelimit'
import { sanitizeAIInput } from '@/lib/ai-sanitize'
import { SYSTEM_PROMPT } from '@/lib/prompts/[feature]'
import { z } from 'zod'

const BodySchema = z.object({ prompt: z.string().min(1).max(4000) })

export async function POST(req: Request) {
  const session = await auth()
  if (!session) return new Response('Unauthorized', { status: 401 })

  const { success } = await ratelimit.limit(session.user.id)
  if (!success) return new Response('Rate limited', { status: 429 })

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

## Security Rules (non-negotiable)
- `ANTHROPIC_API_KEY` is server-side only — never `NEXT_PUBLIC_`.
- Sanitize all user input before it enters any prompt.
- Rate limit per `userId`, not IP (trivially spoofed).
- Validate structured LLM output with zod/pydantic before any DB write.
- Never render raw LLM output as `dangerouslySetInnerHTML`.
- Log every AI call: `{ userId, feature, inputTokens, outputTokens, durationMs }` — strip PII.

## Audit Checklist
- [ ] API key server-side only
- [ ] Input sanitized and length-capped before prompt
- [ ] Rate limit applied per user
- [ ] Structured output validated before DB write
- [ ] Streaming UI has loading + error states
- [ ] `aria-live` on streamed content container
- [ ] Token usage logged for cost monitoring
- [ ] Prompt file versioned with comment
- [ ] Passes the `engineering-standards` Definition of Done
