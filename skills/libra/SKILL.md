# Libra

Use this skill when the user asks Claude Code to consult Libra, check current production risk, inspect session fix offers, or evaluate a commit against production history.

Libra is the user's production ops system for their AWS and GitHub. Answers must be grounded in Libra data, not model memory.

## Workflow

1. Prefer MCP tools when connected:
   - `libra_query`
   - `libra_check_commit`
   - `libra_create_monitor`
   - `libra_list_sessions`
   - `libra_list_fix_offers`
   - `libra_view_session_events`
   - `libra_accept_fix_offer`
   - `libra_list_fix_prs` (open Libra fix PRs awaiting review, with verification evidence)
   - `libra_pr_evidence` (full evidence for one fix PR)
   - `libra_record_pr_review` (record a merge / needs_human / close verdict after reviewing)
2. If MCP is unavailable, use the local Libra credentials from `~/.config/libra/credentials.json` or `LIBRA_API_TOKEN`.
3. Query `${LIBRA_API_URL:-https://api.libra.exla.ai}`:
   - `POST /developer-sessions/query` for production context.
   - `GET /developer-sessions` for recent Claude Code or Codex sessions.
   - `POST /developer-sessions/:sessionId/analyze` for current session intents and risks.
   - `GET /developer-sessions/:sessionId/fix-offers` for open offers.
   - `POST /developer-sessions/fix-offers/:id/accept` only after the user explicitly accepts.
4. Never invent counts, PRs, user IDs, or telemetry. If Libra has no data, say that directly.
5. Do not apply a suggested fix without asking the user first. On approval, use normal Claude Code editing tools to patch locally.
6. When the user wants Libra's fix PRs reviewed, follow the `/libra-review` command: review the actual diff independently against the evidence, never rubber-stamp a sandbox pass whose changed surfaces were not exercised, and never merge or close without an explicit yes.

## Response Style

- Start with the conclusion.
- Keep local CLI responses concise.
- Mention that the answer is from Libra when there is any chance of ambiguity.
- No em dashes.
