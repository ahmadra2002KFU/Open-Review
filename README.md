# Open-Review

A [Claude Code](https://docs.claude.com/en/docs/claude-code) **plugin** that turns the locally-installed [opencode](https://opencode.ai) CLI into a dispatchable teammate. Claude Code stays the orchestrator; opencode handles the heavy work — repo-wide reviews, audits, mechanical refactors, long planning passes — using *your* opencode providers and *your* tokens, not Claude's.

> *Claude Code orchestrates. opencode does the work. Your tokens, your models, your terms.*

## What it does

- Exposes `opencode run` as a first-class teammate Claude can dispatch to.
- Ships **three native subagents** Claude auto-routes to — `open-review:plan` (read-only review/audit), `open-review:build` (file-editing refactors/scaffolds), `open-review:dispatch` (thin forwarder for background/long jobs).
- Ships **slash commands** for the explicit, question-driven dispatch path.
- Tracks each opencode invocation as a **job** with JSON metadata + a captured log.
- Lets Claude pick the **agent** (`build`, `plan`, or any custom agent in your `opencode.json`), the **model** (anything `opencode models` lists), and the **reasoning level** (`--variant high|max|minimal`).
- Runs as an invisible background process on Windows (no popup `cmd` window).
- Survives long jobs (>10 min) without hitting Claude Code's per-Bash-call cap.
- Enforces a provider **allow-list** so dispatches never silently land on a billing route you didn't approve.

## Why

Claude Code is good at orchestration and judgment. opencode is good at chewing through a repo with whatever frontier model you've configured. Pairing them means:

- Claude doesn't burn its main context on tasks that just need broad reading.
- The user pays the marginal token cost on the provider of their choice (GitHub Copilot, Anthropic direct, OpenAI, Google, Z.AI, MiniMax, Groq, etc.) instead of inflating Claude usage.
- The two agents stay in their lane: Claude as conductor, opencode as a specialist.

## Requirements

- [Node.js](https://nodejs.org) 18+ (the helper is plain Node, no deps).
- [opencode](https://opencode.ai/docs/) installed and on `PATH`. Both the standalone `opencode.exe` and the npm shim (`npm i -g opencode-ai` -> `opencode.cmd`) are supported.
- At least one provider configured via `opencode auth login`.
- Claude Code with plugin support.

## Install

Add the marketplace, then install the plugin:

```
/plugin marketplace add ahmadra2002KFU/Open-Review
/plugin install open-review@open-review
```

Restart Claude Code so the commands and subagents register. That's it — no manual file copying, no `~/.claude/skills/` clone.

**Local development** — to test a working copy without publishing:

```bash
claude --plugin-dir /path/to/Open-Review/plugins/open-review
```

After install, verify with `/open-review:setup` — you should see `ok: true`, your opencode version, and your configured providers.

## First run: configure providers

Before the first dispatch, run `/open-review:configure`. It fetches the providers you've authed in opencode and lets you pick which ones Open-Review is allowed to dispatch to. Dispatches to a provider outside the allow-list fail loudly with a clear error — this is the guardrail that keeps work off billing routes you didn't approve.

## Usage

### Native subagents (auto-routed)

Claude routes to these automatically based on what you ask — no slash command needed:

| Subagent | Use for | Edits files? |
|---|---|---|
| `open-review:plan` | "Use opencode to review X", audits, repo-wide reads | No (read-only) |
| `open-review:build` | "Have opencode refactor X", codemods, scaffolds, fixes | Yes |
| `open-review:dispatch` | Thin forwarder — context isolation + background/long jobs | Depends on `--agent` |

`plan` and `build` run synchronously (`--wait`) and refuse jobs likely to exceed the ~9-minute Bash cap, pointing you at `/open-review:dispatch` instead. `dispatch` has no guard — it's the path for long background jobs.

Example triggers:
- *"Use opencode to review the auth module"* → `open-review:plan`
- *"Have opencode scaffold Jest tests for /utils"* → `open-review:build`

### Slash commands

| Command | What it does |
|---|---|
| `/open-review:setup` | Verify opencode is installed and providers are configured. |
| `/open-review:configure` | Pick which opencode providers Open-Review may dispatch to. |
| `/open-review:dispatch <prompt>` | Question-driven background dispatch, returns a job id. Flags: `--agent`, `--model`, `--variant`, `--thinking`, `--session`, `--continue`, `--dir`, `--attach`, `--wait`. |
| `/open-review:status [id]` | Show recent jobs in this workspace, or one specific job. |
| `/open-review:result [id]` | Print the final output of a job (defaults to most recent). |

The slash-command path always runs a three-question flow (Goal / Target / Model) before dispatching. The native subagents skip that flow — they infer the model from your prompt or fall back to opencode's default.

### Helper CLI

The dispatch logic lives in `scripts/open-review.mjs` inside the plugin. You don't normally call it directly — the commands and subagents do. If you need to, `/open-review:setup` prints the resolved paths. Subcommands: `setup`, `dispatch`, `status`, `result`, `cancel`, `tail`, `models`, `agents`, `providers`, `prefs get|set|reset`.

## How dispatch flows

```
Claude Code -- Bash (run_in_background) --> open-review.mjs (helper, stays alive)
                                                     |
                                                     |--> spawns: opencode run ...
                                                     |      (windowsHide:true, no detached, no popup)
                                                     |
                                                     |--> pipes opencode stdout/stderr --> jobs/<bucket>/<id>.log
                                                     |
                                                     `--> writes JSON manifest         --> jobs/<bucket>/<id>.json

Claude Code -- Bash (foreground) --> status/result/cancel --> reads JSON + log
```

Jobs and preferences live under `~/.claude/open-review/` — **outside** the plugin directory, so they survive plugin updates and reinstalls. Job buckets are hashed from the working directory + Claude session id so multiple Claude sessions don't trample each other.

## Choosing an agent

| Agent | Use for | Edits files? |
|---|---|---|
| `plan` | Reviews, audits, summaries, design proposals, exploration | No (read-only) |
| `build` | Implementations, refactors, codemods, fixes | Yes |
| Custom | Whatever you defined in `opencode.json` (run `agents` to list) | Per-config |

Claude defaults to `plan` for any "review / analyze / summarize" request. `build` is reserved for explicit "fix / implement / refactor" asks.

## Choosing a model

Whatever `opencode models` lists, filtered to your configured allow-list. The plugin never invents a model name. Common picks (from a fully-configured opencode):

- **Strong reviewers**: `github-copilot/claude-opus-4.7`, `github-copilot/claude-sonnet-4.6`, `google/gemini-3.1-pro-preview`, `zai/glm-4.7`, `minimax/MiniMax-M2.7`, `openai/gpt-5.5-pro`
- **Cheap defaults**: `opencode/minimax-m2.5-free`, `zai/glm-4.5-flash`, `google/gemini-2.5-flash-lite`
- **Code-focused**: `github-copilot/grok-code-fast-1`, `openai/gpt-5.5`, `github-copilot/gpt-5.4`

## Configuration philosophy

- **No plugin-level model config.** Defer entirely to opencode's own config (`~/.config/opencode/opencode.json` + project `opencode.json`).
- **Provider allow-list only.** `/open-review:configure` writes which providers are dispatchable; per-call `--model` / `--agent` overrides come from there.
- **Setup check, not setup writer.** `/open-review:setup` verifies; it never edits your opencode config or auth files.
- **Reasoning level**: surfaced via `--variant <keyword>` only when the user asked for it or the task is genuinely hard. Never invent a value.

## Long jobs (>10 min)

The opencode child runs unbounded. The Bash tool (in Claude Code) caps each call at ~10 min, so long jobs are polled across multiple turns:

1. Dispatch in background via `/open-review:dispatch` (or the `open-review:dispatch` subagent) — returns a job id immediately.
2. Poll `/open-review:status <id>` from short Bash calls (each can wait up to ~10 min via an `until` loop).
3. Hand control back to Claude / the user between polls if needed.

The synchronous `open-review:plan` / `open-review:build` subagents deliberately refuse jobs that smell long — use the background path for those.

## Notable hard-won fixes (Windows)

- Drop `detached: true` from `spawn`. On Windows it forces a console window even with `windowsHide: true`. Use `windowsHide: true` alone.
- npm-installed opencode is `opencode.cmd` (a shim). Node's `spawn` can't execute `.cmd` files reliably. The helper resolves the underlying JS at `<npm-prefix>/node_modules/opencode-ai/bin/opencode` and invokes it via `node` directly.
- File-fd inheritance through detached children silently dropped opencode stdout in our setup. The helper now pipes stdio and streams to the log file from inside the helper itself.

## File layout

```
Open-Review/                          repo root = marketplace
|-- .claude-plugin/
|   `-- marketplace.json              marketplace manifest
|-- LICENSE
|-- README.md
`-- plugins/
    `-- open-review/                  the plugin
        |-- .claude-plugin/
        |   `-- plugin.json           plugin manifest
        |-- agents/
        |   |-- plan.md               open-review:plan  (read-only forwarder)
        |   |-- build.md              open-review:build (file-editing forwarder)
        |   `-- dispatch.md           open-review:dispatch (thin forwarder)
        |-- commands/
        |   |-- configure.md  dispatch.md  result.md  setup.md  status.md
        |-- scripts/
        |   `-- open-review.mjs       the dispatch / status / result helper
        `-- skills/
            `-- open-review/
                |-- SKILL.md          orchestration playbook
                `-- references/
                    |-- opencode-cli.md   verified opencode CLI flag reference
                    |-- agent-roles.md    plan vs build vs custom
                    `-- orchestration.md  team-of-agents decision tree
```

## License

MIT — see [LICENSE](./LICENSE).

## Related

- [opencode](https://opencode.ai) — the CLI this plugin wraps.
- [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc) — sibling pattern for Codex CLI; this plugin's architecture is inspired by it.
- [anthropics/skills](https://github.com/anthropics/skills) — official Anthropic skill examples and the `skill-creator` scaffolder.
