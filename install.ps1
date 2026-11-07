<#
  Hotswitch installer - account switcher for the Claude Desktop app on Windows (unofficial).

  Double-click install.cmd, or run:
    powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1            # from GitHub
    powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1 -Local     # from this folder
  Options: -Yes (no questions, for AI agents / scripts), -DryRun (only print what it would do).

  What it does:
    1. checks that the Claude Desktop app is installed (Windows),
    2. makes sure PowerShell 7 (pwsh) is there - the switch needs it (offers winget),
    3. finds the claude CLI (on PATH, or the copy that ships inside Claude Desktop),
    4. adds the marketplace and installs the plugin "hotswitch" for your user.
  Then restart Claude Desktop. Keep this file ASCII-only (Windows PowerShell 5 reads it).
#>
param([switch]$Local, [switch]$Yes, [switch]$DryRun)
$ErrorActionPreference = 'Stop'
$Repo = 'Kessler833/claude-hotswitch'
$Plugin = 'hotswitch@hotswitch'

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Step($m) { Say "`n== $m" 'Cyan' }
function Fail($m) { Say "`nERROR: $m" 'Red'; exit 1 }
function Ask($q) {
  if ($Yes) { return $true }
  $a = Read-Host "$q [Y/n]"
  return ($a -eq '' -or $a -match '^[yYjJ]')
}
function Run($exe, [string[]]$argv) {
  Say ("  > " + (Split-Path $exe -Leaf) + ' ' + ($argv -join ' ')) 'DarkGray'
  if ($DryRun) { return }
  & $exe @argv
  if ($LASTEXITCODE) { Fail "'$(Split-Path $exe -Leaf) $($argv -join ' ')' failed (exit $LASTEXITCODE)." }
}

Say 'Hotswitch - account switcher for Claude Desktop (unofficial, not made by Anthropic)' 'White'

Step 'Windows and Claude Desktop'
if ($env:OS -ne 'Windows_NT') { Fail 'Hotswitch works on Windows only.' }
$dataDirs = @(@(
  (Join-Path $env:LOCALAPPDATA 'Claude-Data\claude_pzs8sxrjxfjjc'),
  (Join-Path $env:LOCALAPPDATA 'Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude'),
  (Join-Path $env:APPDATA 'Claude')
) | Where-Object { Test-Path (Join-Path $_ 'config.json') })
if (-not $dataDirs) { Fail 'Claude Desktop was not found. Install it from https://claude.ai/download, sign in once, then run this again.' }
Say "  Claude Desktop data: $($dataDirs[0])" 'Green'

Step 'PowerShell 7'
if (Get-Command pwsh -ErrorAction SilentlyContinue) {
  Say '  pwsh found.' 'Green'
} else {
  Say '  PowerShell 7 (pwsh) is needed for the switch itself.' 'Yellow'
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { Fail 'Install PowerShell 7 from https://aka.ms/powershell, then run this again.' }
  if (-not (Ask '  Install it now with winget?')) { Fail 'PowerShell 7 is required.' }
  Run 'winget' @('install', '--id', 'Microsoft.PowerShell', '-e', '--accept-source-agreements', '--accept-package-agreements')
}

Step 'claude CLI'
$cli = (Get-Command claude -ErrorAction SilentlyContinue).Source
if (-not $cli) {
  # the CLI that ships inside Claude Desktop (claude-code\<version>\<build>\claude.exe), newest first
  $cli = $dataDirs | ForEach-Object { Join-Path $_ 'claude-code' } | Where-Object { Test-Path $_ } |
    ForEach-Object { Get-ChildItem $_ -Recurse -Depth 2 -Filter claude.exe -ErrorAction SilentlyContinue } |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $cli) { Fail 'No claude CLI found. Open the Code tab in Claude Desktop once (it brings the CLI along), or install Claude Code, then run this again.' }
Say "  using $cli" 'Green'

Step 'Install the plugin'
$source = if ($Local) { $PSScriptRoot } else { $Repo }
Run $cli @('plugin', 'marketplace', 'add', $source)
Run $cli @('plugin', 'install', $Plugin)

Say "`nDone. Now:" 'Green'
Say '  1. Quit Claude Desktop completely and open it again.'
Say '  2. Open a Code session and send a message - bottom right, next to the model name,'
Say '     there is a small "Accounts" button (in your app language). Click it.'
Say '  3. "+ Add account": sign in to your second account once. From then on: one click.'
Say "`nSaved logins stay on this PC only: $env:LOCALAPPDATA\claude-hotswitch" 'DarkGray'
