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
- **Stay out of your way**: Libra hands Claude production context at the right
  moments, and Claude decides whether and how to mention it. The only Libra block
  you see directly is a commit check that needs your approval.
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
- the `/libra`, `/libra-login`, `/libra-feedback`, `/libra-review`, and `/libra-daily` commands,
- the `libra-ops` skill,
- the remote MCP server at `https://api.libra.exla.ai/mcp`.

`/libra-login` stores the API key locally and adds or updates the MCP server with
the same key. It also installs Libra's hooks for Codex (see
[Codex](#205-codex-gets-the-full-hook-set)), so native Codex sessions send the same
sanitized event stream and get the same context. After this, Claude Code can call `libra_query`,
`libra_check_commit`, `libra_create_monitor`, `libra_list_sessions`, `libra_list_fix_offers`,
`libra_view_session_events`, and `libra_accept_fix_offer`, and
the local hook process can run commit checks when Claude Code attempts
`git commit`.

After login, the Libra dashboard shows received sessions at
`https://libra.exla.ai/dashboard/claude`. A full plugin install records a
sanitized event on every Claude Code `SessionStart`, user prompt, tool use,
compaction, and session end. Codex sessions are recorded the same way once the
Codex hooks are installed and approved in Codex's `/hooks`. If only MCP is installed, the coding agent can call Libra tools, but no
automatic session events are sent.

## 2.0.1 delivery fixes

Deferred news waits for the actual end of a turn. Passive transcript bookkeeping
no longer keeps it held forever, while real continuation and unknown transcript
content still prevent delivery. Timing waits are recorded separately from failed
delivery. Empty local failure checks do not record a note that was never shown.

## 2.0.2 delivery fixes

An answer you asked for no longer waits for the turn to end. The server marks
a finished investigation `interrupt`, and the session monitor delivers it
mid-turn; other news is still held until the turn ends. Older plugins ignore the
field and show the answer at the next prompt or turn end. A PR review now
arrives at the next prompt or turn end instead of waiting for the session to
finish. A clean review is a one-line note for you, and a review with issues goes
to the agent.

## 2.0.3 daily coding report

Adds `/libra-daily`, which reads Libra's daily coding report for a repo, checks
the top items against your code and live evidence, shows what is real, records a
verdict for each item, and asks what to fix (see Daily coding report below). The
`/libra` command and the `libra-ops` skill name the report's three tools, which
Libra lists only once it has enabled the report for your account. No hook
changes.

## 2.0.4 Libra speaks through Claude

Libra's notes are now context for Claude, not blocks on your screen. Claude
decides whether and how to bring up a production risk, a matching finding, a
commit-check result, or a PR review, in its own words, and most of the time it
needs no mention. The `libra-ops` skill no longer asks Claude to announce Libra
with a fixed header; it asks Claude to fold Libra's evidence into its answer where
it bears on the work. The only block you still see is a commit check with a high
or critical finding, which asks for your approval. Most of this changed on Libra's
server, so it applies to every 2.0 plugin; 2.0.4 updates the skill. The
`/libra`, `/libra-review`, and `/libra-daily` commands keep their `**Libra:**`
lead, because you asked Libra directly.

2.0.4 also fixes `/libra-feedback` saying there was nothing to send when its input
arrived a moment late: its stdin was non-blocking, and a read before the input
arrived returned nothing. Every hook now waits up to three seconds for its input.

## 2.0.5 Codex gets the full hook set

Codex used to run three Libra hooks, and only when Codex had already approved
them. Codex approves a hook by its exact command and position, and its plugin
hooks lose that approval on every plugin update, so most Codex sessions sent
nothing. From 2.0.5:

- `/libra-login` (or `node install-codex-hooks.mjs` from this plugin) clones the
  plugin to `~/.config/libra/plugin` and adds one user-level hook per event Codex
  runs to `~/.codex/hooks.json`: `SessionStart`, `UserPromptSubmit`,
  `PreToolUse` (Bash), `PostToolUse`, `PostCompact`, `SubagentStart`, `Stop`, and
  `SessionEnd`. Your other hooks keep their place, and the file you had is kept as
  `hooks.json.before-libra`.
- Approve them once: open Codex, run `/hooks`, and approve the Libra hooks.
  Codex skips a hook until it is approved.
- The hooks update that clone themselves, at most every 15 minutes, and only to a
  release whose hook script parses. The commands never change, so the approval
  holds. `LIBRA_PLUGIN_SELF_UPDATE=0` turns this off.
- If the Libra plugin is also enabled inside Codex, its hooks step aside for the
  user-level ones. Turning it off in Codex's `/plugins` avoids the approval prompt
  it raises after each update.
- A Libra hook inside Codex is treated as Codex even when it was started with the
  Claude Code argument, so Codex never gets output meant for Claude Code's screen.

Check the install with `node ~/.config/libra/plugin/scripts/install-codex-hooks.mjs --status`,
which lists each Libra hook Codex found and whether it is approved. Remove it with
`--uninstall`. Codex still gets Libra's notes as context only: it shows nothing on
screen, and it has no session monitor or review watcher.

2.0.5 also gives the agent what Libra holds when it reads production itself.
Before a Bash command that reads production logs, metrics, queues, or the app
database (for example `aws logs`, `psql`, `kubectl logs`, or a PostHog API
call), the hook asks Libra once and hands the agent the open production risks
that share terms with the command, then the top of the list. It asks at most
once per session every 10 minutes and shows nothing on screen; the agent decides
whether any of it bears on the work.

## 2.0.6 Commit approvals and turn ends

- A commit check that needs your approval now always asks for it. When the same
  hook also gave Claude other context, such as a PR review, the approval prompt
  could be lost while the finding still showed. The hook now keeps the strictest
  decision and both pieces of context.
- The plugin can tell again when Claude has finished a turn. Claude Code writes
  bookkeeping records to the transcript after a turn ends (request records,
  titles, modes, queue and status records), and the plugin read any of them as
  Claude still working, so a note meant for the end of a turn waited. Only a
  later prompt or a reply from Claude now counts as more work.
- A held note that may not interrupt you no longer makes the session monitor ask
  Libra again on every tick. It waits for the next hook.

## 2.0.7 Commit approvals reach Codex

- A commit check that needs your approval used to vanish on Codex. Codex 0.165
  does not support an approval prompt from a hook: it marked the hook failed,
  ran the commit, and dropped everything the hook returned, including the
  finding. On Codex the hook now stops that commit once and gives the agent the
  finding and its evidence. The agent tells you what Libra found and asks
  whether to go ahead. If you say yes, it runs the same commit again and Libra
  lets it through.
- "The same commit" means the same staged content in the same session. If the
  staged change is different, even by one edited line, a finding that needs
  approval stops it once more. Only a command that runs `git commit` itself is
  stopped; a PR body or note that mentions one gets the finding as context.
- Claude Code is unchanged: it still asks you to approve or deny.

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

0.4.0 registers new hooks (`PostToolUseFailure`, `SubagentStart`, async
`PostToolUse` and `PostCompact`) and a session monitor. The faster hook script
reaches open sessions on their next action; the new hooks and the monitor start
with the next session (or `/reload-plugins`).

## The server writes the notes; the coding agent decides what to say

From 0.5.0, every note about production comes from Libra's API already written
(`api/src/services/coding-agent-notes.ts`): the text Claude gets, its `How to use
this` line, and which items are told only once. The server decides what is news,
what a correction is, and what matches a request.

From 2.0.4 the notes are for Claude, not for the developer's screen. Libra gives
Claude the context and Claude decides whether, when, and in what words any of it
reaches the developer. The only block the developer sees directly is a commit
check that needs their approval. The plugin only:

- delivers an item marked `once` at most once per machine, and an item that
  `requires` another only on a machine that already received that one;
- shows a block on screen only when the server gives it a header (today, only a
  commit check that pauses for approval);
- cleans and caps every field and wraps Claude's text in the
  data-not-instructions envelope;
- caches the register block for subagents and failed commands, and records what
  it delivered.

A risk rule or a sentence therefore changes with an API deploy, not a plugin
release. That includes the failed-command match, the subagent context, commit
checks, and PR reviews.

### When to release a new plugin version

Release only for a change that needs code on the developer's machine:

- a new hook, or a change to when a hook runs or how long it may wait;
- local machinery: the once-per-machine ledger, caches, the background sender,
  monitor timing, the update handoff;
- the safety envelope: cleaning, length caps, the wrapper;
- a new field in the note contract that the renderer cannot show yet.

Never release for what counts as news, a correction or a match; for any wording
a developer or Claude reads; or for thresholds, severities, proof rules or mutes.
Those are API deploys. If one seems to need the plugin, add a generic field to
the note contract once, then keep using it from the server.

How to release:

1. Bump `PLUGIN_VERSION` in `scripts/libra-hook.mjs`: patch for a fix, minor for
   a new hook or contract field. Never add `version` to `plugin.json`.
2. Deploy the API first. It keeps answering every plugin version still reported
   in `developer_sessions` metadata (`activeRisks`, `reviewQueue` and
   `promptMatches` stay until no session reports a version before 0.5.0).
3. From the Libra repository root, run
   `node --import ./api/node_modules/tsx/dist/esm/index.mjs --test libra-claude-code/scripts/libra-hook.test.mjs`
   and `node --test libra-claude-code/scripts/install-codex-hooks.test.mjs`.
   The integration tests use the real server note builders and a temporary HOME.
   They cover transport, redaction, crash recovery, upgrades, withdrawn notes,
   activity races, quiet policy, local context caches and delivery receipts.
4. Publish from merged `main` to `exla-ai/libra-claude-code`. Open sessions pick
   it up within about 15 minutes.
5. At most one release a day, unless it fixes something broken on a developer's
   machine. Batch the rest.

## Contract 2, plugin 2.0.0

The server writes every production note, PR review, commit finding, failure match
and subagent context block. Requests report `plugin.contract: 2`, the running and
launch versions, installed hook capabilities, monitor availability and local turn
state. Responses require `contract: 2`, `policy`, `evaluated` family keys and
`notes`. A missing or malformed contract produces no new output. Contract 2 never
reconstructs messages from legacy risk rows, review inbox contents or findings.

Each note declares `delivery.when`, `to`, `wake` and `ttlMs`. Timing policy is
bounded locally. Server quiet mode silences every delivery surface, including
cached local context. User-triggered hooks can show notes or provide context;
background monitor and watcher output requires explicit wake permission and a
final local check that no new turn or tool continuation has started. A Stop
continuation never blocks again while `stop_hook_active` is true.

Held state contains IDs, family keys and deadlines, with no note text. Before
release, the client asks the server again and renders its current answer.
A successful response withdraws absent IDs only for families it explicitly
evaluated. Failed requests and malformed families preserve held IDs until expiry.
Old held files are replaced with IDs before their contents can be used.
Failure and subagent caches use separate bounded, expiring server blocks.

Once-only claims are scoped to the machine or session. They are acquired before
output and rolled back if the final activity check cancels delivery. After an
output write succeeds, `libra_surfaced` records the channel, family, IDs and timing;
held or dropped items use `libra_delivery`. Context delivered to the coding agent
is recorded separately from text directly displayed to the developer. Pending
receipts survive failed requests and process exits, with a 50-file bound.

Old launch arguments still work. An installed old hook can hand off to the newest
installed version while reporting its original hook wiring. The API must be
updated before publishing the plugin. An open window whose old installation has
been removed by Claude Code needs a restart to restore its hooks.

## Investigations run on Libra's server

From 0.6.0, a question that needs digging ("is it still happening", "who is
affected", "did this deploy cause it") goes to `libra_investigate`. It returns an
id at once, so the session keeps working; Libra investigates on its own server
with its read tools, and the answer arrives in the session as a Libra note. While
an investigation is pending the monitor checks every minute instead of every ten.
`/libra`, the `libra-ops` skill and every Libra note steer Claude to it rather than
chaining Libra reads in the developer's thread. `libra_investigation <id>` fetches
an answer directly.

From 0.6.1 nobody has to call it: when the developer's own prompt is a production
question, Libra starts the investigation from the prompt hook and the plugin polls
for the answer the same way. A request that turns out not to be about production
is dropped without a note.

## Speed: only answering hooks wait

Only the hooks whose answer depends on Libra wait for the network: session start,
your prompt, a `git commit`, and Stop. Every other hook (each tool call, a
compaction, a subagent starting, the end of a session) writes its event to a local
spool in about 50 ms and returns. One detached sender per session posts the spool
in batches a moment later, and answering hooks carry whatever is spooled. Before
0.4.0 every tool call waited on a request whose answer nobody read, about half a
second each, twice per Bash command. `PostToolUse` and `PostCompact` are also
`async` in `hooks.json`, so Claude Code does not wait for them at all.

The sender outlives the hook, so the end of a session is no longer lost to Claude
Code's 1.5-second `SessionEnd` budget. A failed send keeps every event on disk for
the next one. `LIBRA_HOOK_FLUSH=inline` sends inside the hook instead.

## What Libra gives Claude in a session

Libra works through Claude. At each hook it hands Claude a short labeled block of
production context, and Claude decides whether and how to bring it up. Most of the
time the developer sees nothing from Libra directly; Claude mentions what bears on
the work in its own words. Nothing is sent when Libra is unreachable or a check
fails (Libra never claims a result it does not have), and a commit is called
checked only when the server confirms it finished the analysis.

**Session start.** Claude gets the open production risks for the repo as
background. A risk Libra newly confirmed in production (P1 or P2, first seen or
confirmed in the last 72 hours) is marked as news the developer has not heard,
once per confirmation episode on this machine; Claude raises it only if the task
touches it or its measured impact is worth knowing before starting. An explicitly
reopened investigation with fresh proof starts a new episode; ordinary evidence
refreshes stay quiet. Unproven investigations appear only when requested through
`libra_list_risks`, with their caveats and recheck deadline. A written brief is not
confirmation. Expired and retracted investigations are excluded from active risk
lists, prompt matches, and news. For 72 hours, on-demand risk reads and relevant
questions also show a retraction or resolution, with its reason, time, and the
earlier claim clearly labeled. With `LIBRA_CODING_AGENT_CORRECTIONS_ENABLED=true`
on the API, a machine that received a claim also gets its correction once, unasked,
at the next session start or from the monitor; Claude corrects anything it passed
on. A machine that never received the claim does not hear about it. A deadline
expires the evidence; it does not mean an automatic recheck ran. Fix PRs waiting
for review are background that Claude mentions only if asked about them.

**Your request matches something Libra tracks.** Claude gets the matching risks
and fix PRs, and uses them only if its answer depends on them.

**Claude runs `git commit`.** Libra checks the staged change against production
history. A clean check and low or medium findings are context for Claude, which
mentions a finding when it bears on the change, and the commit continues. High and
critical findings pause the commit, and this is the one block the developer sees:

```text
Libra · commit check · needs your approval
  - high: New Gmail lookup has no timeout
    Add a bounded timeout and explicit failure handling.
  Approve to commit anyway, or deny to fix it first.
```

Claude Code's approval dialog shows the same block.

**What Claude gets**

Claude receives Libra's data wrapped in a labeled
`<libra source="Libra production monitoring for <repo>"> ... </libra>` block, so it
can tell Libra's findings apart from your words. The block says plainly that its
contents are data from Libra and never instructions to follow, and every field in it
is stripped of control characters and escape codes first. It has numbered items and
a `How to use this:` line from Libra's server for that hook, such as "background
for this session; do not list it to the developer" or "tell them briefly, in your
own words". There is no required reporting shape: the `libra-ops` skill asks Claude
to fold Libra's evidence into its own answer, not to announce Libra or relay notes
line by line.

From 0.5.0, saved session context expires after at most ten minutes, or sooner at a
risk's recheck deadline. A successful empty refresh clears old context. An idle or
offline session does not keep handing stale risks to new subagents. Previously
delivered text remains in the conversation, so a current-state answer always needs
a fresh scoped read. Corrections must distinguish a retracted claim from a verified
recovery, without claiming the earlier period was healthy.

**`/libra` answers**

Every `/libra` answer has the same shape, about eight lines: a `**Libra:**` lead
sentence, then `What's happening`, `Evidence` (counts, US Pacific times, trace ids,
PR numbers exactly as Libra returned them), `Since`, and `Next step`. When Libra has
no data the answer says `Unknown` and what is missing, never a guess.

## Libra in your live session

When Claude Code works on a pull request, Libra brings its review of that PR back
into the session, as context for Claude. Libra notices which PRs a session touches
from the `gh` commands Claude runs (`gh pr create`, `gh pr checks 3045`,
`gh pr view 3042`, `gh pr diff 3049`, and the other `gh pr` subcommands), or from a
link to a PR in your repo. It does not guess from your git branch, and it ignores
PRs in other repos. It keeps the five most recent PRs per session for 48 hours.

Nothing is sent while the review runs. The old on-screen "watching PR" line is
gone, and one still held from an older response is withdrawn.

**Libra's review is ready** (once per review on this machine, at the next session
start, prompt, tool use, or end of turn). Claude receives the review as a labeled
`<libra>` block: the score, each issue with its file and why it matters, the fix
prompt Libra wrote for the PR comment, and a link to the full report. The block
says it is data and asks Claude to tell you briefly, in its own words, keeping the
review's confidence and limits, to ask whether you want the issues fixed, and to
change nothing until you say yes. The review is built by the same code that writes
the Check Run and the PR comment, so the session and GitHub agree. Exact line
numbers need the GitHub diff, so the full report has them, not the session. A
review with no issues is background: Claude mentions it only if you ask about the
PR's review or checks. One that finishes during a turn reaches Claude with your next
prompt or commit, never at a turn end, because context at a turn end makes Claude
take another turn. A run where Libra produced no review sends nothing.

**Claude raises it before ending its turn.** If a finished review has real issues
and has not reached Claude by the end of a turn, Libra's Stop hook hands it to
Claude then, at most once per review (and never when a Libra Stop hook already
continued the turn). Clean reviews never do this. Codex gets the review as context
only, with no Stop hook.

**A review that lands while you are away wakes the session.** When Claude finishes a
turn and a watched PR's review is still running, a background Stop hook (`async`,
`asyncRewake`) checks Libra every 45 seconds for up to 25 minutes. When a review
with issues lands, it wakes the idle session and Claude tells you, without you
typing anything. It never wakes for a review already delivered, a clean review, or
one you asked for explicitly, one watcher runs per session, and it stops early when
nothing is left to wait for. It dies with the session, so the review also stays on
the PR on GitHub. It needs Claude Code 2.1.287 or newer (read from the session
transcript) and stays off on older versions, which may not run hooks in the
background.

**The session monitor** (`monitors/monitors.json`, interactive sessions only) checks
Libra once a minute. While the session watches a PR it checks for the finished
review, so the Stop watcher above stands down while the monitor runs. While you are
active (a prompt in the last two hours) it also asks, at most every ten minutes, for
production problems that became news. It never interrupts mid-task: it holds them
until you are done (Claude finished a turn that committed, pushed, or opened a PR,
or Claude finished and you have not typed for 10 minutes), then gives Claude each
one once on this machine, as what was observed and its measured impact, for Claude
to pass on in its own words. A window left open for days makes no requests. Each
tick is a fresh process, so it always runs the newest installed copy, and it ends
when Claude Code exits.

What the plugin sends for this: the PR numbers it noticed (`watch.prs`) with each
event batch. A repo with no GitHub remote has no PRs to watch. Each delivery is
recorded as a `libra_surfaced` note (`pr_review` or `monitor_news`, with the
channel and delivery point that carried it) with the PR number and run id, and with
`shownToUser: false` unless the block was on screen.

## Subagents and failing commands (Claude only)

**Subagents start with the production picture.** A subagent begins with none of the
session's context. `SubagentStart` gives it the same open production risks the session
got at start, read from a local copy, so it costs no request. Claude Code's own
helpers (status line setup, the docs guide) get nothing.

**A failing command that matches a production error.** Session start also returns the
specific production error messages Libra has seen for the repo in the last 14 days
(generic ones such as `read econnreset` or a bare 404 are left out). When a tool call
fails, `PostToolUseFailure` matches its output against them on your machine, with no
request: ids and numbers are compared the way Libra groups production errors. A match
tells Claude that this local failure is an error production users also hit, with how
often and how recently, once per production error per session. You see nothing
directly; Claude decides whether to mention it. Both are recorded as `libra_surfaced`
notes (`subagent_context`, `failure_match`) with `shownToUser: false`.

## Daily coding report

Libra's daily coding report is everything Libra noticed in one repository's
production over a window (the last 24 hours by default, up to 14 days), written
as markdown for your coding agent rather than for you. It shows what Libra told
your team about, what it held back and why, and which items no model ever
examined, and it labels Libra's own judgment as judgment. Items name the Libra
calls that verify them. Libra builds the report from what it already stored,
without calling a model. It stays off until Libra enables it for your account:
until then its tools are not listed and its routes return errors (see Plain
HTTP below).

**Claude Code.** Run `/libra-daily` in the repository, or
`/libra-daily owner/repo`, or `/libra-daily 72h` to cover a weekend. Claude
reads the report, checks the top items against your code and live evidence,
shows a table of what is real (anything that came back after a fix first),
records a verdict for each item, and asks which ones to fix. It changes code
only for the items you pick and opens a pull request only when you ask.

**Codex.** Codex reads the same three tools (`libra_coding_report`,
`libra_feed`, `libra_record_triage`) through Libra's remote MCP server. Codex
sends the key from an environment variable and stores only the variable's name,
so put the export in the shell profile Codex starts from, then register the
server once. `YOUR_LIBRA_API_KEY` is the same key `/libra-login` asks for.

```bash
export LIBRA_API_TOKEN=YOUR_LIBRA_API_KEY
codex mcp add libra --url https://api.libra.exla.ai/mcp --bearer-token-env-var LIBRA_API_TOKEN
```

The same server written directly in `~/.codex/config.toml`:

```toml
[mcp_servers.libra]
url = "https://api.libra.exla.ai/mcp"
bearer_token_env_var = "LIBRA_API_TOKEN"
```

`codex mcp list` shows the server. If you also use this plugin, keep one key:
its hooks read `LIBRA_API_TOKEN` before the key `/libra-login` stored. In a new
Codex session, ask for "Libra's coding report for this repo; verify the top
items and tell me what is real". For the full `/libra-daily` steps, save this
plugin's `commands/libra-daily.md` as `~/.agents/skills/libra-daily/SKILL.md`
(or `.agents/skills/libra-daily/SKILL.md` in the repository) and run
`$libra-daily`. Where the skill mentions `/libra-login`, the Codex setup above
applies instead.

**Plain HTTP.** Without MCP, read the report with curl:

```bash
curl -sS -H "Authorization: Bearer $LIBRA_API_TOKEN" \
  "https://api.libra.exla.ai/developer-sessions/coding-report?repo=OWNER/REPO&sinceHours=24"
```

Add `&format=json` for JSON. `GET /developer-sessions/feed` returns the same
items as JSON pages (pass `nextCursor` back as `cursor`), and `ids=ID1,ID2` (up
to 20) returns full detail for those items. Record verdicts with
`POST /developer-sessions/triage`:

```bash
curl -sS -H "Authorization: Bearer $LIBRA_API_TOKEN" -H 'content-type: application/json' \
  -d '{"repo":"OWNER/REPO","items":[{"id":"ITEM_ID","verdict":"real","note":"one line why"}]}' \
  https://api.libra.exla.ai/developer-sessions/triage
```

A 404 `not_found` means the report is not enabled for your account, 403
`feed_not_enabled` means it is not enabled for that repo, and 404
`repo_not_found` means your key cannot see that repo. Each user gets 60 report
and feed reads and 60 verdict requests every 10 minutes; past that, Libra
answers 429 `rate_limited` with a `Retry-After` header, and over MCP the tool
returns `rate_limited`. Paging usually stays stable while you walk: for 10
minutes, later pages come from the items the first page read, so items that
arrive mid-walk show up on the next first page instead of shifting the pages
you are on. Later pages read the tables again, and can shift, when that first
read is gone: after 10 minutes, when Libra is serving more than 8 walks at once,
after a restart or deploy, or when the first page was built while a source was
failing. Verdicts are always read fresh, so recording triage mid-walk can move
an item across a page boundary: it may show twice, or not until your next walk.

**Verdicts hide what is settled.** Each item gets one verdict: `real`,
`not_real`, `expected`, `needs_info`, `duplicate` (naming the item it
duplicates), `fixing` (with the PR number), or `fixed` (once the fix is
deployed). The next report hides items marked `not_real`, `expected`,
`duplicate`, or `fixed`, listing up to 10 of them under Settled earlier, moves
`real` and `fixing` items to Tracking, and keeps `needs_info` items in Needs
triage. A hidden item comes back on its own: a `fixed` item seen again after the
verdict lands under Came back after a fix, and a dismissed item returns to Needs
triage when it gets more severe or Libra alerts your team about it after the
verdict. Verdicts are per repository and shared by everyone on your team. Only
verdicts you confirmed change how Libra scores its own detectors, so the agent
records its own verdicts as unconfirmed and re-records the ones you agree with.

## Feedback

`/libra-feedback useful`, `/libra-feedback not useful <why>`, or
`/libra-feedback wrong <what>` sends a rating and note to the Libra team, tied to the
last note Libra gave you or Claude on this machine in the last 24 hours (never a
subagent's context or a note re-sent after compaction). Most of Libra reaches you
through Claude's own words, so that note is the best guess at what you are rating;
with none, the rating goes in as feedback on the session. Only an explicit leading word sets a rating:
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
- the error text of a failed tool call (capped at 4,000 characters), and the type of a subagent that starts,
- a record of each Libra note delivered in the session, shown to you or handed to Claude
  (`libra_surfaced`), and any feedback you send (`libra_feedback`), so Libra can measure
  which notes help.

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
| nothing, and the analysis completed | nothing on screen; Claude is told the change was checked, commit proceeds |
| nothing, but the analysis did not complete (repo not linked, model unavailable) | silent, commit proceeds |
| low / medium risk | a labeled `<libra>` note for Claude, which mentions a finding that bears on the change; commit proceeds |
| high / critical risk | a visible `Libra · commit check · needs your approval` block, and Claude Code asks before committing |
| Libra slow or down | silent, commit proceeds (fail-open) |

## Status

Implemented in this package:
- Hosted remote MCP endpoint at `https://api.libra.exla.ai/mcp` for on-demand tools.
- Claude Code hooks for session start, user prompts, tool use, compaction, stop, session end,
  and commit attempts.
- Codex hooks (plugin 2.0.5): every event Codex runs, from a self-updating clone that Codex approves once.
- Local redaction, transcript tailing by offset, bounded event batches, and fail-open API
  calls.
- Commit checks, sanitized session-event viewing, fix-offer listing, and
  `/libra` query fallback.
- Libra context for Claude to pass on in its own words (plugin 2.0.4), a visible block only
  for a high or critical commit check, a record of each note delivered, and `/libra-feedback`.
- Libra's PR review in the live session: the finished review as context for Claude, and one
  Stop reminder per review with issues (Claude Code only).
- `/libra-daily` (plugin 2.0.3) for Libra's daily coding report, with verdicts recorded back
  to Libra; Codex reads the same report through the remote MCP server.

Still planned:
- First-class distribution docs and a published install URL.
- Channel-pushed fix offers into the active Claude Code session.
- Promotion of developer intents into deployed PR intents after PR/deploy anchoring.
