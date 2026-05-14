---
description: Set Open-Review provider preferences. Pick which configured opencode providers Open-Review is allowed to dispatch to.
allowed-tools: Bash, AskUserQuestion
argument-hint:
---

Walk the user through setting up Open-Review's provider preferences.

Step 1 — fetch the current providers (this **always refreshes** opencode's model cache so the model samples reflect what's actually available right now):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/open-review.mjs" providers
```

Output is JSON: `{ providers: [{ id, auth_type, billing, model_count, sample_models }, ...], current_prefs, ... }`. **Only providers the user has authed in opencode appear here — never invent or hardcode any.**

Step 2 — show the user the providers via `AskUserQuestion`. Build the multi-select question dynamically from the JSON:
- One option per provider entry.
- Label: the provider id.
- Description: combine `billing` + the `sample_models` list, e.g. *"Coding plan (subscription) — k2p5, k2p6, kimi-k2-thinking"*.
- Set `multiSelect: true`.
- Pre-tick anything in `current_prefs` if present.

Step 3 — collect the user's selection and write the preferences:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/open-review.mjs" prefs set --allowed "<comma-separated provider ids>"
```

Step 4 — confirm to the user which providers are now enabled and which are excluded. Mention that future dispatches with disallowed providers will fail loudly with a clear error pointing back to this command.

## Hard rules

- Never invent provider ids or model names. Always derive them from the live `providers` output.
- The model samples shown to the user must be the freshly-fetched ones from this run — do not paste from memory or older outputs.
- If `providers` returns an empty list, tell the user they need to `opencode auth login` for at least one provider first; do not write empty prefs.
