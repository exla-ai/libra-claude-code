#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const THIS_FILE = fileURLToPath(import.meta.url);
const PLUGIN_ROOT = path.resolve(path.dirname(THIS_FILE), "..");
const HOOK_SCRIPT = process.env.LIBRA_CODEX_HOOK_SCRIPT || path.join(PLUGIN_ROOT, "scripts", "libra-hook.mjs");
const CODEX_HOOKS_PATH = process.env.LIBRA_CODEX_HOOKS_PATH || path.join(os.homedir(), ".codex", "hooks.json");
const CODEX_EVENTS = ["SessionStart", "UserPromptSubmit", "Stop"];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

function main() {
  try {
    const current = readHooksFile(CODEX_HOOKS_PATH);
    const next = installHooks(current, HOOK_SCRIPT);
    fs.mkdirSync(path.dirname(CODEX_HOOKS_PATH), { recursive: true, mode: 0o700 });
    fs.writeFileSync(CODEX_HOOKS_PATH, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    console.log(JSON.stringify({ ok: true, hooksPath: CODEX_HOOKS_PATH, events: CODEX_EVENTS }));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      hooksPath: CODEX_HOOKS_PATH,
      error: error instanceof Error ? error.message : String(error),
    }));
    process.exit(0);
  }
}

function readHooksFile(file) {
  if (!fs.existsSync(file)) return { hooks: {} };
  const raw = fs.readFileSync(file, "utf8").trim();
  if (!raw) return { hooks: {} };
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { hooks: {} };
  return parsed;
}

export function installHooks(config, hookScript) {
  const next = { ...(config || {}) };
  const hooks = next.hooks && typeof next.hooks === "object" && !Array.isArray(next.hooks)
    ? { ...next.hooks }
    : {};
  const command = `node "${escapeShellDoubleQuoted(hookScript)}" codex`;

  for (const event of CODEX_EVENTS) {
    const existing = Array.isArray(hooks[event]) ? hooks[event].slice() : [];
    const alreadyInstalled = existing.some((entry) =>
      Array.isArray(entry?.hooks) &&
      entry.hooks.some((hook) => hook?.type === "command" && String(hook.command || "") === command),
    );
    hooks[event] = alreadyInstalled
      ? existing
      : [
          ...existing,
          {
            hooks: [
              { type: "command", command, timeout: 10 },
            ],
          },
        ];
  }

  next.hooks = hooks;
  return next;
}

function escapeShellDoubleQuoted(value) {
  return String(value).replace(/(["\\$`])/g, "\\$1");
}
