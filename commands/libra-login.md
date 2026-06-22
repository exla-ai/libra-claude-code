---
name: libra-login
description: Log in to Libra on this machine. Connects Claude Code to the user's Libra account via their API key, so Libra's commit checks and /libra answers are scoped to their own services. Run once.
---

# /libra-login

Connect this machine to the user's **Libra** account. Walk them through it, branded clearly as Libra:

1. Tell the user: "Libra: open your API keys at https://libra.exla.ai/settings/api-keys, create a key or copy an existing one, and paste it here. It looks like `libra_exla-api-key-...`."
2. Wait for the pasted key. Confirm it starts with `libra_exla-api-key-`; if not, ask again.
3. Store it locally (readable only by the user), so the commit guard and `/libra` can use it. Run via Bash, substituting the pasted key for `<KEY>`:
   ```
   mkdir -p ~/.config/libra && printf '{"token":"%s","api":"https://api.libra.exla.ai"}' '<KEY>' > ~/.config/libra/credentials.json && chmod 600 ~/.config/libra/credentials.json
   ```
4. Add or update the Libra remote MCP server with the same key. This makes the plugin install a complete install: hooks are already part of the plugin, and MCP tools are configured here.
   ```
   claude mcp remove libra >/dev/null 2>&1 || true
   claude mcp add --scope user --transport http libra https://api.libra.exla.ai/mcp -H "Authorization: Bearer <KEY>"
   ```
5. Verify the key and show the account + which repos Libra can see for this user:
   ```
   curl -sS --max-time 10 https://api.libra.exla.ai/developer-sessions/whoami -H "Authorization: Bearer <KEY>"
   ```
6. Send a harmless session heartbeat through the installed hook so the Libra dashboard can show this Claude Code session immediately:
   ```
   node -e 'process.stdout.write(JSON.stringify({hook_event_name:"SessionStart",session_id:process.env.CLAUDE_CODE_SESSION_ID||`libra-login-${Date.now()}`,cwd:process.cwd(),prompt:"Libra login completed"}))' | node "${CLAUDE_PLUGIN_ROOT}/scripts/libra-hook.mjs"
   ```
7. Run `claude plugin list` and confirm `libra-claude-code` is installed and enabled. Then run `claude mcp list` and confirm `libra` is connected. Do not print the MCP header or the full key.
8. Report back, branded as Libra: "Libra: logged in as <email>. Hooks are installed, and MCP is connected. I'll check your commits in: <repos>." If whoami returns 401 or an error, tell them the key was not accepted and to paste a fresh one. **Never echo the full key back** to the user.

Once logged in, Libra checks every `git commit` Claude Code attempts through the Bash tool, scoped to the repos your account can see. MCP-only installs do not have this hook, so if hooks are missing, tell the user to install the Libra plugin and rerun `/libra-login`.
