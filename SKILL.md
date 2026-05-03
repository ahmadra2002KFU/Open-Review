---
name: open-review
description: Dispatch general-purpose work to a locally installed opencode CLI as a teammate agent. Use when offloading code review, repo-wide analysis, planning passes, refactors, broad exploration, or any long-context task to save Claude tokens. Triggers when the user says "use opencode", "have opencode look at", "ask opencode", "delegate to opencode", "open-review", "dispatch to the build agent", "dispatch to the plan agent", or names the opencode CLI explicitly.
license: MIT
---

# Open-Review

Open-Review treats the locally installed `opencode` CLI as a teammate on a multi-agent team. Claude Code is the orchestrator. opencode is dispatched as a **background process** to handle work that would otherwise burn the main Claude context: deep reads, repo-wide reviews, long planning passes, mechanical refactors. Only the final result returns to the main conversation.

The user owns opencode setup (install, providers, API keys). This skill never writes credentials and never auto-installs anything.

## Decision tree — when to dispatch

Dispatch to opencode when **any** of these hold:
- The task requires reading many files (>10) before producing output.
- The task is well-scoped and can be specified in a single self-contained prompt.
- The user explicitly asked to "use opencode" / "delegate this".
- A long mechanical edit (rename, codemod, format-pass) is needed.

Do **not** dispatch when:
- The task is short and would cost more in dispatch overhead than it saves.
- The task requires tight back-and-forth with the user.
- opencode setup hasn't been verified yet — run `setup` first.

## Picking an agent (the role on the team)

| Agent | Use for | Edits files? |
|---|---|---|
| `plan` | Reviews, audits, summaries, design proposals, exploration | No (read-only) |
| `build` | Implementations, refactors, codemods, fixes | Yes |
| Custom | Whatever the user has defined in `opencode.json` (run `agents` to list) | Per-config |

Default to `plan` for any "look at / review / analyze" request. Use `build` only when the user wants files changed.

## Picking a model and reasoning level

- **Model**: Pass `--model provider/model` only when the user specified one or you have a clear reason. Otherwise omit and let opencode use its configured default. Run the helper's `models` subcommand to enumerate.
- **Reasoning level (`--variant`)**: Provider-specific keyword (e.g. `high`, `max`, `minimal`). Pass it only when the user asked for it or the task is genuinely hard. Never invent a value — if unsure, omit.
- **`--thinking`**: Surfaces thinking blocks in the output. Useful for plan/review tasks where you want to see reasoning, costly otherwise.

## Invoking the helper

The helper script lives at `<skill-root>/scripts/open-review.mjs`. Always invoke via Node and the absolute path:

```bash
node "$HOME/.claude/skills/open-review/scripts/open-review.mjs" <subcommand> [flags] [prompt]
```

On Windows in PowerShell:
```powershell
node "$env:USERPROFILE\.claude\skills\open-review\scripts\open-review.mjs" <subcommand> ...
```

### Subcommands

- `setup` — verify opencode on PATH, list configured providers
- `dispatch <prompt> [--agent X] [--model X] [--variant X] [--thinking] [--session ID] [--continue] [--dir PATH] [--attach URL] [--wait] [--format json|default]` — start a job (background unless `--wait`)
- `status [id]` — show one or all recent jobs for this workspace
- `result [id] [--json]` — print final output (defaults to most recent)
- `cancel <id>` — terminate a running job
- `tail <id>` — print log so far
- `models [provider] [--refresh]` — passthrough to `opencode models`
- `agents` — passthrough to `opencode agent list`

### Standard dispatch flow

1. **Check setup** (once per session): run `setup`. If `ok: false`, tell the user to install/configure opencode and stop.
2. **Dispatch**: call `dispatch` with the chosen agent and a single self-contained prompt that includes everything opencode needs (it does not see the Claude conversation).
3. **Monitor**: use Bash with `run_in_background: true` for the dispatch call so the spawn returns instantly. Then `status <id>` periodically (or wait briefly for short jobs).
4. **Collect**: `result <id>` once status is `completed`. Surface the relevant findings to the user — do not paste raw multi-thousand-line output if a summary suffices.

### Foreground vs background

- **Background (default)**: `dispatch` without `--wait` runs the helper in the background. The helper itself stays alive — it pipes opencode's stdout/stderr to the job log file — but because you invoke the dispatch via Bash with `run_in_background: true`, this is invisible to the conversation. The opencode child runs without a console window and is unbounded (30+ min OK).
- **Foreground (`--wait`)**: Streams to your Bash stdout and blocks until completion. Bounded by the Bash tool's ~10-min cap. Only use for short tasks where the user wants live output.

### How to invoke the helper

Always call the helper via Bash with `run_in_background: true` for `dispatch`:
```
Bash({ command: "node ... dispatch ...", run_in_background: true })
```
Then read the task's output (which is the job manifest JSON on its first line) to get the job id, and call `status <id>` / `result <id>` in subsequent (foreground) Bash calls.

### Long jobs (>10 min)

The opencode process is independent of any single Bash call. For long jobs:
1. Dispatch in background (helper stays alive, piping to log).
2. Poll with `status <id>` from short foreground Bash calls. A polling loop using `until <condition>; do sleep N; done` can wait up to ~10 minutes inside one Bash call.
3. If still running, return control to the conversation, poll again next turn. Repeat until complete.

## Subagent path (context isolation)

When the dispatch's raw output is likely to be huge and you want it kept out of the main context, invoke the `open-review:dispatch` subagent via the Agent tool. It is a thin forwarder: makes one Bash call, returns the job id (or final result if `--wait`), no extra commentary. Only use this when context isolation matters — the direct Bash path is cheaper otherwise.

## Prompt contract for opencode

opencode receives a single string. It does **not** see anything else from this conversation. Therefore:

- Include the project path / files of interest explicitly.
- State the desired output shape (markdown report, diff, list of findings, etc.).
- For `plan` agent: ask for a structured report with explicit sections.
- For `build` agent: be specific about what to change and what not to touch.
- Avoid asking opencode to "ask you questions" — it cannot.

## Reference material (load only when needed)

- `references/opencode-cli.md` — exact opencode CLI flags and JSON event schema
- `references/agent-roles.md` — when to pick build vs plan vs custom
- `references/orchestration.md` — full team-of-agents playbook with examples

## Hard rules

- Never write to the user's `opencode.json` or auth files.
- Never invent flags. If unsure whether opencode supports something, don't pass it.
- Never claim a job succeeded without checking `status` / `result`.
- If opencode is not installed, do not silently skip — tell the user.
