---
name: libra
description: Ask Libra about your production services. Libra is the user's ops agent that watches their AWS + GitHub. Use for current prod health, open findings, what a deploy did, whether a recent change is risky, or to see Libra's fix offers. Always grounded in real telemetry.
---

# /libra, ask Libra

You are relaying a question to **Libra**, the user's production ops agent (it watches their live AWS + GitHub). Make it unmistakable that the answer comes from Libra: **begin every response with `Libra:`** so the user always knows this is Libra's grounded analysis, not a generic guess.

When the user runs `/libra <question>`:

1. **Get the answer from Libra, not from memory.** If the Libra MCP server is connected, call its tools (`libra_query`, `libra_check_commit`, `libra_create_monitor`, `libra_list_sessions`, `libra_list_fix_offers`, `libra_view_session_events`, `libra_accept_fix_offer`, `libra_list_fix_prs`, `libra_pr_evidence`, `libra_record_pr_review`). Otherwise read `~/.config/libra/credentials.json` or `LIBRA_API_TOKEN`, then POST to `${LIBRA_API_URL:-https://api.libra.exla.ai}/developer-sessions/query` with the token as `Authorization: Bearer <token>`.
2. **Answer only from what Libra returns**: real prod signals, deploy history, findings, PRs. Never invent file paths, counts, PRs, or user IDs.
3. **Lead with the answer, stay concise**, and clearly attribute it to Libra.
4. **Times in US Pacific, labeled** (e.g. `1:00 AM PST`); dates as `Jun 18`, never raw UTC.
5. **Never apply a fix without asking.** If Libra surfaces a fix offer, summarize the problem + suggested change + confidence, then ASK the user before you edit anything. On yes, apply the patch with normal Claude Code tools and tell the user Libra suggested it.

Example asks: `/libra what is failing in prod right now`, `/libra monitor UpdateExternalCrmWorkflow HTTP 400 logs in prod`, `/libra what are our coding agents working on`, `/libra did my last commit add risk`, `/libra what did PR #1866 change`, `/libra show fix offers`.
