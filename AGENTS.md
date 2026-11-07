# AGENTS.md – installing and using Hotswitch (for AI coding agents)

Hotswitch is an **account switcher for the Claude Desktop app on Windows**: a Claude Code plugin (hooks module) plus PowerShell scripts. It adds an "Accounts" button to Claude Desktop's Code tab that switches between saved Claude logins with one click and can transfer the current Claude Code session to another account. Unofficial, not affiliated with Anthropic.

Use this file when a person asks you to *"install Hotswitch"*, *"switch between Claude accounts"*, *"use two Claude accounts in Claude Desktop"* or similar.

## Preconditions (check, don't assume)

1. `$env:OS -eq 'Windows_NT'` – Windows only.
2. Claude Desktop is installed and was signed in once: one of these has a `config.json`
   - `%LOCALAPPDATA%\Claude-Data\claude_pzs8sxrjxfjjc` (Microsoft Store, data moved)
   - `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude` (Microsoft Store)
   - `%APPDATA%\Claude` (classic installer)
3. PowerShell 7: `Get-Command pwsh`. If missing: `winget install --id Microsoft.PowerShell -e` (ask the person first).
4. A `claude` CLI: `Get-Command claude`, else the one bundled with Claude Desktop at `<data folder>\claude-code\<version>\<build>\claude.exe` (newest).

## Install – the non-interactive way

```powershell
git clone https://github.com/Kessler833/claude-hotswitch
powershell -NoProfile -ExecutionPolicy Bypass -File claude-hotswitch\install.ps1 -Yes
```

`-Yes` answers the installer's questions (it will install PowerShell 7 with winget if missing). `-DryRun` prints the steps only. `-Local` installs from the cloned folder instead of GitHub.

Equivalent by hand:

```powershell
claude plugin marketplace add Kessler833/claude-hotswitch
claude plugin install hotswitch@hotswitch
```

Then tell the person: **quit Claude Desktop completely and reopen it**, open a Code session, send a message, then click **👤 Accounts** (bottom right, next to the model name). You cannot do this for them: an agent running inside Claude Desktop may not control Claude's own window.

## First setup (the person does this, once)

1. 👤 Accounts → **+ Add account** → Claude restarts signed out → sign in to the second account.
2. 👤 Accounts → click the first account. Both accounts are now saved.

## Operating it from a shell (optional)

All state is in `%LOCALAPPDATA%\claude-hotswitch` (override with `HOTSWITCH_HOME`). The scripts are in the plugin folder under `scripts\`.

| Command (from the plugin's `scripts` folder) | Effect |
|---|---|
| `powershell -File hotswitch.ps1 json` | saved accounts, the active one, the app language (read-only) |
| `powershell -File hotswitch.ps1 list` | same as text |
| `powershell -File launch.ps1 use <name>` | switch (closes and restarts Claude Desktop – **ends the current agent session**) |
| `powershell -File launch.ps1 transfer <name> <session-uuid>` | switch and reopen that Claude Code session in the other account |
| `powershell -File launch.ps1 new` | save the current login, sign out |
| `powershell -File hotswitch.ps1 delete <name>` | remove a saved account (not the signed-in one) |

Switching restarts Claude Desktop, which ends any agent running inside it. Ask the person before you switch.

## Safety rules for agents

- Never print, copy or upload anything from `%LOCALAPPDATA%\claude-hotswitch\profiles` or Claude's `config.json` / `Network\Cookies`: they hold login tokens.
- Do not decrypt tokens. Account names come from the UI (`scripts\whoami.ps1`, UI Automation).
- Run the tests after changing a script: `pwsh -NoProfile -File tests\run-tests.ps1` (fake data only).
