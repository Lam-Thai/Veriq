# `.claude/` — Agents & Skills

Claude Code equivalent of the `.github/` agents and skills used by GitHub Copilot.
Same domain knowledge, restructured to Claude Code's native conventions so subagents
and skills are auto-discovered.

## Layout

```
.claude/
  agents/            ← one subagent per file, YAML frontmatter (name, description, model)
    ai-feature.md
    api-route.md
    auth.md
    code-review.md
    database.md
    fastapi-route.md
    github-issue.md
    migration.md
    security-audit.md
    testing.md
    ui-component.md
  skills/            ← one skill per folder, each a SKILL.md (name, description)
    ai-integration/SKILL.md
    api-contracts/SKILL.md
    design-system/SKILL.md
    engineering-standards/SKILL.md
    error-handling/SKILL.md
    github-issues/SKILL.md
    nextjs/SKILL.md
    postgresql/SKILL.md
    prisma/SKILL.md
    python/SKILL.md
    security/SKILL.md
    sqlalchemy/SKILL.md
    typescript/SKILL.md
```

## How it maps to `.github/`

| `.github/`                         | `.claude/`                              |
|------------------------------------|-----------------------------------------|
| `agents/*.agent.md`                | `agents/*.md` (YAML frontmatter)        |
| `skills/*.skill.md`                | `skills/*/SKILL.md`                      |
| `agents/engineering-standards.skill.md` | `skills/engineering-standards/SKILL.md` (it is a skill, filed correctly) |
| `#file:.github/skills/x.skill.md`  | references to the `x` skill by name     |

## Agent → skill mapping

| Agent | Skills it relies on |
|---|---|
| `ai-feature` | typescript, nextjs, ai-integration, python, sqlalchemy, api-contracts, security, error-handling, engineering-standards |
| `api-route` | typescript, nextjs, prisma, api-contracts, security, error-handling, engineering-standards |
| `auth` | typescript, nextjs, prisma, api-contracts, security, error-handling, engineering-standards |
| `code-review` | typescript, python, prisma, sqlalchemy, postgresql, security, api-contracts, error-handling, engineering-standards |
| `database` | postgresql, prisma, sqlalchemy, typescript, python, engineering-standards |
| `fastapi-route` | python, sqlalchemy, api-contracts, security, error-handling, postgresql, engineering-standards |
| `github-issue` | github-issues, engineering-standards |
| `migration` | postgresql, prisma, sqlalchemy, engineering-standards |
| `security-audit` | security, api-contracts, typescript, python, error-handling, engineering-standards |
| `testing` | typescript, python, api-contracts, error-handling, engineering-standards |
| `ui-component` | typescript, nextjs, design-system, engineering-standards |

## Usage

- **Subagents** are invoked via the Task tool or auto-selected by Claude Code based on
  each agent's `description`. e.g. "use the security-audit agent on this branch".
- **Skills** are auto-loaded when their `description` matches the task, or can be invoked
  explicitly. Every code-generating agent treats `engineering-standards` as its final gate.
