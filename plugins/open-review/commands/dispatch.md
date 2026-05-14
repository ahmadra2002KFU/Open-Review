---
description: Dispatch a task to opencode as a background teammate. Always asks 3 structured questions first.
allowed-tools: Bash, AskUserQuestion
argument-hint: [optional free-text task description]
---

Dispatch a task to opencode. **Always run the mandatory three-question flow first** — even if the user provided a free-text task description as `$ARGUMENTS`, treat it as supporting context and still ask Goal / Target / Model via `AskUserQuestion`.

## Steps

1. **Check prefs** silently:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/open-review.mjs" prefs get
   ```
   If `allowed_providers` is `null`, stop and tell the user to run `/open-review:configure` first. Do not proceed.

2. **Fetch the live filtered model list** so Model question options are current:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/open-review.mjs" models
   ```

3. **Ask the user three questions via `AskUserQuestion`**:
   - **Goal** (single-select): Review / Build / Quick test
   - **Target** (single-select): Current dir / a recent subdir of `~/projects/` / Other path
   - **Model** (single-select): 3 picks from the filtered list, biased to the task type, always including at least one coding-plan / subscription model

4. **Dispatch with `run_in_background: true`**:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/open-review.mjs" dispatch \
     --agent <plan|build> \
     --model <selected> \
     --dir <selected> \
     "<combined prompt: $ARGUMENTS plus any inferred goal>"
   ```

5. **Poll**: read the manifest JSON from the background task output to get the job id, then `status <id>` periodically.
6. **Surface the result**: when `completed`, run `result <id>` and summarize. Cite "(opencode <agent>, job <id>, model <model>)".

## Hard rules

- Always 3 questions, always via `AskUserQuestion`, never free text fallback.
- Never name a model that wasn't in step 2's output.
- Never dispatch with prefs unset.
- If the user wrote a clear prompt in `$ARGUMENTS`, **use it as the dispatched prompt verbatim** — but the questions still happen first to confirm Goal / Target / Model.
