# Starts hotswitch.ps1 <action> [name] [session-id] fully detached from Claude (via WMI, hidden window),
# so it keeps running while it closes and restarts Claude Desktop. Works in Windows PowerShell 5.
param([Parameter(Mandatory)][string]$Action, [string]$Name = '', [string]$SessionId = '')
if ($Action -notmatch '^(use|transfer|save|new)$') { Write-Output 'Invalid action'; exit 2 }
if ($Name -and $Name -notmatch '^[A-Za-z0-9_.-]{1,32}$') { Write-Output 'Invalid name'; exit 2 }
if ($SessionId -and $SessionId -notmatch '^[0-9a-f-]{36}$') { Write-Output 'Invalid session id'; exit 2 }
$script = Join-Path $PSScriptRoot 'hotswitch.ps1'
# Remember who is signed in right now (read from Claude's window while it is still open);
# hotswitch.ps1 uses it to label an account it saves.
$who = ''
try { $who = ((& (Join-Path $PSScriptRoot 'whoami.ps1')) | ConvertFrom-Json).label } catch {}
$state = if ($env:HOTSWITCH_HOME) { $env:HOTSWITCH_HOME } else { Join-Path $env:LOCALAPPDATA 'claude-hotswitch' }
New-Item -ItemType Directory -Force $state | Out-Null
$lf = Join-Path $state 'current-label.txt'
if ($who) { [IO.File]::WriteAllText($lf, "$who".Trim(), (New-Object Text.UTF8Encoding $false)) }
elseif (Test-Path $lf) { Remove-Item $lf -Force }
$cmd = "C:\Windows\System32\cmd.exe /c pwsh.exe -NoProfile -ExecutionPolicy Bypass -File `"$script`" $Action $Name $SessionId"
$startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd.Trim(); ProcessStartupInformation = $startup }
Write-Output "rc=$($r.ReturnValue)"
exit [int]$r.ReturnValue
