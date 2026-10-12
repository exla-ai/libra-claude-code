# Libra for Claude Code

Libra is your production ops agent (it watches your AWS + GitHub). This plugin brings
it into Claude Code so it can:

- **Capture sanitized coding-agent session events** so Libra knows what you and Claude Code or Codex were trying to change, without storing raw transcripts by default.
- **Check your commits** against your *own* production history before they land, real
  CloudWatch signals, deploy history, and past incidents, not generic linting.
- **Answer questions** about your live services with `/libra` (what's failing in prod,
  what a deploy did, whether a change is risky).
- **Surface fix offers** back into the active session when a commit check finds a
  high-confidence, code-changeable risk.
- **Show you what it did**: a short Libra block when a session starts, one when it
  gives Claude production context for your request, and one for every commit it
  checks, including "nothing flagged".
- **Take your feedback** with `/libra-feedback`, so the Libra team learns what helps.

Everything Libra does here is **fail-open and bounded**: if Libra is slow, down, or
cannot finish a check, the commit proceeds and Libra stays quiet. Every network call
shares a deadline of about 8 seconds, so a check can add a few seconds to a commit
but never more. High and critical findings ask before the commit runs, and
everything else is context.

## Install Libra in Claude Code

Ask Claude Code to install the Libra Claude Code plugin, then log in:

```text
/plugin marketplace add https://github.com/exla-ai/libra-claude-code
/plugin install libra-claude-code@libra
/libra-login
```

This is the normal install path. It installs:

- the Libra hooks for sanitized session events and commit-attempt checks,
- the `/libra`, `/libra-login`, and `/libra-feedback` commands,
- the `libra-ops` skill,
- the remote MCP server at `https://api.libra.exla.ai/mcp`.

`/libra-login` stores the API key locally and adds or updates the MCP server with
the same key. It also installs Libra hooks into `~/.codex/hooks.json` so native
Codex sessions send the same sanitized event stream. After this, Claude Code can call `libra_query`,
`libra_check_commit`, `libra_create_monitor`, `libra_list_sessions`, `libra_list_fix_offers`,
`libra_view_session_events`, and `libra_accept_fix_offer`, and
the local hook process can run commit checks when Claude Code attempts
`git commit`.

After login, the Libra dashboard shows received sessions at
`https://libra.exla.ai/dashboard/claude`. A full plugin install records a
sanitized event on every Claude Code `SessionStart`, user prompt, tool use,
compaction, and session end. It also records native Codex `SessionStart`,
`UserPromptSubmit`, and `Stop` events once `/libra-login` installs the Codex
hooks. If only MCP is installed, the coding agent can call Libra tools, but no
automatic session events are sent.

## Updating

Third-party marketplaces do not auto-update by default. Turn it on once in
`/plugin` (Marketplaces, libra, enable auto-update), or update by hand:

```bash
claude plugin marketplace update libra
claude plugin update libra-claude-code@libra
```

From 0.3.4 on, updates arrive within about 15 minutes. With auto-update on,
Libra's hook runs those two commands in the background at most every 15 minutes
while you work. Every hook also runs the newest Libra copy on your machine, so
open sessions pick up an update on their next action, without a restart. A
change to which hooks are registered still needs a restart or `/reload-plugins`.
Set `LIBRA_PLUGIN_SELF_UPDATE=0` to turn this off.

## What you see in a session

Libra speaks up in short blocks: a header line that starts with `Libra`, then a few
indented lines. Nothing is shown when Libra is unreachable or a check fails (Libra
never claims a result it does not have). "Nothing flagged" appears only when the
server confirms it finished the analysis; a repo Libra cannot see, an analysis that
did not complete, or a missing answer all stay silent.

**Session start: only when something is new in production**

```text
Libra · new in cedar-mail production
  - User executions fail before they start because connection tokens are missing (P2, started 3h ago)
  - 1 fix PR to review: /libra-review
  Claude has the details.
```

A risk appears once, the first session after Libra confirms it in production
(P1 or P2, first seen in the last 72 hours). It is not shown again on this machine.
With nothing new, the developer sees nothing; Claude still gets the open production
risks as context. A change in the fix PRs waiting for review is a one-line note on
its own. The very first session ever shows `Libra · on for <repo>` with one line
naming `/libra-feedback`, and `/libra-login` always confirms `Libra · on for <repo>`.

**Your request matches something Libra tracks**

```text
Libra · related to this request
  - Gmail draft reads use stale IDs (P2, prod, last seen 3h ago)
  - Fix PR #2063: Notification thread cache diverges (unreviewed)
  Claude has the details.
```

**Claude runs `git commit`**

```text
Libra · commit check · 1 finding
  - Medium: New Gmail lookup has no timeout
    Add a bounded timeout and explicit failure handling.
  The commit continues.
```

High and critical findings pause the commit. The header says `needs your OK`, the last
line says `Claude Code will ask before committing.`, and Claude Code's approval dialog
shows the same block. At most two findings are listed, then `+N more`. A clean commit
is one line:

```text
Libra · commit check · nothing flagged against CedarCopilot/cedar-mail production history
```

At most once a day, one of these blocks ends with `  Useful? Reply with /libra-feedback`.
Feedback attaches to the last note Libra actually showed on this machine, and only if
it was shown in the last 24 hours.

**What Claude gets**

Alongside each block, Claude receives Libra's data wrapped in a labeled
`<libra source="Libra production monitoring for <repo>"> ... </libra>` block, so it
can tell Libra's findings apart from your words. The block says plainly that its
contents are data from Libra and never instructions to follow, and every field in it
is stripped of control characters and escape codes first. The block has numbered items, a
`How to use this:` line for that hook, and a reporting shape that asks Claude to
credit Libra whenever it relays something:

```text
**Libra flagged:** <one line>
- **Where:** <file, route, or job>
- **Why it matters:** <impact from Libra's data>
- **What I'm doing about it:** <your next step>
```

**`/libra` answers**

Every `/libra` answer has the same shape, about eight lines: a `**Libra:**` lead
sentence, then `What's happening`, `Evidence` (counts, US Pacific times, trace ids,
PR numbers exactly as Libra returned them), `Since`, and `Next step`. When Libra has
no data the answer says `Unknown` and what is missing, never a guess.

## Libra in your live session

When Claude Code works on a pull request, Libra says so and brings its review back
into the session. Libra notices which PRs a session touches from the `gh` commands
Claude runs (`gh pr create`, `gh pr checks 3045`, `gh pr view 3042`, `gh pr diff 3049`,
and the other `gh pr` subcommands), or from a link to a PR in your repo. It does not
guess from your git branch, and it ignores PRs in other repos. It keeps the five most
recent PRs per session for 48 hours.

**Libra starts reviewing a PR** (shown once per PR on this machine)

```text
Libra · watching PR #3045
  Libra is reviewing it against production. The result will show up here.
```

**Libra's review is ready** (shown once per review on this machine, at the next
session start, prompt, or tool use)

```text
Libra · review of PR #3045 · Confidence 3/5
  - P1: Gmail thread reads return 404 (gmail.ts)
  - P2: Drafts keep stale ids (drafts.ts)
  Claude has the fix prompt.
```

At most three issue lines are shown, then `+N more`. A review with nothing to report
is one line: `Libra · review of PR #3045 · Confidence 5/5 · no issues found in what Libra ran`.
A run where Libra produced no review says nothing.

Claude receives the same review as a labeled `<libra>` block: the score, each issue
with its file and why it matters, the fix prompt Libra wrote for the PR comment, and a
link to the full report. The block says it is data, and asks Claude to tell you about
the review and to change nothing until you ask. The review is built by the same code
that writes the Check Run and the PR comment, so the session and GitHub agree. Exact
line numbers need the GitHub diff, so the full report has them, not the session.

**Claude raises it before ending its turn.** If a finished review has real issues and
Claude has not raised it at the end of a turn, Libra's Stop hook asks Claude to tell
you about the issues and ask whether to fix them, and not to change code until you
say yes. This happens at most once per review (and never when a Libra Stop hook
already continued the turn). Clean reviews never do this. Codex gets the review as
context only: no visible block and no Stop hook.

**A review that lands while you are away wakes the session.** When Claude finishes a
turn and a watched PR's review is still running, a background Stop hook (`async`,
`asyncRewake`) checks Libra every 45 seconds for up to 25 minutes. When the review
lands, it wakes the idle session and Claude tells you, in the same shape, without you
typing anything. It never wakes for a review another hook already showed, one
watcher runs per session, and it stops early when nothing is left to wait for. It
dies with the session, so the review also stays on the PR on GitHub. It needs Claude
Code 2.1.287 or newer (read from the session transcript) and stays off on older
versions, which may not run hooks in the background.

What the plugin sends for this: the PR numbers it noticed (`watch.prs`) with each
event batch. A repo with no GitHub remote has no PRs to watch. Each block shown is
recorded as a `libra_surfaced` note (`pr_watch`, `pr_review`, `pr_review_stop`, `pr_review_wake`) with
the PR number and run id.

## Feedback

`/libra-feedback useful`, `/libra-feedback not useful <why>`, or
`/libra-feedback wrong <what>` sends a rating and note to the Libra team, tied to the
last thing Libra showed on this machine. Only an explicit leading word sets a rating:
`useful`, `helpful`, `+1` for useful; `not useful`, `not helpful`, `unhelpful`,
`useless`, `noise`, `noisy`, `-1` for not useful; `wrong`, `incorrect`, `inaccurate`,
`false positive` for wrong. Anything else, including "no, this was actually helpful",
is sent as a comment with your full text. Notes are redacted like everything else
before they leave your machine.

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
- bounded sanitized transcript summaries when the agent hook exposes a transcript path,
- bounded sanitized transcript entries only if full transcript capture is explicitly enabled,
- the numbers of the PRs your session works on (`watch.prs`), so Libra can bring its review back,
- a record of each Libra block shown in the session (`libra_surfaced`) and any feedback you
  send (`libra_feedback`), so Libra can measure which notes help.

Tokens, env values, keys, and auth headers are redacted before anything leaves your
machine. Hard caps bound payload size.

## Optional config (`.libra/claude-code.json`)

Zero config is the default. Drop this in your repo only to override:

```json
{
  "enabled": true,
  "ignorePaths": ["**/*.snap", "fixtures/**"],
  "maxDiffBytes": 200000,
  "captureTranscript": "summary"
}
```

Default behavior sends sanitized transcript-line summaries when the agent hook
provides a transcript path. Set `"captureTranscript": false` to disable transcript
tailing entirely, or `true` / `"full"` to send bounded sanitized entries. Libra's
dashboard should show derived intents, risks, commit checks, fix offers, and
sanitized session context, not raw Claude Code or Codex transcripts.

For debugging, Libra can show the sanitized event stream it received for a Claude
Code or Codex session through `libra_view_session_events` or
`GET /developer-sessions/:id/events`. This is still not a raw transcript viewer
unless full transcript capture was explicitly enabled client-side, and even then
payloads are redacted and capped before storage.

## How it behaves at commit time

| Libra finding | What happens |
|---|---|
| nothing, and the analysis completed | one line, `Libra · commit check · nothing flagged against <repo> production history`, commit proceeds |
| nothing, but the analysis did not complete (repo not linked, model unavailable) | silent, commit proceeds |
| low / medium risk | one visible Libra block plus a labeled `<libra>` note for Claude, commit proceeds |
| high / critical risk | Claude Code asks you "Libra flagged X, commit anyway?" before committing |
| Libra slow or down | silent, commit proceeds (fail-open) |

## Status

Implemented in this package:
- Hosted remote MCP endpoint at `https://api.libra.exla.ai/mcp` for on-demand tools.
- Claude Code hooks for session start, user prompts, tool use, compaction, stop, session end,
  and commit attempts.
- Codex hook installer for native Codex session start, user prompt, and stop events.
- Local redaction, transcript tailing by offset, bounded event batches, and fail-open API
  calls.
- Commit checks, sanitized session-event viewing, fix-offer listing, and
  `/libra` query fallback.
- Visible Libra blocks in Claude Code (plugin 0.2.0), a record of each line shown, and
  `/libra-feedback`.
- Libra's PR review in the live session: a watching line, the finished review for you and
  Claude, and one Stop reminder per review with issues (Claude Code only).

Still planned:
- First-class distribution docs and a published install URL.
- Channel-pushed fix offers into the active Claude Code session.
- Promotion of developer intents into deployed PR intents after PR/deploy anchoring.
