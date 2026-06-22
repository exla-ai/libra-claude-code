import test from "node:test";
import assert from "node:assert/strict";
import { installHooks } from "./install-codex-hooks.mjs";

test("installHooks preserves existing Codex hooks and installs Libra idempotently", () => {
  const existing = {
    hooks: {
      SessionStart: [
        { hooks: [{ type: "command", command: "/usr/local/bin/existing" }] },
      ],
      Stop: [
        { hooks: [{ type: "command", command: "/usr/local/bin/notify" }] },
      ],
    },
  };

  const once = installHooks(existing, "/Users/me/Libra Plugin/scripts/libra-hook.mjs");
  const twice = installHooks(once, "/Users/me/Libra Plugin/scripts/libra-hook.mjs");

  assert.equal(twice.hooks.SessionStart.length, 2);
  assert.equal(twice.hooks.UserPromptSubmit.length, 1);
  assert.equal(twice.hooks.Stop.length, 2);
  assert.equal(twice.hooks.SessionStart[0].hooks[0].command, "/usr/local/bin/existing");
  assert.equal(
    twice.hooks.SessionStart[1].hooks[0].command,
    'node "/Users/me/Libra Plugin/scripts/libra-hook.mjs" codex',
  );
  assert.equal(twice.hooks.UserPromptSubmit[0].hooks[0].timeout, 10);
});
