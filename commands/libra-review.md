---
name: libra-review
description: Review Libra's open fix PRs against their verification evidence and give the user a merge / needs-eyes / close triage, so they never have to read every PR themselves.
---

# /libra-review, triage Libra's fix PRs

You are reviewing **Libra's automated fix PRs** on the user's behalf. Libra opened these PRs in response to real production incidents; your job is to be the reviewer the user does not have time to be. Begin your final answer with the lead line `**Libra:** <verdict in one sentence>` so the user always knows this is Libra's triage.

When the user runs `/libra-review` (optionally `/libra-review <owner/repo>` or `/libra-review <PR number>`):

## 1. Build the queue

Call `libra_list_fix_prs` (filtered to the repo or PR if given). If it returns nothing, say so in the same lead-line shape (`**Libra:** No open fix PRs to review.`) and stop. Skip PRs whose `priorReview` verdict is recent unless the user asked to re-review.

## 2. Review each PR independently

For each PR, gather two things:

- **Libra's evidence**: `libra_pr_evidence`: the originating problem, sandbox layer results, per-surface exercise status, pass definition, and the repository's own CI verdicts (OIDC-verified reports from their workflows).
- **The actual change**: fetch the real diff with `gh pr diff <number> --repo <owner/repo>` (and `gh pr view` for current state; skip any PR already merged or closed). If `gh` is unavailable, use the git remote or ask the user to install it; do not review from the PR title alone.

Then judge, in this order:

1. **Is the diagnosed problem real and does the diff address its root cause?** Read the diff against the incident description. A change that masks the symptom (swallowing the error, widening a timeout, catching-and-logging) instead of fixing the cause is a `close` with that stated reason.
2. **Trust the evidence only as far as it goes.** These rules are not optional:
   - A sandbox **pass with changed surfaces `not_exercised` or `scenario_missing` is NOT verification**: the app merely booted. Treat such PRs as unverified and weigh the diff review more heavily.
   - The repository's **own CI verdicts are the strongest signal** (they run the repo's real test suite). A failing own-CI report means `needs_human` or `close`, never `merge`.
   - Do not repeat Libra's own verdict back as your review; you are the independent check on it.
3. **Does the diff contain anything beyond the fix?** Unrelated refactors, dependency bumps, behavior changes to untouched surfaces, or edits to CI/workflow files in a runtime fix are each grounds for `needs_human`.
4. **Would this change be safe to revert?** Schema migrations, data backfills, and config changes deserve `needs_human` even when correct.

## 3. Deliver the triage

Lead with one line in the Libra answer shape, then the table:

```
**Libra:** <the verdict in one sentence, e.g. "2 of 3 fix PRs look safe to merge, 1 needs your eyes.">
```

Then output a table: **PR | Title | Verdict | Why (one line)**, with verdicts `merge` / `needs your eyes` / `close`. Below the table, give one short paragraph for anything non-obvious. Full identifiers (owner/repo#number). Say `Unknown` plus what is missing instead of guessing, and keep it to what the evidence, the diff, or `gh` actually showed: every claim must come from those. No em dashes.

## 4. Record and act

- Record every verdict with `libra_record_pr_review` (summary = your one-line why). This posts to the Slack thread where the fix was requested and teaches Libra's revision loop.
- Then ask the user once: "Merge the N PRs marked merge?" On yes, merge them with `gh pr merge --squash`. Never merge, close, or push without that explicit yes; `close` verdicts are recorded but the PR is left open for the user unless they say otherwise.
