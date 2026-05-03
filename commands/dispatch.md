---
description: Dispatch a task to opencode (background by default). Args after command are the prompt.
allowed-tools: Bash
argument-hint: [--agent build|plan] [--model provider/model] [--variant level] [--thinking] [--wait] <prompt>
---

Dispatch a task to opencode as a background teammate.

Default agent: `plan` unless the user specifies otherwise or the request involves editing files (then `build`).

**Important:** call the helper via Bash with `run_in_background: true`. The helper process stays alive until the opencode child exits, piping output to the job log. The Bash tool's background mode prevents the 10-min cap from killing it.

```bash
node "$HOME/.claude/skills/open-review/scripts/open-review.mjs" dispatch $ARGUMENTS
```

Then:
1. The first stdout line of the helper is the job manifest JSON. Read it from the background task output to get the job id.
2. Periodically run `status <id>` (separate Bash calls, every ~5s for short jobs, longer for big ones).
3. Once `completed`, run `result <id>` and surface the relevant findings.
4. Cite "(opencode <agent>, job <id>)" so the user knows what produced the output.

If the user wants foreground / live output, add `--wait`. Foreground mode is bounded by the Bash 10-min cap.
