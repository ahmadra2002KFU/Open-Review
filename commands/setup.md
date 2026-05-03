---
description: Verify opencode is installed and ready for Open-Review dispatch
allowed-tools: Bash
argument-hint:
---

Run the Open-Review setup check.

```bash
node "$HOME/.claude/skills/open-review/scripts/open-review.mjs" setup
```

If `ok: false`, tell the user what's missing (opencode binary, providers) and link them to https://opencode.ai/docs/. Do not attempt to install anything.

If `ok: true`, summarize: opencode version, configured providers, jobs root.
