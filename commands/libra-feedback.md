---
name: libra-feedback
allowed-tools: 'Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/libra-hook.mjs" feedback:*)'
description: Tell the Libra team whether Libra helped. Sends a short rating and note about the last thing Libra showed in this coding session (a commit check, production context, or the session-start summary).
---

# /libra-feedback

The user wants to tell the **Libra** team how Libra is working for them. The text after the command is:

$ARGUMENTS

1. If that text is empty, ask exactly one short question and wait for the answer: "Libra: was the last Libra note useful, not useful, or wrong? Anything about how you use Libra is welcome too."
2. Send the user's words, unchanged, by running this Bash command. First pick a heredoc delimiter that cannot appear in their text: `LIBRA_FEEDBACK_` followed by 12 random hex characters (for example `LIBRA_FEEDBACK_3f9a1c0e7b2d`). If the user's text contains the delimiter you picked, pick another. Put their text between the two delimiter lines exactly as they wrote it, and use the same delimiter on both lines. The quoted delimiter keeps the shell from interpreting the text, and a delimiter they cannot have typed keeps their text from ending the heredoc early.
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/libra-hook.mjs" feedback <<'LIBRA_FEEDBACK_<12 random hex characters>'
   <the user's words>
   LIBRA_FEEDBACK_<12 random hex characters>
   ```
   Run exactly that command shape and nothing else, so it matches the pre-approved command and does not ask for permission.
3. Reply with the one line the command prints and nothing else.

Never add your own opinion to the feedback, and never include secrets, keys, or customer data the user did not type.
