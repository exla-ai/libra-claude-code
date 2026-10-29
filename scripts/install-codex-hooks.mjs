#!/usr/bin/env node
// Installs Libra's hooks for Codex at the user level ($CODEX_HOME/hooks.json).
//
// Codex runs a hook only after the developer approves it in /hooks. It approves a
// user-level hook by its definition alone, so the command must stay the same when
// Libra updates. The hooks therefore point at one fixed clone of the plugin
// (~/.config/libra/plugin by default), and the hook keeps that clone up to date.
// The developer approves once.
//
//   node install-codex-hooks.mjs              install or update, then print JSON
//   node install-codex-hooks.mjs --status     the installed hooks, and whether Codex trusts them
//   node install-codex-hooks.mjs --uninstall  remove Libra's hooks and leave every other hook
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const THIS_FILE = fileURLToPath(import.meta.url);
const PLUGIN_ROOT = path.resolve(path.dirname(THIS_FILE), "..");
const DEFAULT_REPO = "https://github.com/exla-ai/libra-claude-code.git";
// A copy made without git: it cannot update itself, and a later install may replace it.
const COPY_MARKER = ".libra-plugin-copy";
// Raised when the installed hook set changes, so a hook can tell an older install apart.
export const CODEX_HOOKS_REV = 2;
// The events Codex 0.165 runs. It ignores PostToolUseFailure, cannot wake an idle
// session (so the review watcher is left out), and waits at most 3 seconds on SessionEnd.
export const CODEX_EVENTS = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostCompact", "SubagentStart", "Stop", "SessionEnd"];
const CODEX_MAX_TIMEOUT = { SessionEnd: 3 };
const PLUGIN_COMMAND_RE = /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/libra-hook\.mjs" claude-code(?: async)?$/;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const run = args.includes("--status") ? status : args.includes("--uninstall") ? uninstall : install;
  run().then((result) => {
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  });
}

// The Codex hook groups for the plugin's own hooks.json, one group per event.
export function codexHookGroups(pluginHooks, root) {
  const command = `node "${escapeShellDoubleQuoted(path.join(root, "scripts", "libra-hook.mjs"))}" codex`;
  const groups = {};
  for (const event of CODEX_EVENTS) {
    for (const group of pluginHooks?.hooks?.[event] || []) {
      const hooks = (Array.isArray(group?.hooks) ? group.hooks : [])
        .filter((hook) => hook?.type === "command" && PLUGIN_COMMAND_RE.test(String(hook.command || "")))
        .map((hook) => ({
          type: "command",
          command,
          timeout: Math.min(Number(hook.timeout) || 10, CODEX_MAX_TIMEOUT[event] ?? Infinity),
          ...(hook.async ? { async: true } : {}),
        }));
      if (!hooks.length) continue;
      groups[event] = { ...(group.matcher ? { matcher: group.matcher } : {}), hooks: hooks.slice(0, 1) };
      break;
    }
  }
  return groups;
}

// Puts Libra's groups into a Codex hooks config and removes any older Libra hook.
// Codex keys approval by position, so Libra's group is replaced where it stands
// and the hooks around it keep their place.
export function mergeLibraHooks(config, groups) {
  const next = isRecord(config) ? structuredClone(config) : {};
  const hooks = isRecord(next.hooks) ? next.hooks : {};
  next.hooks = hooks;
  for (const event of new Set([...Object.keys(hooks), ...Object.keys(groups)])) {
    const desired = groups[event];
    const kept = [];
    let placed = false;
    for (const group of Array.isArray(hooks[event]) ? hooks[event] : []) {
      const handlers = Array.isArray(group?.hooks) ? group.hooks : [];
      const others = handlers.filter((hook) => !isLibraHook(hook));
      if (others.length === handlers.length) kept.push(group);
      else if (others.length) kept.push({ ...group, hooks: others });
      else if (desired && !placed) {
        kept.push(desired);
        placed = true;
      }
    }
    if (desired && !placed) kept.push(desired);
    if (kept.length) hooks[event] = kept;
    else delete hooks[event];
  }
  return next;
}

export function isLibraHook(hook) {
  return /libra-hook\.mjs/.test(String(hook?.command || ""));
}

export function installRecordPath() {
  return path.join(os.homedir(), ".config", "libra", "codex-install.json");
}

function codexHome(env = process.env) {
  return env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

function hooksPath(env = process.env) {
  return env.LIBRA_CODEX_HOOKS_PATH || path.join(codexHome(env), "hooks.json");
}

async function install() {
  const target = path.resolve(process.env.LIBRA_CODEX_PLUGIN_DIR || path.join(os.homedir(), ".config", "libra", "plugin"));
  const file = hooksPath();
  try {
    const copy = ensurePluginCopy(target, process.env.LIBRA_PLUGIN_REPO || DEFAULT_REPO);
    const pluginHooks = JSON.parse(fs.readFileSync(path.join(copy.root, "hooks", "hooks.json"), "utf8"));
    const groups = codexHookGroups(pluginHooks, copy.root);
    if (!groups.SessionStart) throw new Error(`${copy.root}/hooks/hooks.json has no Libra hooks`);
    const before = readHooksFile(file);
    const next = mergeLibraHooks(before.config, groups);
    writeHooksFile(file, before, next);
    writeJsonFile(installRecordPath(), {
      root: copy.root,
      hooksPath: file,
      hooksRev: CODEX_HOOKS_REV,
      selfUpdate: copy.selfUpdate,
      version: pluginVersion(copy.root),
      installedAt: new Date().toISOString(),
    });
    const warnings = [...copy.warnings];
    if (codexPluginEnabled()) {
      warnings.push("The Libra plugin is also enabled inside Codex. Its hooks now step aside for these, and Codex asks to approve them again after every plugin update. Turn it off in /plugins.");
    }
    const credentials = credentialsSource();
    if (credentials === "missing") warnings.push("No Libra key on this machine yet. Run /libra-login in Claude Code, or save the key in ~/.config/libra/credentials.json.");
    return {
      ok: true,
      hooksPath: file,
      root: copy.root,
      plugin: copy.how,
      selfUpdate: copy.selfUpdate,
      events: Object.keys(groups),
      credentials,
      warnings,
      next: `Open Codex, run /hooks, and approve the ${Object.keys(groups).length} Libra hooks. Codex skips a hook until it is approved. Updates keep the approval.`,
    };
  } catch (error) {
    return { ok: false, hooksPath: file, error: error instanceof Error ? error.message : String(error) };
  }
}

async function uninstall() {
  const file = hooksPath();
  try {
    const before = readHooksFile(file);
    if (before.exists) writeHooksFile(file, before, mergeLibraHooks(before.config, {}));
    fs.rmSync(installRecordPath(), { force: true });
    return { ok: true, hooksPath: file, removed: true };
  } catch (error) {
    return { ok: false, hooksPath: file, error: error instanceof Error ? error.message : String(error) };
  }
}

async function status() {
  const file = hooksPath();
  let record = null;
  try { record = JSON.parse(fs.readFileSync(installRecordPath(), "utf8")); } catch {}
  let installed = [];
  try {
    const { config } = readHooksFile(file);
    installed = Object.entries(config.hooks || {})
      .filter(([, list]) => Array.isArray(list) && list.some((group) => (group?.hooks || []).some(isLibraHook)))
      .map(([event]) => event);
  } catch (error) {
    return { ok: false, hooksPath: file, error: error instanceof Error ? error.message : String(error) };
  }
  const listed = await codexHookList(process.cwd());
  const libra = listed.hooks?.filter((hook) => isLibraHook(hook) || hook.pluginId === "libra-claude-code@libra") || null;
  return {
    ok: true,
    hooksPath: file,
    root: record?.root ?? null,
    version: record?.root ? pluginVersion(record.root) : null,
    hooksRev: record?.hooksRev ?? null,
    current: record?.hooksRev === CODEX_HOOKS_REV,
    installed,
    credentials: credentialsSource(),
    codex: libra
      ? libra.map((hook) => ({ event: hook.eventName, source: hook.pluginId || hook.source, trust: hook.trustStatus, enabled: hook.enabled }))
      : { unavailable: listed.error },
  };
}

// The plugin copy the hooks run from: an existing clone is brought up to date,
// otherwise the plugin is cloned. Without git, this plugin is copied there instead.
export function ensurePluginCopy(target, repo, source = PLUGIN_ROOT) {
  const warnings = [];
  const isGit = (dir) => fs.existsSync(path.join(dir, ".git"));
  if (samePath(target, source)) return { root: target, how: "in_place", selfUpdate: isGit(target), warnings };
  if (isGit(target)) {
    const fetched = runGit(["fetch", "--quiet", "origin", "main"], target);
    const merged = fetched.ok ? runGit(["merge", "--ff-only", "--quiet", "FETCH_HEAD"], target) : fetched;
    if (!merged.ok) warnings.push(`Could not update ${target} (${merged.error}). The copy already there is in use.`);
    return { root: target, how: merged.ok ? "updated" : "existing", selfUpdate: true, warnings };
  }
  const exists = fs.existsSync(target);
  if (exists && fs.readdirSync(target).length && !fs.existsSync(path.join(target, COPY_MARKER))) {
    throw new Error(`${target} is not Libra's plugin copy. Set LIBRA_CODEX_PLUGIN_DIR to an empty folder.`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const staging = `${target}.staging-${process.pid}`;
  fs.rmSync(staging, { recursive: true, force: true });
  const cloned = runGit(["clone", "--quiet", "--branch", "main", repo, staging], path.dirname(target));
  let selfUpdate = true;
  if (!cloned.ok) {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.cpSync(source, staging, { recursive: true, filter: (from) => !/(^|[\\/])(\.git|node_modules)([\\/]|$)/.test(path.relative(source, from)) });
    fs.writeFileSync(path.join(staging, COPY_MARKER), `${new Date().toISOString()}\n`);
    warnings.push(`git clone failed (${cloned.error}). Installed a copy that cannot update itself; run this installer again to update it.`);
    selfUpdate = false;
  }
  if (exists) {
    const old = `${target}.old-${process.pid}`;
    fs.renameSync(target, old);
    fs.renameSync(staging, target);
    fs.rmSync(old, { recursive: true, force: true });
  } else {
    fs.renameSync(staging, target);
  }
  return { root: target, how: selfUpdate ? "cloned" : "copied", selfUpdate, warnings };
}

function runGit(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 120_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  if (result.status === 0) return { ok: true };
  const detail = String(result.stderr || result.error?.message || `git exited ${result.status}`).trim().split("\n").pop();
  return { ok: false, error: detail };
}

function samePath(a, b) {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return false;
  }
}

function pluginVersion(root) {
  try {
    return /const PLUGIN_VERSION = "([^"]+)";/.exec(fs.readFileSync(path.join(root, "scripts", "libra-hook.mjs"), "utf8"))?.[1] ?? null;
  } catch {
    return null;
  }
}

function credentialsSource() {
  if (process.env.LIBRA_API_TOKEN) return "env";
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".config", "libra", "credentials.json"), "utf8"));
    if (parsed?.token) return "file";
  } catch {}
  return "missing";
}

// Whether config.toml enables the Libra plugin inside Codex. Codex enables an
// installed plugin unless its table says enabled = false.
function codexPluginEnabled() {
  let text = "";
  try { text = fs.readFileSync(path.join(codexHome(), "config.toml"), "utf8"); } catch { return false; }
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s*\[plugins\.("libra-claude-code@libra"|'libra-claude-code@libra')\]\s*$/.test(line));
  if (start < 0) return false;
  for (const line of lines.slice(start + 1)) {
    if (/^\s*\[/.test(line)) break;
    const match = /^\s*enabled\s*=\s*(true|false)\b/.exec(line);
    if (match) return match[1] === "true";
  }
  return true;
}

// Asks Codex which hooks it found and whether each is approved. Read-only.
function codexHookList(cwd) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("codex", ["app-server"], { stdio: ["pipe", "pipe", "ignore"] });
    } catch (error) {
      resolve({ error: error.message });
      return;
    }
    const finish = (result) => {
      clearTimeout(timer);
      child.kill();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ error: "codex app-server did not answer in 20 seconds" }), 20_000);
    child.on("error", (error) => finish({ error: error.code === "ENOENT" ? "codex is not on PATH" : error.message }));
    child.stdin.on("error", () => {});
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.id === 1) {
        send({ method: "initialized" });
        send({ id: 2, method: "hooks/list", params: { cwds: [cwd] } });
      } else if (message.id === 2) {
        if (message.error) finish({ error: message.error.message || "hooks/list failed" });
        else finish({ hooks: (message.result?.data || []).flatMap((entry) => entry.hooks || []) });
      }
    });
    send({ id: 1, method: "initialize", params: { clientInfo: { name: "libra-install", version: "1" } } });
  });
}

function readHooksFile(file) {
  if (!fs.existsSync(file)) return { exists: false, text: "", config: { hooks: {} } };
  const text = fs.readFileSync(file, "utf8");
  if (!text.trim()) return { exists: true, text, config: { hooks: {} } };
  const config = JSON.parse(text);
  if (!isRecord(config)) throw new Error(`${file} must contain a JSON object`);
  if (config.hooks !== undefined && !isRecord(config.hooks)) throw new Error(`${file} hooks must be an object`);
  return { exists: true, text, config };
}

// Keeps the developer's original file beside the new one the first time Libra changes it.
function writeHooksFile(file, before, config) {
  const text = `${JSON.stringify(config, null, 2)}\n`;
  if (before.exists && text === before.text) return;
  const backup = `${file}.before-libra`;
  if (before.exists && !fs.existsSync(backup)) fs.writeFileSync(backup, before.text, { mode: 0o600 });
  writeFileAtomic(file, text);
}

function writeJsonFile(file, value) {
  writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFileAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function escapeShellDoubleQuoted(value) {
  return String(value).replace(/(["\\$`])/g, "\\$1");
}
