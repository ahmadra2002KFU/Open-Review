# Open-Review — Skill → Plugin Migration

This folder holds project documentation per the working convention. This file records the
migration that converted Open-Review from a Claude Code **skill** into a Claude Code **plugin**.

## Why the migration happened

Open-Review wraps the `opencode` CLI as a delegated teammate. It originally shipped as a
**skill**, with the GitHub repo structured *as* the skill (SKILL.md at repo root).

Two subagent files were added inside the skill's `agents/` folder, expecting them to be
invokable via the Task tool with `subagent_type`. They were not — **Claude Code does not load
subagents from `skills/<name>/agents/`**. Agents load only from `~/.claude/agents/`, project
`.claude/agents/`, and **plugins**. So the whole project was repackaged as a plugin, because
plugins *can* bundle invokable agents.

## What changed

- Repo restructured to the marketplace + plugin layout (codex-plugin precedent):
  - `/.claude-plugin/marketplace.json` — marketplace manifest
  - `/plugins/open-review/.claude-plugin/plugin.json` — plugin manifest
  - all components (`agents/`, `commands/`, `scripts/`, `skills/open-review/`) moved under `plugins/open-review/`
- Agents renamed to short names — invokable as `open-review:plan`, `open-review:build`,
  `open-review:dispatch` (the plugin namespace already supplies "open-review").
- Every hardcoded `$HOME/.claude/skills/open-review/scripts/open-review.mjs` path replaced with
  `${CLAUDE_PLUGIN_ROOT}/scripts/open-review.mjs` so the plugin is install-location independent.
- `scripts/open-review.mjs` — **zero code changes**. It stores job state + prefs under
  `~/.claude/open-review/` (user data, persists across plugin updates) and never references its
  own install path.
- README rewritten for the `/plugin marketplace add` + `/plugin install` flow.

## Install (after migration)

```
/plugin marketplace add ahmadra2002KFU/Open-Review
/plugin install open-review@open-review
```

Then restart Claude Code. Run `/open-review:configure` before the first dispatch.

## What did NOT change

- The `opencode` integration, the provider allow-list / billing guard, the job-state layout.
- The helper script's behavior or subcommands.
- The `open-review` skill's trigger phrases and orchestration playbook (just relocated).

## Verification performed

- All 13 files moved as clean `git mv` renames (history preserved).
- Grep confirmed no remaining `$HOME/.claude/skills` paths or old `open-review-*` agent names
  in the plugin tree.
- Local dev-load with `claude --plugin-dir` before publishing.
- Post-install: commands + 3 agents register, skill auto-triggers, `${CLAUDE_PLUGIN_ROOT}`
  resolves, a dispatch round-trip works, and the 7 configured providers in
  `~/.claude/open-review/preferences.json` are preserved.
