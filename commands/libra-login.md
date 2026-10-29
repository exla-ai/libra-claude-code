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
6. If `command -v codex` finds Codex, install or update Libra's Codex hooks, so native Codex sessions report sanitized session events and get Libra's context:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/install-codex-hooks.mjs"
   ```
   It prints JSON. If `ok` is false, tell the user the `error`. Otherwise pass on its `warnings` and its `next` line: Codex runs the hooks only after the user approves them once in Codex's `/hooks`. Skip this step when Codex is not installed.
7. Optional: Libra's tools in Codex. The Codex hooks from step 6 send session events and receive Libra's context; Libra's MCP tools (including the daily coding report) need the Libra server registered in Codex too. Do this only if `command -v codex` finds Codex and the user wants it. If `codex mcp get libra` already shows `https://api.libra.exla.ai/mcp`, skip this step. Codex sends the key from an environment variable and stores only the variable's name, so the key never goes into Codex's config:
   ```
   codex mcp remove libra >/dev/null 2>&1 || true
   codex mcp add libra --url https://api.libra.exla.ai/mcp --bearer-token-env-var LIBRA_API_TOKEN
   ```
   Then tell the user to add `export LIBRA_API_TOKEN=<their key>` to the shell profile Codex starts from (for example `~/.zshrc`) and to start a new Codex session. Edit the profile only if the user asks you to, and never print the key.
8. Send a harmless Claude Code session heartbeat through the installed hook so the Libra dashboard can show this session immediately:
   ```
   node -e 'process.stdout.write(JSON.stringify({hook_event_name:"SessionStart",session_id:process.env.CLAUDE_CODE_SESSION_ID||`libra-login-${Date.now()}`,cwd:process.cwd(),prompt:"Libra login completed"}))' | node "${CLAUDE_PLUGIN_ROOT}/scripts/libra-hook.mjs" claude-code
   ```
9. Run `claude plugin list` and confirm `libra-claude-code` is installed and enabled. Then run `claude mcp list` and confirm `libra` is connected. If you did step 6, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/install-codex-hooks.mjs" --status` and confirm `installed` lists all eight events (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostCompact`, `SubagentStart`, `Stop`, `SessionEnd`); where `codex` lists hooks with `trust` other than `trusted`, remind the user to approve them in Codex's `/hooks`. If you did step 7, check that `codex mcp list` lists `libra`. Do not print the MCP header or the full key.
10. Report back, branded as Libra: "Libra: logged in as <email>. Hooks are installed and MCP is connected. I'll check your commits in: <repos>." If you did step 6, add that the Codex hooks are installed and run once approved in Codex's `/hooks`. If you did step 7, add that Libra's tools are registered in Codex and work once `LIBRA_API_TOKEN` is set. If whoami returns 401 or an error, tell them the key was not accepted and to paste a fresh one. **Never echo the full key back** to the user.

Once logged in, Libra checks every `git commit` Claude Code attempts through the Bash tool, scoped to the repos your account can see. Claude Code and Codex hooks also send sanitized session events and bounded transcript summaries when the hook input exposes a transcript path. MCP-only installs do not have these hooks, so if hooks are missing, tell the user to install the Libra plugin and rerun `/libra-login`.
