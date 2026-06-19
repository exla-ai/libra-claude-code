# Libra for Claude Code

Libra is your production ops agent (it watches your AWS + GitHub). This plugin brings
it into Claude Code so it can:

- **Capture sanitized session events** so Libra knows what you and Claude Code were trying to change, without storing raw transcripts by default.
- **Check your commits** against your *own* production history before they land, real
  CloudWatch signals, deploy history, and past incidents, not generic linting.
- **Answer questions** about your live services with `/libra` (what's failing in prod,
  what a deploy did, whether a change is risky).
- **Surface fix offers** back into the active session when a commit check finds a
  high-confidence, code-changeable risk.

Everything Libra does here is **advisory and fail-open**: it never blocks or slows your
commits. High-risk findings ask before the commit runs, and everything else is context.

## Install Libra in Claude Code

Ask Claude Code to install the Libra Claude Code plugin, then log in:

```text
/plugin marketplace add https://github.com/exla-ai/libra-claude-code
/plugin install libra-claude-code@libra
/libra-login
```

This is the normal install path. It installs:

- the Libra hooks for sanitized session events and commit-attempt checks,
- the `/libra` and `/libra-login` commands,
- the `/libra` skill,
- the remote MCP server at `https://api.libra.exla.ai/mcp`.

`/libra-login` stores the API key locally and adds or updates the MCP server with
the same key. After this, Claude Code can call `libra_query`,
`libra_check_commit`, `libra_list_fix_offers`, and `libra_accept_fix_offer`, and
the local hook process can run commit checks when Claude Code attempts
`git commit`.

## Tool-only fallback: remote MCP

Use this only in environments where plugins or hooks are not available:

```bash
claude mcp add --transport http libra https://api.libra.exla.ai/mcp \
  -H "Authorization: Bearer <key>"
```

MCP-only gives Claude Code on-demand Libra tools, but it does not install local
hooks. If you want commit-time checks and sanitized session-event capture, use the
plugin install above.

## What gets sent

Only what Libra needs to reason, never raw secrets or full file contents:
- the staged file names and a diffstat summary,
- the repo, branch, and HEAD,
- sanitized hook metadata, user-prompt summaries, tool names, and command summaries,
- optionally, bounded sanitized transcript summaries or entries only if `captureTranscript` is enabled.

Tokens, env values, keys, and auth headers are redacted before anything leaves your
machine. Hard caps bound payload size.

## Optional config (`.libra/claude-code.json`)

Zero config is the default. Drop this in your repo only to override:

```json
{
  "enabled": true,
  "ignorePaths": ["**/*.snap", "fixtures/**"],
  "maxDiffBytes": 200000,
  "captureTranscript": false
}
```

Default behavior does not read the transcript file. Set `"captureTranscript": "summary"`
to send sanitized transcript-line summaries, or `true` to send bounded sanitized entries.
Libra's dashboard should show derived intents, risks, commit checks, and fix offers, not
raw Claude Code transcripts.

## How it behaves at commit time

| Libra finding | What happens |
|---|---|
| nothing | silent, commit proceeds |
| low / medium risk | Libra surfaces an advisory note in your session, commit proceeds |
| high / critical risk | Claude Code asks you "Libra flagged X, commit anyway?" before committing |
| Libra slow or down | commit proceeds (fail-open) |

## Status

Implemented in this package:
- Hosted remote MCP endpoint at `https://api.libra.exla.ai/mcp` for on-demand tools.
- Claude Code hooks for session start, user prompts, tool use, compaction, session end,
  and commit attempts.
- Local redaction, transcript tailing by offset, bounded event batches, and fail-open API
  calls.
- Advisory commit checks, fix-offer listing, and `/libra` query fallback.

Still planned:
- First-class distribution docs and a published install URL.
- Channel-pushed fix offers into the active Claude Code session.
- Promotion of developer intents into deployed PR intents after PR/deploy anchoring.
