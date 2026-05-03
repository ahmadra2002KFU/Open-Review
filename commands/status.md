---
description: Show running and recent Open-Review jobs in this workspace
allowed-tools: Bash
argument-hint: [job-id]
---

```bash
node "$HOME/.claude/skills/open-review/scripts/open-review.mjs" status $ARGUMENTS
```

Summarize the JSON output for the user. If a specific job id was given, show its full record. Otherwise show a short table: id, status, agent, started_at, prompt-prefix.
