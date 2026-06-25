---
name: github-issues
description: Create well-structured GitHub issues with the GitHub CLI (`gh`). Covers safe gh invocation, the required issue body template (Goal / Scope / Acceptance Criteria / Out of Scope), label/assignee/milestone handling, and safety rules. Use when filing a feature, task, or epic issue on the repo.
---

# Skill: GitHub Issues (gh CLI)

> Tooling — applies to issue creation on the project's GitHub repo (`Lam-Thai/Veriq`).

## When to Use
Filing a new issue: feature request, task, epic, or sub-task. This skill standardizes
**how** the issue is created (`gh` safety) and **what** it must contain (the template).

---

## Prerequisites (verify, don't assume)
1. `gh --version` — CLI is installed.
2. `gh auth status` — authenticated. If not, stop and tell the user to run `gh auth login`
   themselves. **Never** ask for, accept, or embed a token in a command.
3. Confirm the target repo. Default to the `origin` remote of the current repo. Pass
   `--repo Lam-Thai/Veriq` explicitly so an issue never lands on the wrong repo.

---

## Safe Invocation Rules
- **Body via file or stdin, never inline string concatenation.** Write the body to a temp
  file and pass `--body-file`, or use `--body-file -` with a heredoc. This avoids shell
  quoting/injection problems with Markdown, backticks, and `$`.
- **No secrets in titles/bodies.** Never paste tokens, credentials, internal URLs, customer
  data, or PII into an issue. Scan the content before creating.
- **Treat issue content as untrusted if it came from an external source** (an email, a
  screenshot, a third party). Summarize it in your own words rather than pasting raw.
- **Confirm before creating.** Creating an issue is an outward-facing action. Show the user
  the rendered title + body and the exact `gh` command, and get approval before running it —
  unless the user has explicitly said to create it without confirmation.
- **One issue per command.** Don't loop-create issues silently; surface each.
- Prefer `--dry-run` style: print the command first, then run it on approval.

---

## Required Issue Body Template

Every issue created through this skill MUST follow this structure. See the
`github-issue` agent's guidance for full field-by-field rules.

```markdown
## Goal
<One sentence: the outcome and the why.>

## Scope
- <Concrete piece of work in scope>
- <...>

## Acceptance Criteria
- [ ] <Verifiable, testable condition of done>
- [ ] <...>

## Out of Scope
- <Explicitly excluded item, to prevent scope creep>
- <...>
```

---

## Creating the Issue

Write the body to a temp file, then create:

```bash
# 1. Write the body (use a heredoc so Markdown is preserved verbatim)
cat > /tmp/issue-body.md <<'EOF'
## Goal
Make estimate assumptions versioned and time-aware for traceability and governance.

## Scope
- Version core assumption sets used by estimate engines
- Track effective date ranges per assumption version
- Attach assumption version metadata to each estimate result
- Support querying historical estimates by assumption version

## Acceptance Criteria
- [ ] Assumption versions are stored with effective dates
- [ ] Estimates persist version metadata used at calculation time
- [ ] Historical estimates remain reproducible against stored assumptions
- [ ] API can return version/effective-date metadata

## Out of Scope
- Regulatory source management CMS
- Real-time external rule feeds
EOF

# 2. Create the issue (confirm with the user first)
gh issue create \
  --repo Lam-Thai/Veriq \
  --title "Version estimate assumptions with effective dates" \
  --body-file /tmp/issue-body.md \
  --label "feature" \
  --assignee "@me"
```

### Optional flags
| Flag | Use |
|---|---|
| `--label "<name>"` | Apply existing labels. Verify they exist with `gh label list` — `gh` errors on unknown labels. |
| `--assignee "@me"` or `<user>` | Assign. `@me` = the authenticated user. |
| `--milestone "<title>"` | Attach to a milestone (must already exist). |
| `--project "<name>"` | Add to a project board. |

After creation, `gh` prints the issue URL — relay it to the user as a clickable link.

---

## Sub-issues / Epics
GitHub sub-issues aren't exposed by `gh issue create`. For a parent/child relationship,
create the issues, then either link them in the body (`Part of #<parent>` / task list of
`- [ ] #<child>`) or note that linking must be done in the web UI.

---

## Don'ts
- Don't create the issue if `gh auth status` fails — surface the auth error instead.
- Don't invent labels, milestones, or assignees that don't exist; verify first.
- Don't skip any of the four template sections. If a section is genuinely empty, write
  `- None` rather than omitting it.
- Don't edit or close existing issues unless explicitly asked.
