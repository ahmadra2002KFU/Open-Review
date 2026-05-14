# Team-of-agents orchestration playbook

Open-Review's mental model: Claude Code conducts. opencode is one of several teammates Claude can dispatch to. Use this playbook to decide who handles what.

## Roster

| Teammate | Cost profile | Best at |
|---|---|---|
| Claude (you) | Main context tokens | orchestration, judgment, user-facing replies, small targeted edits |
| Claude `Explore` subagent | Modest Claude tokens, isolated context | targeted code search, "where is X defined" |
| Claude `Plan`/general subagent | Modest Claude tokens, isolated context | scoped multi-step research |
| **opencode `plan`** | User's opencode provider tokens — does NOT consume Claude tokens | broad reviews, audits, multi-file analysis, deep summaries |
| **opencode `build`** | User's opencode provider tokens | mechanical implementations, codemods, scoped fixes |
| **opencode custom** | Per user's `opencode.json` | whatever the user defined |

## Routing rules

- **Trivial / single-file / conversational** → Claude does it directly.
- **Targeted lookup, ≤3 queries** → Claude uses Grep/Glob.
- **Open-ended search, ≥4 queries, isolated** → Explore subagent.
- **Repo-wide review or audit** → opencode `plan`.
- **Long mechanical edit (rename, codemod, format-pass) with clear spec** → opencode `build`.
- **Anything the user explicitly delegated** → opencode, with the agent the user named (or `plan` if unspecified).

## Worked examples

### Example 1 — "Review my repo for security issues"
```
Dispatch: opencode plan
Prompt: "Audit this repository for security issues. Cover input validation, authn/z, secret handling, dependency risks. For each finding give file:line, severity (low/med/high/critical), description, and a suggested fix. Format as markdown."
Wait? No — background, then poll status.
```

### Example 2 — "Rename `getUser` to `fetchUser` everywhere"
```
Dispatch: opencode build
Prompt: "Rename the function `getUser` to `fetchUser` across the entire repo, including all call sites, tests, and JSDoc references. Do not change behavior. Print a summary of files touched when done."
Wait? Optional — short-ish jobs can be foreground.
```

### Example 3 — "What does this 200-line file do?"
```
Don't dispatch. Just read it yourself. Dispatch overhead exceeds the savings.
```

### Example 4 — "Find every place we hit /api/v1 and migrate to /api/v2"
```
Dispatch: opencode plan first
Prompt: "List every code location that references the path /api/v1 ... return file:line and surrounding context."
Then user reviews, then a follow-up build dispatch with --session <id> to apply.
```

## Output discipline

- Don't paste opencode's full output into the conversation if it's >100 lines. Summarize, link to the log path, offer to expand.
- Always cite: "(opencode plan, job <id>, model <model>)" so the user knows what produced the result.
- If opencode's findings disagree with your prior view, say so and explain what changed your mind.

## Failure handling

- If a job ends `failed`: read tail of log, surface the actual error to the user, do not silently retry.
- If a job is `running` longer than expected: tell the user it's still going, offer to cancel.
- If `setup` reports `ok: false`: stop, tell the user what's missing. Do not attempt to install opencode.
