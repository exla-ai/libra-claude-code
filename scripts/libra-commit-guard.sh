#!/usr/bin/env bash
# Libra commit guard.
#
# Runs on every Bash tool call (matcher: Bash) but acts ONLY on `git commit`.
# It sends the staged change to Libra, which checks it against YOUR production
# history (real CloudWatch signals, deploy history, past incidents) and returns
# advisory findings. Output is branded clearly as Libra.
#
# Design rules:
#   - ADVISORY by default: low/medium findings are injected as context; the commit
#     proceeds. Only high/critical soft-gates (Claude Code asks before committing).
#   - FAIL-OPEN: any missing config, error, or timeout lets the commit proceed.
#     Libra must never wedge a developer's commit.
#   - No raw secrets leave the machine: only file names + a diffstat summary are
#     sent, never full file contents (the server does the deeper analysis).

INPUT="$(cat)"
have() { command -v "$1" >/dev/null 2>&1; }
have jq || exit 0   # no jq -> fail open, stay silent

CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null || echo "")"
case "$CMD" in
  *"git commit"*) : ;;          # a commit: check it
  *) exit 0 ;;                    # anything else: pass through, milliseconds
esac

LIBRA_API="${LIBRA_API_URL:-https://api.libra.exla.ai}"
# Account-scoped Libra API key (libra_exla-api-key-...). Env wins; otherwise read
# what `/libra login` stored. No key = not logged in = stay silent (fail open).
TOKEN="${LIBRA_API_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -f "$HOME/.config/libra/credentials.json" ]; then
  TOKEN="$(jq -r '.token // empty' "$HOME/.config/libra/credentials.json" 2>/dev/null || echo "")"
fi
[ -z "$TOKEN" ] && exit 0
CWD="$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || echo "")"
[ -n "$CWD" ] && cd "$CWD" 2>/dev/null || true

REMOTE="$(git remote get-url origin 2>/dev/null || echo "")"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"
HEAD_SHA="$(git rev-parse HEAD 2>/dev/null || echo "")"
FILES="$(git diff --cached --name-only 2>/dev/null | head -100 || echo "")"
DIFFSTAT="$(git diff --cached --stat 2>/dev/null | tail -80 || echo "")"
[ -z "$FILES" ] && exit 0        # nothing staged, nothing to check

PAYLOAD="$(jq -n \
  --arg repo "$REMOTE" --arg branch "$BRANCH" --arg head "$HEAD_SHA" \
  --arg files "$FILES" --arg diffstat "$DIFFSTAT" \
  '{repo:$repo, branch:$branch, head:$head, files:($files|split("\n")|map(select(length>0))), diffSummary:$diffstat}' 2>/dev/null || echo "")"
[ -z "$PAYLOAD" ] && exit 0

RESP="$(curl -sS --max-time 8 -X POST "$LIBRA_API/developer-sessions/commit-check" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data "$PAYLOAD" 2>/dev/null || echo "")"
[ -z "$RESP" ] && exit 0          # Libra slow/down -> fail open

COUNT="$(printf '%s' "$RESP" | jq -r '(.findings // []) | length' 2>/dev/null || echo "0")"
[ "$COUNT" = "0" ] && exit 0      # all clear -> stay silent

REPO_SHORT="${REMOTE##*/}"; REPO_SHORT="${REPO_SHORT%.git}"
SUMMARY="$(printf '%s' "$RESP" | jq -r '.findings[] | "- [" + ((.severity // "info")|ascii_upcase) + "] " + .title + (if (.detail // "") != "" then "\n  " + .detail else "" end)' 2>/dev/null || echo "")"
TOP_SEV="$(printf '%s' "$RESP" | jq -r '[.findings[].severity] | if (index("critical")) then "critical" elif (index("high")) then "high" else "low" end' 2>/dev/null || echo "low")"

NOTE="⚖️ Libra checked this commit against ${REPO_SHORT:-this repo}'s production history and flagged:
${SUMMARY}

(This is Libra, advisory only, grounded in your live prod signals, deploy history, and past incidents.)"

if [ "$TOP_SEV" = "critical" ] || [ "$TOP_SEV" = "high" ]; then
  # Soft-gate: surface to the user and ask before the commit runs.
  jq -n --arg r "$NOTE" '{hookSpecificOutput:{hookEventName:"PreToolUse", permissionDecision:"ask", permissionDecisionReason:$r}}' 2>/dev/null || true
  exit 0
fi
# Advisory: inject so Claude surfaces it; the commit proceeds.
jq -n --arg r "$NOTE" '{hookSpecificOutput:{hookEventName:"PreToolUse", additionalContext:$r}}' 2>/dev/null || true
exit 0
