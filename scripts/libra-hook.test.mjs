import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const HOOK = path.join(ROOT, "scripts", "libra-hook.mjs");

test("Codex SessionStart posts local session and transcript summaries by default", async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "libra-hook-repo-"));
  spawnSync("git", ["init"], { cwd: repo, stdio: "ignore" });
  const transcript = path.join(repo, "session.jsonl");
  fs.writeFileSync(transcript, [
    JSON.stringify({ type: "user", message: { content: "Fix prod using token=super-secret-value" } }),
    JSON.stringify({ type: "assistant", message: { content: "Changed src/api.ts" } }),
  ].join("\n"));

  let received = null;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      received = { url: req.url, body: JSON.parse(body || "{}") };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, accepted: 3, sessionId: "s1", intents: [] }));
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const api = `http://127.0.0.1:${server.address().port}`;
  const child = spawn("node", [HOOK, "codex"], {
    cwd: repo,
    env: { ...process.env, LIBRA_API_TOKEN: "libra_exla-api-key-test", LIBRA_API_URL: api },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end(JSON.stringify({
    hook_event_name: "SessionStart",
    session_id: "codex-session-1",
    cwd: repo,
    transcript_path: transcript,
  }));
  const code = await new Promise((resolve) => child.on("exit", resolve));
  await new Promise((resolve) => server.close(resolve));

  assert.equal(code, 0);
  assert.ok(received);
  assert.equal(received.url, "/developer-sessions/events");
  assert.equal(received.body.client, "codex");
  assert.equal(received.body.repo, `local/${path.basename(repo)}`);
  assert.equal(received.body.metadata.captureTranscript, "summary");
  assert.equal(received.body.metadata.transcriptPathDetected, true);
  assert.deepEqual(received.body.events.map((event) => event.type), [
    "session_start",
    "transcript_summary",
    "transcript_summary",
  ]);
  const json = JSON.stringify(received.body);
  assert.doesNotMatch(json, /super-secret-value/);
  assert.match(json, /\[REDACTED\]/);
});

test("Codex SessionStart finds the matching Codex transcript file by session id", async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "libra-hook-repo-"));
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "libra-codex-home-"));
  const sessionId = "019edcff-0ee4-7582-95d4-28ba2081592c";
  const sessionDir = path.join(codexHome, "sessions", "2026", "06", "22");
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, `rollout-2026-06-22T01-00-00-${sessionId}.jsonl`), [
    JSON.stringify({ type: "user", message: { content: "Investigate queue backlog" } }),
  ].join("\n"));

  let received = null;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      received = JSON.parse(body || "{}");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, accepted: 2, sessionId: "s2", intents: [] }));
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const child = spawn("node", [HOOK, "codex"], {
    cwd: repo,
    env: {
      ...process.env,
      CODEX_HOME: codexHome,
      LIBRA_API_TOKEN: "libra_exla-api-key-test",
      LIBRA_API_URL: `http://127.0.0.1:${server.address().port}`,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end(JSON.stringify({
    hook_event_name: "SessionStart",
    session_id: sessionId,
    cwd: repo,
  }));
  const code = await new Promise((resolve) => child.on("exit", resolve));
  await new Promise((resolve) => server.close(resolve));

  assert.equal(code, 0);
  assert.ok(received);
  assert.equal(received.client, "codex");
  assert.equal(received.metadata.transcriptPathDetected, true);
  assert.ok(received.events.some((event) => event.type === "transcript_summary"));
});
