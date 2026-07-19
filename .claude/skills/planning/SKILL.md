---
name: planning
description: Methodology for turning a scoped goal into a phased, sequenced implementation plan — phase-sizing rules, dependency ordering, risk/open-question discipline, and the agent-routing table mapping each phase to the specialized agent that owns it. Use before implementation starts on any multi-step or multi-agent change, or whenever "just start coding" would hide an ordering risk or an unresolved unknown.
---

# Skill: Planning

## Philosophy
A plan's job is to de-risk *sequencing and ownership* before code exists — not to write the code,
and not to perform certainty the investigation doesn't actually have. A plan that hides an open
question isn't safer than one that names it; it just fails later, mid-implementation, when it's
more expensive to fix.

---

## Definition of Ready (before planning starts)
A goal is ready to plan when it has:
- A one-sentence outcome (the "why," not just the "what").
- A rough scope boundary — even an informal one.

If it doesn't have that yet, the first output of a planning pass is a Goal/Scope draft (reusing
the `github-issues` skill's Goal / Scope / Acceptance Criteria / Out of Scope template) — not a
half-formed phase breakdown built on a goal nobody's confirmed.

If the goal has open factual questions (does this library support X, how does the existing code
handle Y), close them with `research` first. Planning on top of an unverified assumption just
moves the risk downstream instead of removing it.

---

## Phase Sizing
- Each phase is independently shippable or independently reviewable — not an arbitrary line cut
  through related work.
- **The one-sentence test:** if a phase's description needs "and" to fit in one sentence, it's
  two phases. ("Add the schema column and wire up the API route" → split.)
- A phase that has no clear single owning agent is usually mis-sized — either it's actually two
  phases with two owners, or it's been cut at the wrong seam.

---

## Dependency Sequencing
State dependencies as edges, not as prose buried in a paragraph: `depends on: phase 2`, or
`depends on: none`. Common cross-runtime orderings in this repo:
- A Prisma schema change lands and migrates **before** the SQLAlchemy mirror is written against
  it — SQLAlchemy never leads schema truth, per the `sqlalchemy` skill.
- A `migration` phase precedes any `fastapi-route`/`api-route` phase that queries the new shape.
- An `auth`/ownership-check phase precedes the route logic it protects, not the reverse — the
  `engineering-standards` gate treats auth as always the first line of logic, never bolted on.
- A `security-audit` phase follows implementation, not precedes it — it audits what was built.

---

## Risk & Open Questions
- Flag risk **honestly and specifically** — "this touches the payments webhook, which has a
  documented double-billing trap" is useful; "this could be risky" is not.
- An open question is anything the plan needs answered to be correct, but that neither the
  codebase nor a research pass could settle (a product decision, a tradeoff only the user can
  make, an external constraint like a deadline). List it — don't silently resolve it in the
  plan's favor.
- Out of Scope carries the same weight it does in `github-issues` — write it, don't imply it.
  A plan without an explicit Out of Scope section is an invitation for the next phase to quietly
  grow.

---

## Agent Routing Table
The canonical mapping — kept in sync with the `planning` agent's own copy:

| Phase touches | Route to |
|---|---|
| React components, pages, forms | `ui-component` |
| Next.js API routes (session-gated CRUD) | `api-route` |
| FastAPI routes (parsing, ML, long-running work) | `fastapi-route` |
| Login/session/ownership checks | `auth` |
| Schema/model/query design | `database` |
| A schema *change* specifically (migration sequencing, backfills) | `migration` |
| Stripe/billing | `payments` |
| LLM calls, prompts, structured output | `ai-feature` |
| Dockerfile/compose changes | `docker` |
| New/changed tests | `testing` |
| Anything touching auth/payments/uploads/user data/CI before merge | `security-audit` |
| Final correctness/quality pass on a diff | `code-review` |
| A closing unknown discovered mid-plan | `research` |
| Filing the plan's goal as a tracked issue | `github-issue` |

A single phase can route to more than one agent, in sequence — write out the sequence rather
than collapsing it into one cell.

---

## Output Format

```
## Goal
<one line>

## Assumptions / Research Used
<what's taken as given, with citation if it came from a research pass>

## Phases
1. <name> — touches: <files/areas> — owner: <agent> — depends on: <phase N or none>
   <2-4 sentences: what changes and why this order>
2. ...

## Out of Scope
- ...

## Open Questions
- <anything blocking that needs a human answer>

## Suggested Next Step
<which agent to invoke first, with a one-line self-contained brief for it>
```

### Worked example (abridged)

```
## Goal
Let a user export their verified income connections as a CSV from the dashboard.

## Assumptions / Research Used
- getUserConnections() already returns everything needed (slug, verifiedAmount, connectedAt) —
  verified: lib/dashboard-data.ts:15-30. No new query required.

## Phases
1. CSV generation endpoint — touches: app/api/report/ (or a new route) — owner: `api-route` —
   depends on: none
   A session-gated GET route that calls getUserConnections() and streams a CSV response. No new
   external dependency needed — Node's csv formatting is simple enough to hand-roll.
2. Download button — touches: components/dashboard/ — owner: `ui-component` — depends on: phase 1
   A button in the dashboard that hits the new route and triggers a browser download.
3. Route + auth test coverage — owner: `testing` — depends on: phase 1
   Happy path, unauthenticated 401, and empty-connections case.

## Out of Scope
- Scheduled/emailed exports — this is an on-demand download only.
- Any format other than CSV.

## Open Questions
- None — goal is fully derivable from existing data.

## Suggested Next Step
Invoke `api-route` with: "Add a session-gated GET route that streams the signed-in user's
getUserConnections() data as CSV — see lib/dashboard-data.ts for the existing query and shape."
```

---

## Don'ts
- Don't write the plan to a file unless the user explicitly asks — it lives in the response.
- Don't implement anything. Edit/Write are not part of this workflow; a plan that starts writing
  code mid-explanation has stopped being a plan.
- Don't collapse "the plan" and "the issue" — a plan can exist without a filed issue, and an
  issue doesn't need a full phase breakdown if the work is small enough for one agent.
- Don't pick an answer on the user's behalf for a genuinely open question just to make the plan
  look more finished — an honest Open Questions section is more useful than a confident guess.
