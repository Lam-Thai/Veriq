---
name: typescript
description: TypeScript conventions for the Next.js runtime — strict config, type patterns (discriminated unions, zod inference, branded IDs, satisfies, unknown over any), and rules for return types and assertions. Use when writing or reviewing any .ts/.tsx code.
---

# Skill: TypeScript

## Config (non-negotiable)
```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

## Type Patterns

### Prefer `type` for shapes, `interface` only when extending
```ts
type Invoice = { id: string; total: number; status: InvoiceStatus }
interface Repository<T> { findById(id: string): Promise<T | null> }
```

### Discriminated unions for async/state modeling
```ts
type AsyncState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: Error }
```

### Infer types from zod — never duplicate
```ts
const InvoiceSchema = z.object({
  id: z.string().cuid(),
  total: z.number().positive(),
  status: z.enum(['DRAFT', 'SENT', 'PAID', 'VOID']),
})
type Invoice = z.infer<typeof InvoiceSchema>
```

### `satisfies` to validate without widening
```ts
const config = { theme: 'dark', locale: 'en-CA' } satisfies Partial<AppConfig>
```

### `unknown` over `any` for untyped external data
```ts
function processWebhook(data: unknown) {
  const parsed = WebhookSchema.safeParse(data)
  if (!parsed.success) throw new ValidationError(parsed.error)
}
```

### Branded IDs — prevent passing InvoiceId where UserId is expected
```ts
type UserId = string & { readonly _brand: 'UserId' }
type InvoiceId = string & { readonly _brand: 'InvoiceId' }
```

### `exactOptionalPropertyTypes` — `?:` is not the same as `| undefined`
This repo has `exactOptionalPropertyTypes: true`, so a property declared `foo?: string` accepts
"absent" but **rejects an explicit `undefined` value**. Passing a `string | undefined` expression
(a zod-`.optional()` field, another optional prop, `map.get()`, `searchParams.get() ?? undefined`)
into a `foo?: string` slot fails to compile. When a value that may be `undefined` is forwarded, type
the receiving optional as `| undefined` explicitly:
```ts
// ✗ TS2375 under exactOptionalPropertyTypes when `errors` can be undefined
type Props = { errors?: string[] }
// ✓ accepts both "absent" and an explicit undefined value
type Props = { errors?: string[] | undefined }
// same for function params that receive a possibly-undefined optional:
function list(opts: { category?: Category | undefined; limit: number }) { /* ... */ }
```
Don't "fix" this by stripping the value with `!` or a cast — widen the target type, or omit the key
entirely (build the object conditionally) so it's genuinely absent rather than `undefined`.

## Rules
- `any` only with a comment: `// any: zod validates at runtime`
- `as T` only when narrowing is impossible and you can prove correctness
- Annotate return types on all exported functions
- `Partial<T>` on params is usually wrong — model optional fields explicitly
