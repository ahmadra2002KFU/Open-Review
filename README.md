# Open-Review

A [Claude Code](https://docs.claude.com/en/docs/claude-code) skill that turns the locally-installed [opencode](https://opencode.ai) CLI into a dispatchable teammate. Claude Code stays the orchestrator; opencode handles the heavy work — repo-wide reviews, audits, mechanical refactors, long planning passes — using *your* opencode providers and *your* tokens, not Claude's.

> *Claude Code orchestrates. opencode does the work. Your tokens, your models, your terms.*

## What it does

- Exposes `opencode run` as a first-class teammate Claude can dispatch to via Bash.
- Tracks each opencode invocation as a **job** with JSON metadata + a captured log.
- Lets Claude pick the **agent** (`build`, `plan`, or any custom agent in your `opencode.json`), the **model** (anything `opencode models` lists), and the **reasoning level** (`--variant high|max|minimal`).
- Runs as an invisible background process on Windows (no popup `cmd` window).
- Survives long jobs (>10 min) without hitting Claude Code's per-Bash-call cap.

## Why

Claude Code is good at orchestration and judgment. opencode is good at chewing through a repo with whatever frontier model you've configured. Pairing them means:

- Claude doesn't burn its main context on tasks that just need broad reading.
- The user pays the marginal token cost on the provider of their choice (GitHub Copilot, Anthropic direct, OpenAI, Google, Z.AI, MiniMax, Groq, etc.) instead of inflating Claude usage.
- The two agents stay in their lane: Claude as conductor, opencode as a specialist.

## Requirements

- [Node.js](https://nodejs.org) 18+ (the helper is plain Node, no deps).
- [opencode](https://opencode.ai/docs/) installed and on `PATH`. Both the standalone `opencode.exe` and the npm shim (`npm i -g opencode-ai` -> `opencode.cmd`) are supported.
- At least one provider configured via `opencode auth login`.
- Claude Code (the skill loads from `~/.claude/skills/`).

## Install

```bash
git clone https://github.com/ahmadra2002KFU/Open-Review.git ~/.claude/skills/open-review
```

That's it — Claude Code auto-discovers skills under `~/.claude/skills/`. The skill's description has trigger phrases like *"use opencode"*, *"have opencode look at"*, *"delegate to opencode"*, *"open-review"*, etc.

Verify with:

```bash
node ~/.claude/skills/open-review/scripts/open-review.mjs setup
```

### Optional: register the dispatch subagent

The skill ships an `open-review-dispatch` subagent (a thin Haiku-model forwarder useful when you want a giant opencode result to stay isolated from your main Claude conversation). Skills can't auto-register subagents, so if you want it to appear in Claude Code's Agent picker, copy the file once:

```bash
mkdir -p ~/.claude/agents && cp ~/.claude/skills/open-review/agents/dispatch.md ~/.claude/agents/open-review-dispatch.md
```

After that you can launch it via the Agent tool with `subagent_type: open-review-dispatch`. Skip this step if you don't need context isolation — Claude calls the helper directly via Bash either way.

You should see `ok: true`, your opencode version, and your configured providers.

## Usage

The skill is invoked by Claude Code automatically when you ask things like:

- *"Use opencode to review the auth module"*
- *"Have opencode plan a migration from Express to Fastify"*
- *"Delegate this refactor to the build agent"*

### Slash commands

| Command | What it does |
|---|---|
| `/open-review:setup` | Verify opencode is installed and providers are configured. |
| `/open-review:dispatch <prompt>` | Spawn opencode in the background, return a job id. Flags: `--agent`, `--model`, `--variant`, `--thinking`, `--session`, `--continue`, `--dir`, `--attach`, `--wait`. |
| `/open-review:status [id]` | Show recent jobs in this workspace, or one specific job. |
| `/open-review:result [id]` | Print the final output of a job (defaults to most recent). |

### Subagent

The skill also ships an `open-review-dispatch` Haiku-model subagent that's a thin forwarder — call it via Claude's Agent tool when you want context isolation (e.g., a giant review whose raw output would otherwise pollute the main conversation).

### Direct CLI

The helper is a plain Node script you can invoke anytime:

```bash
node ~/.claude/skills/open-review/scripts/open-review.mjs <subcommand> [flags]

# Examples
node .../open-review.mjs setup
node .../open-review.mjs models openai --refresh
node .../open-review.mjs agents
node .../open-review.mjs dispatch --agent plan --model zai/glm-4.7 "Audit /src for security issues"
node .../open-review.mjs status
node .../open-review.mjs result or-mopq2srj-78881c
node .../open-review.mjs cancel or-mopq2srj-78881c
```

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

Jobs live under `~/.claude/open-review/jobs/<workspace-hash>/`. The bucket is hashed from the working directory + Claude session id so multiple Claude sessions don't trample each other.

## Choosing an agent

| Agent | Use for | Edits files? |
|---|---|---|
| `plan` | Reviews, audits, summaries, design proposals, exploration | No (read-only) |
| `build` | Implementations, refactors, codemods, fixes | Yes |
| Custom | Whatever you defined in `opencode.json` (run `agents` to list) | Per-config |

Claude defaults to `plan` for any "review / analyze / summarize" request. `build` is reserved for explicit "fix / implement / refactor" asks.

## Choosing a model

Whatever `opencode models` lists. The skill never invents a model name. Common picks (from a fully-configured opencode):

- **Strong reviewers**: `github-copilot/claude-opus-4.7`, `github-copilot/claude-sonnet-4.6`, `google/gemini-3.1-pro-preview`, `zai/glm-4.7`, `minimax/MiniMax-M2.7`, `openai/gpt-5.5-pro`
- **Cheap defaults**: `opencode/minimax-m2.5-free`, `zai/glm-4.5-flash`, `google/gemini-2.5-flash-lite`
- **Code-focused**: `github-copilot/grok-code-fast-1`, `openai/gpt-5.5`, `github-copilot/gpt-5.4`

## Configuration philosophy

- **No skill-level config file.** Defer entirely to opencode's own config (`~/.config/opencode/opencode.json` + project `opencode.json`).
- **Per-call overrides only.** Claude passes `--model`, `--agent`, optional `--session` per dispatch. Defaults come from opencode's config.
- **Setup check, not setup writer.** `/open-review:setup` verifies; it does not edit your config or auth files.
- **Reasoning level**: surfaced via `--variant <keyword>` only when the user asked for it or the task is genuinely hard. Never invent a value.

## Long jobs (>10 min)

The opencode child runs unbounded. The Bash tool (in Claude Code) caps each call at ~10 min, so long jobs are polled across multiple turns:

1. Dispatch in background — returns a job id immediately.
2. Poll `status <id>` from short Bash calls (each can wait up to ~10 min via an `until` loop).
3. Hand control back to Claude / the user between polls if needed.

## Notable hard-won fixes (Windows)

- Drop `detached: true` from `spawn`. On Windows it forces a console window even with `windowsHide: true`. Use `windowsHide: true` alone.
- npm-installed opencode is `opencode.cmd` (a shim). Node's `spawn` can't execute `.cmd` files reliably. The helper resolves the underlying JS at `<npm-prefix>/node_modules/opencode-ai/bin/opencode` and invokes it via `node` directly.
- File-fd inheritance through detached children silently dropped opencode stdout in our setup. The helper now pipes stdio and streams to the log file from inside the helper itself.

## File layout

```
open-review/
|-- SKILL.md                        # frontmatter + orchestration playbook
|-- scripts/
|   `-- open-review.mjs             # the dispatch / status / result helper
|-- references/
|   |-- opencode-cli.md             # verified opencode CLI flag reference
|   |-- agent-roles.md              # plan vs build vs custom
|   `-- orchestration.md            # team-of-agents decision tree
|-- commands/
|   |-- dispatch.md
|   |-- status.md
|   |-- result.md
|   `-- setup.md
|-- agents/
|   `-- dispatch.md                 # haiku thin-forwarder subagent
`-- README.md
```

## License

MIT — see [LICENSE](./LICENSE).

## Related

- [opencode](https://opencode.ai) — the CLI this skill wraps.
- [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc) — sibling pattern for Codex CLI; this skill's architecture is inspired by it.
- [anthropics/skills](https://github.com/anthropics/skills) — official Anthropic skill examples and the `skill-creator` scaffolder.
