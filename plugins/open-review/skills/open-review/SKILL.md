---
name: open-review
description: Dispatch general-purpose work to a locally installed opencode CLI as a teammate agent. Use when offloading code review, repo-wide analysis, planning passes, refactors, broad exploration, or any long-context task to save Claude tokens. Triggers when the user says "use opencode", "have opencode look at", "ask opencode", "delegate to opencode", "open-review", "dispatch to the build agent", "dispatch to the plan agent", or names the opencode CLI explicitly.
license: MIT
---

# Open-Review

Open-Review treats the locally installed `opencode` CLI as a teammate on a multi-agent team. Claude Code is the orchestrator. opencode is dispatched as a **background process** to handle work that would otherwise burn the main Claude context: deep reads, repo-wide reviews, long planning passes, mechanical refactors. Only the final result returns to the main conversation.

The user owns opencode setup (install, providers, API keys). This skill never writes credentials and never auto-installs anything.

## First-run: provider preferences

Before the **first dispatch in any session**, run:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/open-review.mjs" prefs get
```

If it returns `allowed_providers: null`, the user has not configured Open-Review yet. **Stop and run the `/open-review:configure` flow** before dispatching: fetch the live providers list (the helper refreshes opencode's model cache automatically), present them to the user via `AskUserQuestion`, write the resulting allow-list. Never dispatch with prefs unset on a fresh install — the user almost certainly has a billing reason for excluding at least one configured route (token-billed vs coding plan).

When prefs ARE set, `dispatch` enforces them: any model whose provider is not in `allowed_providers` is rejected before opencode is spawned, with a clear error pointing back to `/open-review:configure`.

When picking a model, always start from `node ... models` (which filters to allowed providers by default). **Never name a model that wasn't in that output.** Pass `--all` only if you have a specific reason to bypass the filter and you've explained it to the user.

## Mandatory three-question flow before every dispatch

> **Bypass note** — When the work is dispatched via the Task tool with `subagent_type: "open-review:plan"` or `"open-review:build"`, those subagents handle dispatch directly and **skip this question flow** (they run synchronously with `--wait`, infer model from the user's prompt or fall back to opencode's default, and refuse jobs that look likely to exceed the 9-minute Bash cap). The flow below remains mandatory for the `/open-review:dispatch` slash command and for any direct background dispatch Claude Code initiates from this skill.

Whenever Open-Review is triggered (skill loaded, slash command invoked, user says "use opencode" / "delegate to opencode" / etc.), **always** present three structured questions using `AskUserQuestion` before calling `dispatch`. Never skip these. Never accept free-form text as a substitute. The user clicks options — no typing required (they can still pick "Other" to type when they want).

Build the questions dynamically from live data each time. Do not hardcode model names — pull them from `node ... models` (which is already filtered by prefs).

**Question 1 — Goal** (single-select, label `Goal`):
- "Review / analyze (read-only)" → maps to `--agent plan`
- "Build / refactor / fix (writes files)" → maps to `--agent build`
- "Quick test (one-line probe)" → `--agent plan` with a tiny prompt

**Question 2 — Target directory** (single-select, label `Target`):
- "Current working dir" — uses `process.cwd()` of the call
- "A project under ~/projects/" — list the 3 most recently modified subdirs
- "Other path" — let the user type an absolute path via the "Other" option

**Question 3 — Model** (single-select, label `Model`):
- Top 3 most relevant models from `models` output, filtered by task type. Preferred order:
  - For **plan/review** tasks: a strong reviewer (e.g. `kimi-for-coding/k2p6`, `github-copilot/claude-opus-4.7`, `openai/gpt-5.5-pro`)
  - For **build** tasks: a strong builder (e.g. `minimax/MiniMax-M2.7`, `openai/gpt-5.5`, `kimi-for-coding/k2p6`)
  - Always include at least one **coding-plan / subscription** option to keep cost off the per-token meters
- Each option's description must show provider + billing hint + 1-line "good for" note. Pull billing hint from `providers` output.

Then:
1. Combine the three answers into a `dispatch` invocation.
2. After the helper returns the job id, tell the user it's running and you'll poll for completion.

If the user explicitly asks Claude to "skip the questions" or "just go", honor that — but **only after** they say so.

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

The helper script ships inside this plugin. Always invoke it via Node, using the `${CLAUDE_PLUGIN_ROOT}` token so the path resolves wherever the plugin is installed:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/open-review.mjs" <subcommand> [flags] [prompt]
```

Claude Code substitutes `${CLAUDE_PLUGIN_ROOT}` before the shell runs, so the same form works from both the Bash tool and the PowerShell tool — do not rewrite it to `$env:CLAUDE_PLUGIN_ROOT`. Keep the path double-quoted.

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
