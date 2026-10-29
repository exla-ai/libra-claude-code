import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { CODEX_EVENTS, CODEX_HOOKS_REV, codexHookGroups, isLibraHook, mergeLibraHooks } from "./install-codex-hooks.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const INSTALLER = path.join(ROOT, "scripts", "install-codex-hooks.mjs");
const PLUGIN_HOOKS = JSON.parse(fs.readFileSync(path.join(ROOT, "hooks", "hooks.json"), "utf8"));
const command = (root) => `node "${root}/scripts/libra-hook.mjs" codex`;

test("Codex gets every hook it can run, pointed at the fixed clone and marked as Codex", () => {
  const groups = codexHookGroups(PLUGIN_HOOKS, "/Users/me/Libra Plugin");
  assert.deepEqual(Object.keys(groups), CODEX_EVENTS);
  assert.equal(groups.PostToolUseFailure, undefined, "Codex ignores PostToolUseFailure");
  for (const [event, group] of Object.entries(groups)) {
    assert.equal(group.hooks.length, 1, `${event} runs one Libra command`);
    assert.equal(group.hooks[0].command, command("/Users/me/Libra Plugin"), `${event} names the agent`);
    assert.equal(group.hooks[0].asyncRewake, undefined, `${event} asks for nothing Codex cannot do`);
  }
  assert.equal(groups.PreToolUse.matcher, "Bash");
  assert.deepEqual(groups.PostToolUse.hooks[0], { type: "command", command: command("/Users/me/Libra Plugin"), timeout: 30, async: true });
  assert.equal(groups.PostCompact.hooks[0].async, true);
  assert.equal(groups.SessionStart.hooks[0].async, undefined, "SessionStart answers, so Codex waits for it");
  assert.equal(groups.SessionEnd.hooks[0].timeout, 3, "Codex waits at most 3 seconds on SessionEnd");
  assert.ok(!JSON.stringify(groups).includes(" watch"), "the review watcher needs a wake-up Codex does not have");
  // Shell characters in the path are escaped inside the double quotes.
  assert.equal(codexHookGroups(PLUGIN_HOOKS, '/tmp/a"b$c').Stop.hooks[0].command, 'node "/tmp/a\\"b\\$c/scripts/libra-hook.mjs" codex');
});

test("Merging replaces Libra's hooks where they stand and keeps every other hook", () => {
  const groups = codexHookGroups(PLUGIN_HOOKS, "/home/me/.config/libra/plugin");
  const existing = {
    model: "kept",
    hooks: {
      // The 1.x installer: three events, a versioned path.
      SessionStart: [
        { hooks: [{ type: "command", command: 'node "/old/cache/libra-claude-code/1.9.0/scripts/libra-hook.mjs" codex', timeout: 10 }] },
        { hooks: [{ type: "command", command: "/usr/local/bin/existing" }] },
      ],
      Stop: [
        { hooks: [{ type: "command", command: "/usr/local/bin/notify" }, { type: "command", command: 'node "/old/libra-hook.mjs" codex' }] },
      ],
      PostToolUseFailure: [{ hooks: [{ type: "command", command: 'node "/old/libra-hook.mjs" codex' }] }],
    },
  };
  const once = mergeLibraHooks(existing, groups);
  assert.equal(once.model, "kept");
  assert.deepEqual(once.hooks.SessionStart.map((group) => group.hooks[0].command), [command("/home/me/.config/libra/plugin"), "/usr/local/bin/existing"],
    "Libra's group is replaced in place, so the hook after it keeps its position (and its approval)");
  assert.deepEqual(once.hooks.Stop[0], { hooks: [{ type: "command", command: "/usr/local/bin/notify" }] }, "a shared group loses only Libra's handler");
  assert.equal(once.hooks.Stop[1].hooks[0].command, command("/home/me/.config/libra/plugin"));
  assert.equal(once.hooks.PostToolUseFailure, undefined, "an event Libra no longer uses is removed when nothing else is left");
  assert.deepEqual(Object.keys(once.hooks).sort(), [...CODEX_EVENTS].sort());
  assert.deepEqual(mergeLibraHooks(once, groups), once, "installing twice changes nothing");
  assert.notEqual(existing.hooks.SessionStart[0].hooks[0].command, command("/home/me/.config/libra/plugin"), "the input is not mutated");

  const removed = mergeLibraHooks(once, {});
  assert.deepEqual(removed, { model: "kept", hooks: {
    SessionStart: [{ hooks: [{ type: "command", command: "/usr/local/bin/existing" }] }],
    Stop: [{ hooks: [{ type: "command", command: "/usr/local/bin/notify" }] }],
  } });
  assert.ok(!JSON.stringify(removed).includes("libra-hook.mjs"));
  assert.equal(isLibraHook({ command: "/usr/local/bin/existing" }), false);
});

function makeRemote() {
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), "libra-plugin-remote-"));
  fs.cpSync(ROOT, remote, { recursive: true, filter: (from) => !/(^|[\\/])(\.git|node_modules)([\\/]|$)/.test(path.relative(ROOT, from)) });
  const git = (...args) => spawnSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: remote, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "plugin");
  return remote;
}

function runInstaller(home, args = [], env = {}) {
  const clean = { ...process.env };
  for (const key of ["LIBRA_API_TOKEN", "LIBRA_CODEX_PLUGIN_DIR", "LIBRA_CODEX_HOOKS_PATH", "LIBRA_PLUGIN_REPO", "CODEX_HOME"]) delete clean[key];
  const result = spawnSync(process.execPath, [INSTALLER, ...args], {
    encoding: "utf8",
    // An empty PATH entry keeps a real `codex` from answering the status check.
    env: { ...clean, HOME: home, CODEX_HOME: path.join(home, ".codex"), ...env },
  });
  return { status: result.status, out: JSON.parse(result.stdout) };
}

test("The installer clones the plugin once, writes every Codex hook, and records the install", () => {
  const remote = makeRemote();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "libra-codex-install-"));
  const codexDir = path.join(home, ".codex");
  fs.mkdirSync(codexDir);
  const userHooks = { hooks: { Stop: [{ hooks: [{ type: "command", command: "/usr/local/bin/notify" }] }] } };
  fs.writeFileSync(path.join(codexDir, "hooks.json"), JSON.stringify(userHooks));
  fs.writeFileSync(path.join(codexDir, "config.toml"), '[plugins."libra-claude-code@libra"]\nenabled = true\n');

  const first = runInstaller(home, [], { LIBRA_PLUGIN_REPO: remote });
  assert.equal(first.status, 0);
  const clone = path.join(home, ".config", "libra", "plugin");
  assert.equal(first.out.ok, true);
  assert.equal(first.out.plugin, "cloned");
  assert.equal(first.out.root, clone);
  assert.equal(first.out.selfUpdate, true);
  assert.deepEqual(first.out.events, CODEX_EVENTS);
  assert.equal(first.out.credentials, "missing");
  assert.ok(first.out.warnings.some((line) => /plugin is also enabled inside Codex/.test(line)));
  assert.ok(first.out.warnings.some((line) => /No Libra key/.test(line)));
  assert.match(first.out.next, /run \/hooks, and approve the 8 Libra hooks/);
  assert.ok(fs.existsSync(path.join(clone, ".git")), "a real clone, so the hook can update it");

  const written = JSON.parse(fs.readFileSync(path.join(codexDir, "hooks.json"), "utf8"));
  assert.equal(written.hooks.Stop[0].hooks[0].command, "/usr/local/bin/notify", "the developer's hook keeps its place");
  assert.equal(written.hooks.Stop[1].hooks[0].command, command(clone));
  assert.equal(written.hooks.SessionStart[0].hooks[0].command, command(clone));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(codexDir, "hooks.json.before-libra"), "utf8")), userHooks, "the original file is kept");
  assert.equal(fs.statSync(path.join(codexDir, "hooks.json")).mode & 0o777, 0o600);

  const record = JSON.parse(fs.readFileSync(path.join(home, ".config", "libra", "codex-install.json"), "utf8"));
  assert.equal(record.root, clone);
  assert.equal(record.hooksRev, CODEX_HOOKS_REV);
  assert.equal(record.selfUpdate, true);
  assert.match(record.version, /^\d+\.\d+\.\d+$/);

  // Again, with a key saved: the clone is fast-forwarded and hooks.json is untouched.
  fs.writeFileSync(path.join(home, ".config", "libra", "credentials.json"), JSON.stringify({ token: "libra_exla-api-key-test" }));
  const before = fs.readFileSync(path.join(codexDir, "hooks.json"), "utf8");
  const second = runInstaller(home, [], { LIBRA_PLUGIN_REPO: remote });
  assert.equal(second.out.plugin, "updated");
  assert.equal(second.out.credentials, "file");
  assert.equal(fs.readFileSync(path.join(codexDir, "hooks.json"), "utf8"), before);

  const status = runInstaller(home, ["--status"], { PATH: path.dirname(process.execPath) });
  assert.equal(status.out.ok, true);
  assert.equal(status.out.root, clone);
  assert.equal(status.out.current, true);
  assert.deepEqual(status.out.installed.sort(), [...CODEX_EVENTS].sort());
  assert.match(status.out.codex.unavailable, /codex is not on PATH/);

  const removed = runInstaller(home, ["--uninstall"]);
  assert.equal(removed.out.ok, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(codexDir, "hooks.json"), "utf8")), userHooks);
  assert.ok(!fs.existsSync(path.join(home, ".config", "libra", "codex-install.json")));
});

test("Without git access the installer copies the plugin, and it never takes over a folder that is not Libra's", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "libra-codex-install-"));
  const missing = path.join(home, "no-such-repo");
  const copied = runInstaller(home, [], { LIBRA_PLUGIN_REPO: missing });
  const target = path.join(home, ".config", "libra", "plugin");
  assert.equal(copied.out.ok, true);
  assert.equal(copied.out.plugin, "copied");
  assert.equal(copied.out.selfUpdate, false);
  assert.ok(copied.out.warnings.some((line) => /cannot update itself/.test(line)));
  assert.ok(fs.existsSync(path.join(target, "scripts", "libra-hook.mjs")));
  assert.ok(!fs.existsSync(path.join(target, ".git")));

  // A later install with git access replaces the copy with a clone.
  const cloned = runInstaller(home, [], { LIBRA_PLUGIN_REPO: makeRemote() });
  assert.equal(cloned.out.plugin, "cloned");
  assert.ok(fs.existsSync(path.join(target, ".git")));

  const other = path.join(home, "somebody-elses");
  fs.mkdirSync(other);
  fs.writeFileSync(path.join(other, "notes.txt"), "keep me");
  const refused = runInstaller(home, [], { LIBRA_PLUGIN_REPO: missing, LIBRA_CODEX_PLUGIN_DIR: other });
  assert.equal(refused.status, 1);
  assert.equal(refused.out.ok, false);
  assert.match(refused.out.error, /is not Libra's plugin copy/);
  assert.equal(fs.readFileSync(path.join(other, "notes.txt"), "utf8"), "keep me");
});

test("Run from the fixed clone itself, the installer installs in place", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "libra-codex-install-"));
  const result = runInstaller(home, [], { LIBRA_CODEX_PLUGIN_DIR: ROOT });
  assert.equal(result.out.ok, true);
  assert.equal(result.out.plugin, "in_place");
  const written = JSON.parse(fs.readFileSync(path.join(home, ".codex", "hooks.json"), "utf8"));
  assert.equal(written.hooks.UserPromptSubmit[0].hooks[0].command, command(ROOT));
});
