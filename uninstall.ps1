<#
  Removes the Hotswitch plugin. Saved logins in %LOCALAPPDATA%\claude-hotswitch are kept
  unless you pass -RemoveSavedLogins.
    powershell -NoProfile -ExecutionPolicy Bypass -File uninstall.ps1 [-RemoveSavedLogins]
  Keep this file ASCII-only (Windows PowerShell 5 reads it).
#>
param([switch]$RemoveSavedLogins)
$ErrorActionPreference = 'Stop'
$cli = (Get-Command claude -ErrorAction SilentlyContinue).Source
if (-not $cli) {
  $cli = @((Join-Path $env:LOCALAPPDATA 'Claude-Data\claude_pzs8sxrjxfjjc\claude-code'), (Join-Path $env:APPDATA 'Claude\claude-code')) |
    Where-Object { Test-Path $_ } | ForEach-Object { Get-ChildItem $_ -Recurse -Depth 2 -Filter claude.exe -ErrorAction SilentlyContinue } |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $cli) { Write-Host 'No claude CLI found.' -ForegroundColor Red; exit 1 }
& $cli plugin uninstall 'hotswitch@hotswitch'
& $cli plugin marketplace remove hotswitch
if ($RemoveSavedLogins) {
  $state = Join-Path $env:LOCALAPPDATA 'claude-hotswitch'
  if (Test-Path $state) { Remove-Item $state -Recurse -Force; Write-Host "Removed $state" }
}
Write-Host 'Hotswitch removed. Restart Claude Desktop.' -ForegroundColor Green
