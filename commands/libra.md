---
name: libra
description: Ask Libra about your production services. Libra is the user's ops agent that watches their AWS + GitHub. Use for current prod health, open findings, what a deploy did, whether a recent change is risky, or to see Libra's fix offers. Always grounded in real telemetry.
---

# /libra, ask Libra

You are relaying a question to **Libra**, the user's production ops agent (it watches their live AWS + GitHub). Make it unmistakable that the answer comes from Libra: **begin every response with the lead line `**Libra:** <the answer in one sentence>`** so the user always knows this is Libra's grounded analysis, not a generic guess.

When the user runs `/libra <question>`:

1. **Get the answer from Libra, not from memory.** If the Libra MCP server is connected, call its tools (`libra_query`, `libra_list_risks`, `libra_runtime_health`, `libra_query_traces`, `libra_query_logs`, `libra_task_forensics`, `libra_recent_deploys`, `libra_check_commit`, `libra_create_monitor`, `libra_list_sessions`, `libra_list_fix_offers`, `libra_view_session_events`, `libra_accept_fix_offer`, `libra_list_fix_prs`, `libra_pr_evidence`, `libra_record_pr_review`). Otherwise read `~/.config/libra/credentials.json` or `LIBRA_API_TOKEN`, then POST to `${LIBRA_API_URL:-https://api.libra.exla.ai}/developer-sessions/query` with the token as `Authorization: Bearer <token>`.
2. **Answer only from what Libra returns**: real prod signals, deploy history, findings, PRs. Never invent file paths, counts, PRs, or user IDs.
3. **Chase live evidence before concluding.** `libra_query` answers from Libra's incident history; when the question is about current state or needs proof, follow up with the live tools: `libra_runtime_health` (is prod healthy right now), `libra_query_traces` (is this error actually firing, since when, hitting whom), `libra_query_logs` (verify a specific error string in CloudWatch), `libra_task_forensics` (task deaths: kill cadence, memory verdict, what was running when each task died), `libra_recent_deploys` (does the timing line up with a deploy). Chain as many as the question needs. A failed or unavailable fetch means unknown, never healthy.
4. **Answer in the Libra shape** (next section), so every answer reads the same way and can be scanned at a glance.
5. **Times in US Pacific, labeled** (e.g. `9:40 AM PDT`); dates as `Jun 18`, never raw UTC.
6. **Never apply a fix without asking.** If Libra surfaces a fix offer, summarize the problem + suggested change + confidence, then ASK the user before you edit anything. On yes, apply the patch with normal Claude Code tools and tell the user Libra suggested it.

## Answer shape

Every `/libra` answer uses this shape:

```
**Libra:** <the answer in one sentence>

- **What's happening:** <the situation, in plain words>
- **Evidence:** <counts, times in US Pacific (e.g. 9:40 AM PDT), trace ids, PR numbers, exactly as Libra returned them>
- **Since:** <when it started, or the trend>
- **Next step:** <one concrete action>
```

Rules:

- Lead with the answer. The `**Libra:**` line comes first and stands on its own.
- When Libra has no data, or a fetch failed or timed out, write `Unknown` plus what is missing (for example, `Unknown: libra_query_traces timed out, so whether it is still firing is not verified`). Never guess, and never call it healthy.
- Quote evidence as Libra returned it. Do not round, convert, or invent counts, ids, or times.
- Keep it to about 8 lines unless the user asks for detail.
- No em dashes.

Example asks: `/libra what is failing in prod right now`, `/libra monitor UpdateExternalCrmWorkflow HTTP 400 logs in prod`, `/libra what are our coding agents working on`, `/libra did my last commit add risk`, `/libra what did PR #1866 change`, `/libra show fix offers`.
