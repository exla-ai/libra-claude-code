---
name: libra-login
description: Log in to Libra on this machine. Connects Claude Code to the user's Libra account via their API key, so Libra's commit checks and /libra answers are scoped to their own services. Run once.
---

# /libra login

Connect this machine to the user's **Libra** account. Walk them through it, branded clearly as Libra:

1. Tell the user: "⚖️ Libra: open your API keys at https://libra.exla.ai/settings/api-keys, create a key (or copy an existing one), and paste it here. It looks like `libra_exla-api-key-...`."
2. Wait for the pasted key. Confirm it starts with `libra_exla-api-key-`; if not, ask again.
3. Store it locally (readable only by the user), so the commit guard and `/libra` can use it. Run via Bash, substituting the pasted key for `<KEY>`:
   ```
   mkdir -p ~/.config/libra && printf '{"token":"%s","api":"https://api.libra.exla.ai"}' '<KEY>' > ~/.config/libra/credentials.json && chmod 600 ~/.config/libra/credentials.json
   ```
4. Verify it and show the account + which repos Libra can see for this user:
   ```
   curl -sS --max-time 10 https://api.libra.exla.ai/developer-sessions/whoami -H "Authorization: Bearer <KEY>"
   ```
5. Report back, branded as Libra: "⚖️ Libra: logged in as <email>. I'll check your commits in: <repos>." If whoami returns 401 or an error, tell them the key was not accepted and to paste a fresh one. **Never echo the full key back** to the user.

Once logged in, Libra checks every `git commit` you make in Claude Code, scoped to the repos your account can see.
