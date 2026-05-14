#!/usr/bin/env node
// Open-Review helper: orchestrates background opencode runs as a teammate agent.
// Subcommands: dispatch, status, result, cancel, tail, models, agents, setup,
//              providers, prefs
// No external deps. Node >= 18.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, openSync, closeSync, appendFileSync, createWriteStream, unlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash, randomBytes } from "node:crypto";

const ROOT = join(homedir(), ".claude", "open-review");
const JOBS_DIR = join(ROOT, "jobs");
const PREFS_FILE = join(ROOT, "preferences.json");
const AUTH_FILE = join(homedir(), ".local", "share", "opencode", "auth.json");
const IS_WIN = process.platform === "win32";

// On Windows, opencode may be installed as:
//   1. opencode.exe (winget/standalone) — Node can spawn directly.
//   2. opencode.cmd (npm shim) — Node CANNOT spawn .cmd directly without
//      shell:true, and shell:true loses stdio fd inheritance through the
//      cmd.exe wrapper. Workaround: invoke the underlying JS script via
//      `node` directly. The shim layout is:
//        %APPDATA%\npm\opencode.cmd
//        %APPDATA%\npm\node_modules\opencode-ai\bin\opencode  (Node script)
function resolveOpencode() {
  if (!IS_WIN) return { cmd: "opencode", argsPrefix: [], useShell: false };
  const r = spawnSync("where", ["opencode"], { encoding: "utf8" });
  if (r.status !== 0) return { cmd: "opencode", argsPrefix: [], useShell: true };
  const candidates = r.stdout.split(/\r?\n/).filter(Boolean);
  const exe = candidates.find(p => /\.exe$/i.test(p));
  if (exe) return { cmd: exe, argsPrefix: [], useShell: false };
  const cmdShim = candidates.find(p => /\.cmd$/i.test(p));
  if (cmdShim) {
    // The shim is in <prefix>\opencode.cmd; the JS lives at
    // <prefix>\node_modules\opencode-ai\bin\opencode
    const prefix = cmdShim.replace(/\\opencode\.cmd$/i, "");
    const jsScript = join(prefix, "node_modules", "opencode-ai", "bin", "opencode");
    if (existsSync(jsScript)) {
      return { cmd: process.execPath, argsPrefix: [jsScript], useShell: false };
    }
    return { cmd: cmdShim, argsPrefix: [], useShell: true };
  }
  return { cmd: candidates[0], argsPrefix: [], useShell: true };
}

// Quote a single arg for cmd.exe when shell:true is in use on Windows.
function winQuote(arg) {
  const s = String(arg);
  if (s === "") return '""';
  if (!/[\s"&|<>^()%!]/.test(s)) return s;
  return '"' + s.replace(/"/g, '""') + '"';
}

function buildSpawn(args) {
  const { cmd, argsPrefix, useShell } = resolveOpencode();
  const fullArgs = [...argsPrefix, ...args];
  if (!useShell) return { cmd, args: fullArgs, opts: { shell: false } };
  const cmdline = [winQuote(cmd), ...fullArgs.map(winQuote)].join(" ");
  return { cmd: cmdline, args: [], opts: { shell: true } };
}

function workspaceBucket() {
  const cwd = process.cwd();
  const sess = process.env.CLAUDE_SESSION_ID || process.env.CODEX_COMPANION_SESSION_ID || "default";
  return createHash("sha1").update(cwd + "|" + sess).digest("hex").slice(0, 12);
}
function bucketDir() {
  const d = join(JOBS_DIR, workspaceBucket());
  mkdirSync(d, { recursive: true });
  return d;
}
function newJobId() {
  const ts = Date.now().toString(36);
  const r = randomBytes(3).toString("hex");
  return `or-${ts}-${r}`;
}
function jobFile(id) { return join(bucketDir(), `${id}.json`); }
function logFile(id) { return join(bucketDir(), `${id}.log`); }
function readJob(id) {
  const p = jobFile(id);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}
function writeJob(job) {
  const p = jobFile(job.id);
  const tmp = p + ".tmp";
  writeFileSync(tmp, JSON.stringify(job, null, 2));
  try { spawnSync("cmd", ["/c", "move", "/Y", tmp, p], { stdio: "ignore" }); } catch {}
  if (existsSync(tmp)) writeFileSync(p, JSON.stringify(job, null, 2));
}
function listJobs() {
  const d = bucketDir();
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .filter(f => f.endsWith(".json"))
    .map(f => { try { return JSON.parse(readFileSync(join(d, f), "utf8")); } catch { return null; } })
    .filter(Boolean)
    .sort((a, b) => (b.started_at || "").localeCompare(a.started_at || ""));
}

function which(cmd) {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { encoding: "utf8" });
  if (r.status === 0) return r.stdout.split(/\r?\n/).filter(Boolean)[0];
  return null;
}

function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// ---------- preferences ----------

function readPrefs() {
  if (!existsSync(PREFS_FILE)) return null;
  try { return JSON.parse(readFileSync(PREFS_FILE, "utf8")); } catch { return null; }
}
function writePrefs(prefs) {
  mkdirSync(ROOT, { recursive: true });
  writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2));
}

function readAuth() {
  if (!existsSync(AUTH_FILE)) return {};
  try { return JSON.parse(readFileSync(AUTH_FILE, "utf8")); } catch { return {}; }
}

// Heuristic billing hint for a provider id, based on its auth type and
// id pattern. Never invents — falls back to the raw type string.
function billingHint(id, type) {
  if (/-coding-plan$|^kimi-for-coding$|-for-coding$/.test(id)) return "Coding plan (subscription)";
  if (type === "oauth") return "OAuth subscription";
  if (type === "api") return "API key (per-request)";
  return type || "unknown";
}

// Provider id of a model id — everything before the first slash.
function modelProvider(modelId) {
  if (!modelId) return null;
  const i = modelId.indexOf("/");
  return i < 0 ? modelId : modelId.slice(0, i);
}

// When the detached child finishes after our parent process exited, the
// `child.on('exit')` handler never fires. Reconcile by reading the log and
// inferring outcome from its contents.
function reconcile(job) {
  if (!job) return job;
  if (job.status !== "running") return job;
  if (isAlive(job.pid)) return job;
  let body = "";
  try { body = readFileSync(job.log, "utf8"); } catch {}
  const failed = /\b(Error:|ProviderModelNotFoundError|Bad Request|EACCES|ENOENT|fatal)/i.test(body);
  job.status = failed ? "failed" : "completed";
  job.ended_at = job.ended_at || new Date().toISOString();
  const lines = body.split(/\r?\n/).filter(l => l.trim());
  job.summary = lines.slice(-1)[0] || lines[0] || "";
  writeJob(job);
  return job;
}

const BOOLEAN_FLAGS = new Set(["wait", "thinking", "continue", "json", "refresh"]);

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (BOOLEAN_FLAGS.has(key)) { out.flags[key] = true; continue; }
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) { out.flags[key] = true; }
      else { out.flags[key] = next; i++; }
    } else {
      out._.push(a);
    }
  }
  return out;
}

// ---------- subcommands ----------

function cmdSetup() {
  const path = which("opencode");
  if (!path) {
    console.log(JSON.stringify({ ok: false, reason: "opencode not on PATH. Install from https://opencode.ai/docs/" }, null, 2));
    process.exit(2);
  }
  const v = buildSpawn(["--version"]);
  const a = buildSpawn(["auth", "list"]);
  const ver = spawnSync(v.cmd, v.args, { encoding: "utf8", ...v.opts, windowsHide: true });
  const auth = spawnSync(a.cmd, a.args, { encoding: "utf8", ...a.opts, windowsHide: true });
  const prefs = readPrefs();
  console.log(JSON.stringify({
    ok: true,
    opencode_path: path.trim(),
    version: (ver.stdout || "").trim(),
    auth_list: (auth.stdout || auth.stderr || "").trim(),
    jobs_root: ROOT,
    workspace_bucket: workspaceBucket(),
    prefs: prefs || null,
    prefs_file: PREFS_FILE,
    prefs_configured: !!prefs
  }, null, 2));
}

// Internal: fetch the current models list from opencode (optionally refreshed).
function fetchModels(provider, refresh) {
  const passthrough = ["models"];
  if (provider) passthrough.push(provider);
  if (refresh) passthrough.push("--refresh");
  const s = buildSpawn(passthrough);
  const r = spawnSync(s.cmd, s.args, { encoding: "utf8", ...s.opts, windowsHide: true });
  if (r.status !== 0) return { ok: false, stderr: r.stderr || "" };
  // opencode prints lines like "provider/model"; ignore any non-matching lines.
  const lines = (r.stdout || "").split(/\r?\n/).map(l => l.trim()).filter(l => /^[\w-]+\//.test(l));
  return { ok: true, models: lines };
}

function cmdModels(args) {
  const provider = args._[0] || null;
  const refresh = !!args.flags.refresh;
  const showAll = !!args.flags.all;
  const result = fetchModels(provider, refresh);
  if (!result.ok) { process.stderr.write(result.stderr); process.exit(1); }
  let models = result.models;
  const prefs = readPrefs();
  if (!showAll && prefs && Array.isArray(prefs.allowed_providers) && prefs.allowed_providers.length) {
    const allowed = new Set(prefs.allowed_providers);
    models = models.filter(m => allowed.has(modelProvider(m)));
  }
  process.stdout.write(models.join("\n") + (models.length ? "\n" : ""));
  process.exit(0);
}

// `providers` — list all opencode-authed providers, with auth type, billing
// hint, and a freshly-fetched sample of their current models. Output is JSON
// so Claude can consume it cleanly. Always refreshes the model cache so the
// model list reflects what opencode has TODAY (no stale samples).
function cmdProviders(args) {
  const sampleSize = parseInt(args.flags.sample, 10) || 5;
  const auth = readAuth();
  const ids = Object.keys(auth);
  if (!ids.length) {
    console.log(JSON.stringify({ providers: [], note: "no providers authed in opencode" }, null, 2));
    process.exit(0);
  }
  // Refresh once, then read filtered models per provider from cache.
  const all = fetchModels(null, true);
  if (!all.ok) { process.stderr.write(all.stderr); process.exit(1); }
  const providers = ids.map(id => {
    const type = auth[id] && auth[id].type;
    const myModels = all.models.filter(m => modelProvider(m) === id);
    return {
      id,
      auth_type: type || null,
      billing: billingHint(id, type),
      model_count: myModels.length,
      sample_models: myModels.slice(0, sampleSize)
    };
  });
  const prefs = readPrefs();
  console.log(JSON.stringify({
    providers,
    total_models: all.models.length,
    current_prefs: prefs ? prefs.allowed_providers : null,
    prefs_file: PREFS_FILE
  }, null, 2));
  process.exit(0);
}

function cmdPrefs(args) {
  const sub = args._[0] || "get";
  if (sub === "get") {
    const p = readPrefs();
    console.log(JSON.stringify(p || { allowed_providers: null, configured_at: null }, null, 2));
    process.exit(0);
  }
  if (sub === "reset") {
    if (existsSync(PREFS_FILE)) unlinkSync(PREFS_FILE);
    console.log(JSON.stringify({ ok: true, action: "reset" }, null, 2));
    process.exit(0);
  }
  if (sub === "set") {
    const allowed = (args.flags.allowed || "").split(",").map(s => s.trim()).filter(Boolean);
    if (!allowed.length) { console.error("prefs set: --allowed <comma,list> required"); process.exit(2); }
    // Validate each allowed provider exists in auth.json — never accept a
    // bogus id silently. Caller should call `providers` first to discover.
    const auth = readAuth();
    const unknown = allowed.filter(p => !(p in auth));
    if (unknown.length) {
      console.error("prefs set: providers not configured in opencode auth.json: " + unknown.join(", "));
      process.exit(2);
    }
    const prefs = { allowed_providers: allowed, configured_at: new Date().toISOString() };
    writePrefs(prefs);
    console.log(JSON.stringify({ ok: true, prefs }, null, 2));
    process.exit(0);
  }
  console.error("prefs: subcommand must be get | set | reset");
  process.exit(2);
}

function cmdAgents() {
  const s = buildSpawn(["agent", "list"]);
  const r = spawnSync(s.cmd, s.args, { encoding: "utf8", ...s.opts, windowsHide: true });
  process.stdout.write(r.stdout || "");
  if (r.status !== 0) process.stderr.write(r.stderr || "");
  process.exit(r.status || 0);
}

function cmdDispatch(args) {
  const prompt = args._.join(" ").trim();
  if (!prompt) { console.error("dispatch: prompt is required"); process.exit(2); }
  if (!which("opencode")) { console.error("opencode not on PATH"); process.exit(2); }

  const agent = args.flags.agent || "build";
  const model = args.flags.model || null;

  // Enforce provider preferences. If a model is given, its provider must be
  // in the allowed list. If no model is given, opencode will use its own
  // default — we can't validate that here without parsing opencode config,
  // so we trust the user's opencode default.
  const prefs = readPrefs();
  if (model && prefs && Array.isArray(prefs.allowed_providers) && prefs.allowed_providers.length) {
    const provider = modelProvider(model);
    if (!prefs.allowed_providers.includes(provider)) {
      console.error(JSON.stringify({
        error: "provider_disabled",
        provider,
        model,
        allowed_providers: prefs.allowed_providers,
        hint: "Run /open-review:configure to change preferences, or `prefs reset` to clear them, or `prefs set --allowed " + prefs.allowed_providers.concat(provider).join(",") + "` to add this provider."
      }, null, 2));
      process.exit(2);
    }
  }

  const variant = args.flags.variant || null;
  const session = args.flags.session || null;
  const cont = args.flags.continue || false;
  const dir = args.flags.dir || process.cwd();
  const attach = args.flags.attach || null;
  const wait = !!args.flags.wait;
  const format = args.flags.format || "default"; // default | json
  const thinking = !!args.flags.thinking;

  const id = newJobId();
  const log = logFile(id);
  closeSync(openSync(log, "w"));

  const opencodeArgs = ["run", "--agent", String(agent), "--format", format, "--dir", resolve(dir)];
  if (model) opencodeArgs.push("--model", String(model));
  if (variant) opencodeArgs.push("--variant", String(variant));
  if (session) opencodeArgs.push("--session", String(session));
  if (cont) opencodeArgs.push("--continue");
  if (attach) opencodeArgs.push("--attach", String(attach));
  if (thinking) opencodeArgs.push("--thinking");
  opencodeArgs.push(prompt);

  const job = {
    id,
    agent: String(agent),
    model,
    variant,
    session_in: session,
    prompt,
    dir: resolve(dir),
    attach,
    format,
    status: "running",
    pid: null,
    started_at: new Date().toISOString(),
    ended_at: null,
    exit_code: null,
    cmd: ["opencode", ...opencodeArgs],
    log
  };
  writeJob(job);

  if (wait) {
    const s = buildSpawn(opencodeArgs);
    const r = spawnSync(s.cmd, s.args, { stdio: ["ignore", "inherit", "inherit"], ...s.opts, windowsHide: true });
    job.exit_code = r.status;
    job.status = r.status === 0 ? "completed" : "failed";
    job.ended_at = new Date().toISOString();
    writeJob(job);
    process.exit(r.status || 0);
  }

  // Pipe stdio through this helper and forward to the log file. This is more
  // reliable on Windows than passing file fds through stdio inheritance,
  // which has been observed to silently drop output. The trade-off is that
  // this helper process must stay alive until the child exits — which is
  // fine because the caller invokes us via Bash with run_in_background:true.
  const s = buildSpawn(opencodeArgs);
  const child = spawn(s.cmd, s.args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    ...s.opts,
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" }
  });
  job.pid = child.pid;
  writeJob(job);

  // Print the job manifest immediately so the caller can grab the id and
  // start polling, even though we keep running until the child exits.
  console.log(JSON.stringify({ id, pid: child.pid, status: "running", log }, null, 2));

  const logStream = createWriteStream(log, { flags: "a" });
  child.stdout.on("data", (b) => logStream.write(b));
  child.stderr.on("data", (b) => logStream.write(b));

  child.on("exit", (code) => {
    logStream.end(() => {
      const j = readJob(id) || job;
      j.exit_code = code;
      j.status = code === 0 ? "completed" : (code === null ? "cancelled" : "failed");
      j.ended_at = new Date().toISOString();
      try {
        const tail = readFileSync(log, "utf8").split(/\r?\n/).filter(Boolean);
        j.summary = tail.slice(-1)[0] || tail[0] || "";
      } catch {}
      writeJob(j);
      // Explicit exit: the data listeners on child.stdout/stderr can keep
      // the event loop alive on Windows even after the streams end, leaving
      // a zombie helper process. Force termination once we've finalized.
      process.exit(code === 0 ? 0 : 1);
    });
  });
}

function cmdStatus(args) {
  const id = args._[0];
  if (id) {
    const j = reconcile(readJob(id));
    if (!j) { console.error(`no job ${id}`); process.exit(1); }
    console.log(JSON.stringify(j, null, 2));
    return;
  }
  const jobs = listJobs().map(reconcile).map(j => ({
    id: j.id, status: j.status, agent: j.agent, model: j.model,
    started_at: j.started_at, prompt: (j.prompt || "").slice(0, 80)
  }));
  console.log(JSON.stringify(jobs, null, 2));
}

function cmdResult(args) {
  const id = args._[0] || (listJobs()[0] && listJobs()[0].id);
  if (!id) { console.error("no jobs"); process.exit(1); }
  const j = reconcile(readJob(id));
  if (!j) { console.error(`no job ${id}`); process.exit(1); }
  let body = "";
  try { body = readFileSync(j.log, "utf8"); } catch {}
  if (args.flags.json) {
    console.log(JSON.stringify({ ...j, output: body }, null, 2));
  } else {
    process.stdout.write(`# job ${j.id} [${j.status}] agent=${j.agent} model=${j.model || "default"}\n`);
    process.stdout.write(body);
  }
}

function cmdCancel(args) {
  const id = args._[0];
  if (!id) { console.error("cancel <id> required"); process.exit(2); }
  const j = readJob(id);
  if (!j) { console.error(`no job ${id}`); process.exit(1); }
  if (j.pid && isAlive(j.pid)) {
    try { process.kill(j.pid, "SIGTERM"); } catch {}
    setTimeout(() => { try { if (isAlive(j.pid)) process.kill(j.pid, "SIGKILL"); } catch {} }, 1500).unref();
  }
  j.status = "cancelled";
  j.ended_at = new Date().toISOString();
  writeJob(j);
  console.log(JSON.stringify({ id, status: "cancelled" }, null, 2));
}

function cmdTail(args) {
  const id = args._[0];
  if (!id) { console.error("tail <id> required"); process.exit(2); }
  const j = readJob(id);
  if (!j) { console.error(`no job ${id}`); process.exit(1); }
  try { process.stdout.write(readFileSync(j.log, "utf8")); } catch {}
}

// ---------- main ----------

const argv = process.argv.slice(2);
const sub = argv[0];
const rest = parseArgs(argv.slice(1));

switch (sub) {
  case "setup": cmdSetup(); break;
  case "models": cmdModels(rest); break;
  case "agents": cmdAgents(); break;
  case "providers": cmdProviders(rest); break;
  case "prefs": cmdPrefs(rest); break;
  case "dispatch": cmdDispatch(rest); break;
  case "status": cmdStatus(rest); break;
  case "result": cmdResult(rest); break;
  case "cancel": cmdCancel(rest); break;
  case "tail": cmdTail(rest); break;
  default:
    console.error("usage: open-review.mjs <setup|providers|prefs|dispatch|status|result|cancel|tail|models|agents> [...]");
    process.exit(2);
}
