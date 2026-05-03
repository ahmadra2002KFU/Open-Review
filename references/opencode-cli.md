# opencode CLI reference (verified against opencode 1.2.15)

Only flags listed here are confirmed to exist. Do not invent flags.

## `opencode run [message..]`

Headless single-shot run. Exits when the model completes.

| Flag | Purpose |
|---|---|
| `-m, --model <provider/model>` | Model id, e.g. `anthropic/claude-sonnet-4-5` |
| `--agent <name>` | Agent to use (e.g. `build`, `plan`, custom name from `opencode.json`) |
| `--variant <keyword>` | Provider-specific reasoning effort (e.g. `high`, `max`, `minimal`). Provider must support it. |
| `--thinking` | Surface thinking blocks in output (boolean) |
| `--format <default\|json>` | Output format. `json` = raw JSON event stream |
| `-s, --session <id>` | Continue specific session id |
| `-c, --continue` | Continue last session |
| `--fork` | Fork session when continuing (use with `--session` or `--continue`) |
| `--share` | Share the session |
| `-f, --file <path>` | Attach file(s) to message (repeatable) |
| `--title <text>` | Title for the session |
| `--attach <url>` | Attach to a running `opencode serve` (e.g. `http://localhost:4096`) |
| `--dir <path>` | Working directory (or remote path when attaching) |
| `--port <n>` | Local server port (random if omitted) |
| `--print-logs` | Print logs to stderr |
| `--log-level <DEBUG\|INFO\|WARN\|ERROR>` | Log level |
| `--command <name>` | Use a configured command, message becomes args |

### What does NOT exist on `opencode run`

- No `--dangerously-skip-permissions` flag (headless mode does not gate the same way)
- No `--cwd` (use `--dir`)
- No `--reasoning` or `--reasoning-effort` (use `--variant`)
- No `--thinking-level` (only the boolean `--thinking`)

## Other relevant subcommands

- `opencode --version` — version
- `opencode auth list` — list configured providers
- `opencode auth login [url]` — interactive provider login (do not call from skill)
- `opencode agent list` — list available agents (built-in + custom)
- `opencode models [provider] [--refresh] [--verbose]` — list models
- `opencode session list` — list sessions
- `opencode session delete <id>` — delete session
- `opencode export [sessionID]` — export session as JSON
- `opencode serve [--port N] [--hostname H] [--mdns]` — start headless server
- `opencode attach <url>` — attach to a running server (TUI)

## JSON event format (`--format json`)

`opencode run --format json` emits newline-delimited JSON events on stdout. Schema is opencode-internal and not formally documented in v1.2.15. The helper does not parse events; it captures the raw stream into the job log. To consume events, treat the log as JSONL and parse line by line. If a stable schema becomes important, run `opencode run --format json "hi" 2>/dev/null | head` against a real provider and inspect.

## Environment

- `OPENCODE_CONFIG` — override config file path
- `OPENCODE_SERVER_PASSWORD` — auth header for `opencode serve`
- Provider-specific keys (e.g. `ANTHROPIC_API_KEY`) per provider docs

Config file locations (merged in order): `~/.config/opencode/opencode.json`, project `opencode.json`, `OPENCODE_CONFIG`, `.opencode/`, remote `.well-known/opencode`.
