#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const DEFAULT_API = "https://api.libra.exla.ai";
const MAX_TRANSCRIPT_BYTES_PER_HOOK = 80_000;
const MAX_EVENTS_PER_POST = 40;
const SECRET_KEY_RE = /(?:token|secret|password|passwd|authorization|cookie|api[_-]?key|private[_-]?key|access[_-]?key|session|credential)/i;

main().catch(() => process.exit(0));

async function main() {
  const input = readJsonFromStdin();
  if (!input) return;

  const cwd = input.cwd || process.cwd();
  const config = readConfig(cwd);
  if (config.enabled === false) return;

  const credentials = readCredentials();
  if (!credentials.token) return;

  const repoInfo = resolveRepo(cwd);

  const sessionExternalId = String(
    input.session_id ||
    input.sessionId ||
    input.conversation_id ||
    process.env.CLAUDE_CODE_SESSION_ID ||
    hash(`${cwd}:${input.transcript_path || Date.now()}`),
  );
  const hookEvent = String(input.hook_event_name || input.hookEventName || input.event || "event");
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  const head = git(["rev-parse", "HEAD"], cwd);
  const events = buildEvents(input, hookEvent, config);

  if (input.transcript_path && config.captureTranscript === true) {
    events.push(...tailTranscriptEvents(input.transcript_path, sessionExternalId, config));
  } else if (input.transcript_path && config.captureTranscript === "summary") {
    events.push(...tailTranscriptSummaries(input.transcript_path, sessionExternalId, config));
  }

  if (events.length) {
    await postJson(`${credentials.api}/developer-sessions/events`, credentials.token, {
      sessionId: sessionExternalId,
      repo: repoInfo.repo,
      branch,
      head,
      client: "claude-code",
      cwd,
      metadata: {
        hookEvent,
        pluginVersion: "0.1.0",
        captureTranscript: config.captureTranscript || false,
        repoSource: repoInfo.source,
        repoDetected: repoInfo.source !== "local",
      },
      events: events.slice(0, MAX_EVENTS_PER_POST),
    }).catch(() => {});
  }

  if (hookEvent === "PreToolUse" && String(input.tool_name || input.tool || "").toLowerCase() === "bash") {
    if (repoInfo.source !== "local") {
      await maybeRunCommitCheck(input, credentials, { cwd, repo: repoInfo.repo, branch, head, sessionExternalId });
    }
  }
}

function readJsonFromStdin() {
  try {
    const raw = fs.readFileSync(0, "utf8");
    return raw.trim() ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function readCredentials() {
  const api = process.env.LIBRA_API_URL || DEFAULT_API;
  const token = process.env.LIBRA_API_TOKEN || readStoredToken();
  return { api, token };
}

function readStoredToken() {
  try {
    const raw = fs.readFileSync(path.join(os.homedir(), ".config/libra/credentials.json"), "utf8");
    const parsed = JSON.parse(raw);
    return String(parsed.token || "");
  } catch {
    return "";
  }
}

function readConfig(cwd) {
  const defaults = {
    enabled: true,
    ignorePaths: ["**/*.snap", "fixtures/**"],
    maxDiffBytes: 200_000,
    maxTranscriptBytesPerHook: MAX_TRANSCRIPT_BYTES_PER_HOOK,
    captureTranscript: false,
  };
  try {
    const raw = fs.readFileSync(path.join(cwd, ".libra/claude-code.json"), "utf8");
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return defaults;
  }
}

function buildEvents(input, hookEvent, config) {
  const now = new Date().toISOString();
  const base = {
    type: normalizeEventType(hookEvent),
    occurredAt: now,
    sequence: Date.now(),
    payload: sanitizeValue({
      hook_event_name: hookEvent,
      tool_name: input.tool_name || input.tool,
      tool_input: sanitizeToolInput(input.tool_input, config),
      prompt: input.prompt || input.user_prompt,
      compact_summary: input.summary,
      result: input.tool_response || input.tool_result,
    }),
  };
  base.summary = summarizeHookEvent(base.payload, hookEvent);
  return [base];
}

function normalizeEventType(name) {
  return String(name || "event")
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9_:-]/g, "_")
    .toLowerCase();
}

function resolveRepo(cwd) {
  const origin = git(["remote", "get-url", "origin"], cwd);
  if (origin) return { repo: origin, source: "origin" };
  const remotes = git(["remote", "-v"], cwd)
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/)[1])
    .filter(Boolean);
  if (remotes[0]) return { repo: remotes[0], source: "remote" };
  const root = git(["rev-parse", "--show-toplevel"], cwd) || cwd || "workspace";
  return { repo: localRepoLabel(root), source: "local" };
}

function localRepoLabel(value) {
  const base = path.basename(String(value || "workspace")) || "workspace";
  const safe = sanitizeText(base, 80)
    .replace(/[^A-Za-z0-9_.-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "workspace";
  return `local/${safe}`;
}

function summarizeHookEvent(payload, hookEvent) {
  const p = payload || {};
  if (p.prompt) return sanitizeText(`User prompt: ${p.prompt}`, 700);
  if (p.compact_summary) return sanitizeText(`Compacted context: ${p.compact_summary}`, 700);
  if (p.tool_name) return sanitizeText(`Tool used: ${p.tool_name}${p.tool_input?.command ? ` ${p.tool_input.command}` : ""}`, 700);
  return sanitizeText(String(hookEvent), 200);
}

function sanitizeToolInput(toolInput, config) {
  if (!toolInput || typeof toolInput !== "object") return sanitizeValue(toolInput);
  const out = { ...toolInput };
  if (out.command) out.command = sanitizeText(out.command, 2_000);
  if (out.content || out.text) {
    out.content = "[omitted]";
    out.text = "[omitted]";
  }
  if (out.diff) out.diff = sanitizeText(out.diff, Number(config.maxDiffBytes || 200_000));
  return sanitizeValue(out);
}

function tailTranscriptSummaries(transcriptPath, sessionExternalId, config) {
  const lines = tailNewTranscriptLines(transcriptPath, sessionExternalId, config);
  return lines.map((line, index) => {
    const parsed = safeJson(line);
    return {
      type: "transcript_summary",
      occurredAt: new Date().toISOString(),
      sequence: Date.now() + index + 1,
      summary: summarizeTranscriptLine(parsed || line),
      payload: sanitizeValue({
        kind: parsed?.type || parsed?.role || "transcript_line",
        summary: summarizeTranscriptLine(parsed || line),
      }),
    };
  });
}

function tailTranscriptEvents(transcriptPath, sessionExternalId, config) {
  const lines = tailNewTranscriptLines(transcriptPath, sessionExternalId, config);
  return lines.map((line, index) => {
    const parsed = safeJson(line);
    return {
      type: "transcript_event",
      occurredAt: new Date().toISOString(),
      sequence: Date.now() + index + 1,
      summary: summarizeTranscriptLine(parsed || line),
      payload: sanitizeValue(parsed || { line }),
    };
  });
}

function tailNewTranscriptLines(transcriptPath, sessionExternalId, config) {
  try {
    const stat = fs.statSync(transcriptPath);
    const state = readState(sessionExternalId);
    const key = hash(transcriptPath);
    const previousOffset = Math.min(Number(state.offsets?.[key] || 0), stat.size);
    const maxBytes = Number(config.maxTranscriptBytesPerHook || MAX_TRANSCRIPT_BYTES_PER_HOOK);
    const start = Math.max(previousOffset, stat.size - maxBytes);
    const fd = fs.openSync(transcriptPath, "r");
    const length = stat.size - start;
    const buffer = Buffer.alloc(Math.max(0, length));
    fs.readSync(fd, buffer, 0, length, start);
    fs.closeSync(fd);
    state.offsets = { ...(state.offsets || {}), [key]: stat.size };
    writeState(sessionExternalId, state);
    return buffer.toString("utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-MAX_EVENTS_PER_POST);
  } catch {
    return [];
  }
}

function summarizeTranscriptLine(value) {
  if (typeof value === "string") return sanitizeText(value, 700);
  const type = value.type || value.role || "event";
  const text = value.summary || value.text || value.content || value.message?.content || value.toolUseResult || value.tool_input?.command;
  return sanitizeText(`${type}: ${typeof text === "string" ? text : JSON.stringify(text || "")}`, 700);
}

async function maybeRunCommitCheck(input, credentials, context) {
  const command = String(input.tool_input?.command || "");
  if (!/\bgit\s+commit\b/.test(command)) return;

  const files = git(["diff", "--cached", "--name-only"], context.cwd).split(/\r?\n/).filter(Boolean).slice(0, 100);
  if (!files.length) return;
  const diffSummary = git(["diff", "--cached", "--stat"], context.cwd).split(/\r?\n/).slice(-80).join("\n");
  const body = await postJson(`${credentials.api}/developer-sessions/${encodeURIComponent(context.sessionExternalId)}/commit-check`, credentials.token, {
    sessionId: context.sessionExternalId,
    repo: context.repo,
    branch: context.branch,
    head: context.head,
    files,
    diffSummary,
  }).catch(() => null);
  const findings = Array.isArray(body?.findings) ? body.findings : [];
  if (!findings.length) return;

  const note = formatCommitNote(context.repo, findings, body.fixOffers || []);
  const top = topSeverity(findings);
  const output = top === "critical" || top === "high"
    ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: note } }
    : { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: note } };
  process.stdout.write(JSON.stringify(output));
}

function formatCommitNote(repo, findings, fixOffers) {
  const repoShort = String(repo || "this repo").replace(/\.git$/, "").split(/[/:]/).slice(-2).join("/");
  const lines = findings.slice(0, 4).map((f) => {
    const sev = String(f.severity || "info").toUpperCase();
    return `- [${sev}] ${sanitizeText(f.title, 180)}${f.detail ? `\n  ${sanitizeText(f.detail, 500)}` : ""}`;
  }).join("\n");
  const offerLine = fixOffers.length ? `\nFix offers available: ${fixOffers.map((o) => o.id).join(", ")}` : "";
  return `Libra checked this commit against ${repoShort}'s production history and flagged:\n${lines}${offerLine}\n\nAdvisory only. Commit can continue if you accept the risk.`;
}

function topSeverity(findings) {
  const severities = findings.map((f) => String(f.severity || ""));
  if (severities.includes("critical")) return "critical";
  if (severities.includes("high")) return "high";
  if (severities.includes("medium")) return "medium";
  return "low";
}

async function postJson(url, token, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function sanitizeValue(value, depth = 0) {
  if (depth > 5) return "[truncated-depth]";
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return sanitizeText(value);
  if (Array.isArray(value)) return value.slice(0, 30).map((v) => sanitizeValue(v, depth + 1));
  if (typeof value !== "object") return sanitizeText(String(value));
  const out = {};
  for (const [key, raw] of Object.entries(value).slice(0, 80)) {
    if (SECRET_KEY_RE.test(key)) {
      out[key] = "[REDACTED]";
    } else if (/^(content|transcript|stdout|stderr|output|fileContent|fullText)$/i.test(key)) {
      out[key] = sanitizeText(raw, 1_500);
    } else {
      out[key] = sanitizeValue(raw, depth + 1);
    }
  }
  return clampJson(out, 12_000);
}

function sanitizeText(input, maxBytes = 2_000) {
  let text = String(input ?? "");
  text = text.replace(/-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/gi, "[REDACTED_PRIVATE_KEY]");
  text = text.replace(/\blibra_exla-api-key-[A-Za-z0-9._-]+/g, "libra_exla-api-key-[REDACTED]");
  text = text.replace(/\bAKIA[0-9A-Z]{16}\b/g, "AWS_ACCESS_KEY_[REDACTED]");
  text = text.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, "Bearer [REDACTED]");
  text = text.replace(/\b(authorization|cookie|x-api-key|api[_-]?key|token|secret|password|passwd)\s*[:=]\s*([^\s,'"{}\\]+|"[^"]+"|'[^']+')/gi, "$1=[REDACTED]");
  text = text.replace(/(https?:\/\/[^:\s/@]+):([^@\s/]+)@/g, "$1:[REDACTED]@");
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  return Buffer.from(text, "utf8").subarray(0, maxBytes).toString("utf8") + "\n[truncated]";
}

function clampJson(value, maxBytes) {
  const json = JSON.stringify(value ?? null);
  if (Buffer.byteLength(json, "utf8") <= maxBytes) return value;
  return { truncated: true, preview: sanitizeText(json, maxBytes) };
}

function safeJson(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

function git(args, cwd) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2_000 }).trim();
  } catch {
    return "";
  }
}

function statePath(sessionExternalId) {
  return path.join(os.homedir(), ".config/libra/claude-code", `${hash(sessionExternalId)}.json`);
}

function readState(sessionExternalId) {
  try { return JSON.parse(fs.readFileSync(statePath(sessionExternalId), "utf8")); } catch { return {}; }
}

function writeState(sessionExternalId, state) {
  try {
    const file = statePath(sessionExternalId);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify(state), { mode: 0o600 });
  } catch {}
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 32);
}
