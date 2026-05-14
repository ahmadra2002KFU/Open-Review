# opencode agent roles

opencode ships with two built-in agents and supports user-defined custom agents in `opencode.json`. Treat each as a distinct teammate role.

## `plan` — read-only analyst

- File edit / bash tools default to `ask`, so in headless `opencode run` they effectively cannot run.
- Safe to dispatch without supervision.
- Use for: code review, architecture audit, bug hunt, design proposal, repo exploration, summary, "what does this do?".

Prompt template:
```
You are reviewing <project / files / area>. Produce a markdown report with sections:
1. Summary (3-5 bullets)
2. Findings (severity, file:line, description, suggested fix)
3. Open questions
Do not edit any files.
```

## `build` — write-capable builder

- All tools enabled. Will edit files.
- Use for: implementing a fix, mechanical refactor, codemod, adding a test, applying a clearly-specified change.
- Always specify scope: which files may be touched, which must not.

Prompt template:
```
Task: <single concrete change>
Allowed to modify: <file list or glob>
Do not modify: <out-of-scope paths>
When done, print a summary of the diff.
```

## Custom agents

Run `agents` subcommand to list. If the user has custom agents (e.g. `reviewer`, `tester`), pick the one that matches the role. Custom agents define their own tool permissions in `opencode.json`.

## Picking by request shape

| User says | Agent |
|---|---|
| "review", "audit", "look at", "explain", "summarize", "find bugs in" | `plan` |
| "fix", "implement", "refactor", "rename", "add tests for" | `build` |
| Names a specific agent ("ask the reviewer agent") | that name |

When in doubt: `plan`. It cannot make destructive changes.
