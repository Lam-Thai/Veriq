# Skill: AI Integration (Anthropic SDK)

## Model
Always: `claude-sonnet-4-6`

## TypeScript Setup (Next.js)
```ts
// lib/ai.ts — server-side singleton
import Anthropic from '@anthropic-ai/sdk'
export const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
// NEVER process.env.NEXT_PUBLIC_ANTHROPIC_API_KEY
```

## Python Setup (FastAPI)
```python
# app/ai.py
import anthropic
from app.core.config import settings

client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
async_client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
```

---

## Patterns

### Streaming (Next.js → browser)
```ts
const stream = ai.messages.stream({
  model: 'claude-sonnet-4-6',
  max_tokens: 1024,
  system: SYSTEM_PROMPT,
  messages: [{ role: 'user', content: sanitizeAIInput(prompt) }],
})
return new Response(stream.toReadableStream())
```

### Structured Output via Tool Use (both runtimes)
```ts
// TypeScript
const response = await ai.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 1024,
  tools: [{ name: 'output', description: '...', input_schema: { type: 'object', properties: {...}, required: [...] } }],
  tool_choice: { type: 'tool', name: 'output' },
  messages: [{ role: 'user', content: input }],
})
const raw = response.content.find(b => b.type === 'tool_use')?.input
const data = OutputSchema.parse(raw)  // always validate
```

```python
# Python (FastAPI pipeline)
response = await async_client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=1024,
    tools=[{"name": "output", "description": "...", "input_schema": {...}}],
    tool_choice={"type": "tool", "name": "output"},
    messages=[{"role": "user", "content": sanitized_input}],
)
tool_block = next(b for b in response.content if b.type == "tool_use")
data = OutputModel(**tool_block.input)  # pydantic validates
```

---

## Prompt Management
```ts
// lib/prompts/[feature].ts
// v1 — initial
// v2 — added null instruction for missing fields
export const INVOICE_EXTRACTOR_SYSTEM = `
You extract structured invoice data from raw text.
Return null for any field not found — never infer or fabricate.

Example:
Input: "Invoice from Acme Corp, $1,200 CAD, due Jan 15"
Output: { "vendor": "Acme Corp", "amount": 1200, "currency": "CAD", "dueDate": "2025-01-15" }
`.trim()
```

Rules:
- One file per prompt in `lib/prompts/` (TS) or `app/prompts/` (Python).
- Version comment on every change.
- 1–2 worked examples for extraction/classification tasks.
- System prompt is a constant — never build from user input.

## Input Sanitization
```ts
// lib/ai-sanitize.ts
export function sanitizeAIInput(raw: string): string {
  return raw.trim().slice(0, 4000).replace(/<[^>]*>/g, '').replace(/\x00/g, '')
}
```

## Security Rules
- API key: server-side only, never `NEXT_PUBLIC_`, never logged.
- Sanitize and length-cap all user input before prompt.
- Rate limit per `userId` — not IP.
- Validate all structured outputs (zod/pydantic) before DB writes.
- Never `dangerouslySetInnerHTML` with LLM output.
- Log: `{ userId, feature, inputTokens, outputTokens, durationMs }` — strip PII.
