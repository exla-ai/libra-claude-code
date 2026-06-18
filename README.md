# Libra for Claude Code

Libra is your production ops agent (it watches your AWS + GitHub). This plugin brings
it into Claude Code so it can:

- **Check your commits** against your *own* production history before they land, real
  CloudWatch signals, deploy history, and past incidents, not generic linting.
- **Answer questions** about your live services with `/libra` (what's failing in prod,
  what a deploy did, whether a change is risky).

Everything Libra does here is **advisory and fail-open**: it never blocks or slows your
commits, and it always identifies itself as **⚖️ Libra** so you know the analysis is
coming from your ops agent, not from generic Claude.

## Setup (one time)

```
/plugin marketplace add exla/libra-claude-code
/plugin install libra-claude-code@libra
/libra login
```

Approve the trust prompt once. That's it, no config files, no tokens to paste. From
then on Libra checks every `git commit` you make in Claude Code and you can `/libra` it
anything.

## What gets sent

Only what Libra needs to reason, never raw secrets or full file contents:
- the staged file names and a diffstat summary,
- the repo, branch, and HEAD,
- (optionally) a sanitized summary of what you were working on this session.

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

## How it behaves at commit time

| Libra finding | What happens |
|---|---|
| nothing | silent, commit proceeds |
| low / medium risk | Libra surfaces a `⚖️ Libra` note in your session, commit proceeds |
| high / critical risk | Claude Code asks you "Libra flagged X, commit anyway?" before committing |
| Libra slow or down | commit proceeds (fail-open) |

## Status

Phase 1 (this scaffold): commit-time risk check + `/libra`.
Phase 2: MCP server (OAuth) so `/libra` is native and auth is handled for you.
Phase 3: fix offers Libra can apply in-session (with your approval), and session-intent
capture that flows into post-deploy verification.
