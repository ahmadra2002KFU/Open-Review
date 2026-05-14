---
description: Print the final output of an Open-Review job (defaults to most recent)
allowed-tools: Bash
argument-hint: [job-id]
---

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/open-review.mjs" result $ARGUMENTS
```

Surface the relevant findings to the user. If the output is large (>100 lines), summarize and offer to expand or open the log file. Always cite the job id, agent, and model.
