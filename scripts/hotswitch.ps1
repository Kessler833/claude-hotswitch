<#
  hotswitch.ps1 - switch Claude Desktop (Windows, MSIX) between saved logins.

  Only the sign-in is swapped: Network\Cookies and the login entries in config.json.
  Settings, chats, Claude Code sessions etc. stay shared.

  Usage:
    hotswitch.ps1 list | json                  saved accounts (json: for the mod)
    hotswitch.ps1 save   [name]                save the signed-in account
    hotswitch.ps1 new                          save the signed-in account, then sign out
    hotswitch.ps1 use    <name>                switch to <name>
    hotswitch.ps1 transfer <name> <session-id> switch and take that Code session along
    hotswitch.ps1 label  <name> <text>         set the label shown for an account
    hotswitch.ps1 delete <name>                remove a saved account (not the signed-in one)
  save/new/use/transfer close Claude Desktop, change the files and start it again.

  Which saved account is signed in is told by the account id in config.json
  (lastKnownAccountUuid, not a secret), never by a note of our own - so a sign-in made by
  hand can never be saved under another account's name.

  Keep this file ASCII-only: Windows PowerShell 5 (used for list/json/label/delete) reads it
  in the ANSI code page. The other actions need PowerShell 7 (System.Text.Json).
#>
param(
  [Parameter(Position = 0)][string]$Action = 'list',
  [Parameter(Position = 1)][string]$Name,
  [Parameter(Position = 2, ValueFromRemainingArguments)][string[]]$Rest
)
$ErrorActionPreference = 'Stop'

# Where things are:
#   state (saved logins, log): %LOCALAPPDATA%\claude-hotswitch, or $env:HOTSWITCH_HOME
#   Claude's data folder:      found below, or $env:HOTSWITCH_DATA
# HOTSWITCH_TEST=<folder>: work on a copy (folder\data, folder\state) and never touch Claude
$Test     = $env:HOTSWITCH_TEST
$Root     = if ($Test) { Join-Path $Test 'state' } elseif ($env:HOTSWITCH_HOME) { $env:HOTSWITCH_HOME } else { Join-Path $env:LOCALAPPDATA 'claude-hotswitch' }
New-Item -ItemType Directory -Force $Root | Out-Null
$Profiles = Join-Path $Root 'profiles'
$ActiveF  = Join-Path $Root 'active.txt'
$LogF     = Join-Path $Root 'hotswitch.log'
$LockF    = Join-Path $Root 'hotswitch.lock'
$SnapDir  = Join-Path $Root 'pre-switch'
# Claude Desktop keeps its data in one of these, depending on how it was installed
# (Microsoft Store / MSIX with its data folder moved out, MSIX, or the classic installer)
function Find-ClaudeData {
  if ($env:HOTSWITCH_DATA) { return $env:HOTSWITCH_DATA }
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Claude-Data\claude_pzs8sxrjxfjjc'),
    (Join-Path $env:LOCALAPPDATA 'Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude'),
    (Join-Path $env:APPDATA 'Claude')
  )
  foreach ($c in $candidates) { if (Test-Path (Join-Path $c 'config.json')) { return $c } }
  throw 'Claude Desktop not found (no config.json). Set HOTSWITCH_DATA to its data folder.'
}
$Data     = if ($Test) { Join-Path $Test 'data' } else { Find-ClaudeData }
$Config   = Join-Path $Data 'config.json'
$Cookies  = Join-Path $Data 'Network\Cookies'
$AppId    = 'Claude_pzs8sxrjxfjjc!Claude'           # Microsoft Store / MSIX install
$Classic  = Join-Path $env:LOCALAPPDATA 'AnthropicClaude\claude.exe'   # classic installer
$AuthKeys = @('oauth:tokenCache', 'oauth:tokenCacheV2', 'lastKnownAccountUuid')
$Utf8     = New-Object Text.UTF8Encoding $false
$Mutating = @('save', 'new', 'use', 'transfer')

function Log($m) {
  $l = "{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $m
  Add-Content $LogF $l
  Write-Output $m
}
function Trim-Log {
  # keep the log small: the last 500 lines
  if ((Test-Path $LogF) -and (Get-Item $LogF).Length -gt 200KB) {
    $keep = Get-Content $LogF -Tail 500
    [IO.File]::WriteAllLines($LogF, [string[]]$keep, $Utf8)
  }
}
function Check-Name($n) {
  if (-not $n -or $n -notmatch '^[A-Za-z0-9_.-]{1,32}$' -or $n -like '__*') {
    throw "Invalid name '$n' (letters, digits, _ . - only)"
  }
}
function Write-TextFile($f, $text) {
  # write a temp file next to it, then swap it in: a crash never leaves half a file
  $tmp = "$f.tmp"
  [IO.File]::WriteAllText($tmp, $text, $Utf8)
  Move-Item -LiteralPath $tmp -Destination $f -Force
}

# ---- who is signed in: the account id in a JSON file (works in PowerShell 5 and 7) ----
function Get-Uuid($file) {
  if (-not (Test-Path $file)) { return '' }
  if ([IO.File]::ReadAllText($file) -match '"lastKnownAccountUuid"\s*:\s*"([0-9a-fA-F-]{36})"') { return $Matches[1].ToLower() }
  ''
}
function Get-SavedAccounts {
  @(if (Test-Path $Profiles) {
      Get-ChildItem $Profiles -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'auth.json') }
    })
}
# the saved account the signed-in login belongs to, '' when it is not saved (or nobody is signed in)
function Current-Profile {
  $uuid = Get-Uuid $Config
  if (-not $uuid) { return '' }
  foreach ($d in Get-SavedAccounts) {
    if ((Get-Uuid (Join-Path $d.FullName 'auth.json')) -eq $uuid) { return $d.Name }
  }
  ''
}
function Get-Label($dir) {
  $lf = Join-Path $dir 'label.txt'
  if (Test-Path $lf) { [IO.File]::ReadAllText($lf).Trim() } else { '' }
}
function Next-Name {
  for ($i = 1; ; $i++) { if (-not (Test-Path (Join-Path $Profiles "account$i"))) { return "account$i" } }
}
# Where to save the signed-in login: its own saved account (same account id), else a new accountN.
# (Never matched by the shown name: two accounts can both be called "Alex - Pro".)
function Name-For-Current {
  $p = Current-Profile
  if ($p) { return $p }
  Next-Name
}

# ---- Claude Desktop ----
function Get-ClaudeProcs {
  if ($Test) { return }
  # the desktop app only - never a Claude Code CLI (also named claude.exe) running in a terminal
  Get-CimInstance Win32_Process -Filter "Name='claude.exe'" |
    Where-Object { $_.ExecutablePath -like '*\WindowsApps\Claude_*\app\Claude.exe' -or $_.ExecutablePath -like '*\AnthropicClaude\app-*\claude.exe' }
}
function Stop-Claude {
  $p = Get-ClaudeProcs
  if (-not $p) { return }
  $p | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }
  for ($i = 0; $i -lt 100 -and (Get-ClaudeProcs); $i++) { Start-Sleep -Milliseconds 100 }
  if (Get-ClaudeProcs) { throw 'Claude Desktop could not be closed.' }
  Start-Sleep -Milliseconds 300   # let file handles go
}
# Links the app understands (found in its code):
#   claude://code/new                     a fresh, empty Code session (default after a switch)
#   claude://code/continue?session=last   the most recent Code session
#   claude://resume?session=<cli id>      imports a Code session by id into the signed-in account
# Opening a claude:// link starts the app and hands it the link at once (like its jump list).
$script:OpenLink = @('claude://code/new?source=desktop_action')
function Start-Claude {
  $links = @($script:OpenLink | Where-Object { $_ })
  if ($Test) { Log "(test) would open: $($links -join ' -> ')"; return }
  if ($links.Count -eq 0) {
    if (Test-Path $Classic) { Start-Process $Classic } else { Start-Process "shell:AppsFolder\$AppId" }
    return
  }
  Start-Process $links[0]
  foreach ($link in ($links | Select-Object -Skip 1)) { Start-Sleep -Seconds 3; Start-Process $link }
}

# ---- login files (PowerShell 7: System.Text.Json keeps every other value exactly as written) ----
# the leading comma stops PowerShell from unrolling the JsonObject into key/value pairs on return
function Read-JsonFile($f) { , [System.Text.Json.Nodes.JsonNode]::Parse([IO.File]::ReadAllText($f)) }
function Write-JsonFile($f, $node) {
  $o = [System.Text.Json.JsonSerializerOptions]::new(); $o.WriteIndented = $true
  Write-TextFile $f $node.ToJsonString($o)
}
function Has-Login {
  if (-not (Test-Path $Config)) { return $false }
  $c = Read-JsonFile $Config
  foreach ($k in 'oauth:tokenCache', 'oauth:tokenCacheV2') { if ($c.ContainsKey($k)) { return $true } }
  $false
}
function Save-Profile($n) {
  Check-Name $n
  $c = Read-JsonFile $Config
  $auth = [System.Text.Json.Nodes.JsonObject]::new()
  foreach ($k in $AuthKeys) { if ($c.ContainsKey($k)) { $auth[$k] = $c[$k].DeepClone() } }
  if (-not $auth.ContainsKey('oauth:tokenCacheV2') -and -not $auth.ContainsKey('oauth:tokenCache')) {
    throw 'No login found in config.json - are you signed in?'
  }
  $dir = Join-Path $Profiles $n
  New-Item -ItemType Directory -Force $dir | Out-Null
  if (Test-Path $Cookies) { Copy-Item $Cookies (Join-Path $dir 'Cookies.tmp') -Force; Move-Item (Join-Path $dir 'Cookies.tmp') (Join-Path $dir 'Cookies') -Force }
  Write-JsonFile (Join-Path $dir 'auth.json') $auth
  # label it with the name Claude showed for this login (written by launch.ps1 while Claude was
  # still open), unless it already has one
  $cur = Join-Path $Root 'current-label.txt'
  if (-not (Get-Label $dir) -and (Test-Path $cur)) {
    $who = [IO.File]::ReadAllText($cur).Trim()
    if ($who) { Write-TextFile (Join-Path $dir 'label.txt') $who }
  }
}
function Clear-Login {
  foreach ($f in @($Cookies, "$Cookies-journal")) { if (Test-Path $f) { Remove-Item $f -Force } }
  $c = Read-JsonFile $Config
  foreach ($k in $AuthKeys) { [void]$c.Remove($k) }
  Write-JsonFile $Config $c
}
function Restore-Profile($n) {
  $dir = Join-Path $Profiles $n
  $auth = Read-JsonFile (Join-Path $dir 'auth.json')   # parse first: a broken file fails before anything changes
  if ($auth -isnot [System.Text.Json.Nodes.JsonObject] -or -not ($auth.ContainsKey('oauth:tokenCacheV2') -or $auth.ContainsKey('oauth:tokenCache'))) {
    throw "The saved login of '$n' is incomplete."
  }
  $ck = Join-Path $dir 'Cookies'
  if ((Test-Path $ck) -and -not (Test-Path $ck -PathType Leaf)) { throw "The saved login of '$n' is damaged (Cookies)." }
  Clear-Login
  if (Test-Path $ck) { Copy-Item $ck $Cookies -Force }
  $c = Read-JsonFile $Config
  foreach ($kv in @($auth)) { $c[$kv.Key] = $kv.Value.DeepClone() }
  Write-JsonFile $Config $c
}

# ---- safety: a copy of the login as it was before this run, put back if anything fails ----
function Take-Snapshot {
  if (Test-Path $SnapDir) { Remove-Item $SnapDir -Recurse -Force }
  New-Item -ItemType Directory -Force $SnapDir | Out-Null
  if (Test-Path $Config) { Copy-Item $Config (Join-Path $SnapDir 'config.json') }
  if (Test-Path $Cookies) { Copy-Item $Cookies (Join-Path $SnapDir 'Cookies') }
  $script:HasSnapshot = $true
}
function Undo-Snapshot {
  if (-not $script:HasSnapshot) { return }
  $sc = Join-Path $SnapDir 'config.json'
  if (Test-Path $sc) { Copy-Item $sc $Config -Force }
  $sk = Join-Path $SnapDir 'Cookies'
  if (Test-Path $sk) { Copy-Item $sk $Cookies -Force }
  elseif (Test-Path $Cookies) { Remove-Item $Cookies -Force }
  Log 'Login restored to how it was before the switch.'
}
function Backup-Once {
  # one copy of the very first login, kept for good
  $b = Join-Path $Root 'backup-original'
  if (Test-Path $b) { return }
  New-Item -ItemType Directory -Force $b | Out-Null
  if (Test-Path $Config) { Copy-Item $Config $b }
  if (Test-Path $Cookies) { Copy-Item $Cookies $b }
}

# ---- one run at a time (a double click must not start two switches) ----
function Take-Lock {
  try {
    $script:Lock = [IO.File]::Open($LockF, 'OpenOrCreate', 'ReadWrite', 'None')
  } catch {
    Write-Output 'A switch is already running.'
    exit 3
  }
}

$script:HasSnapshot = $false
$act = $Action.ToLower()
if ($act -in $Mutating) { Take-Lock; Trim-Log }
$claudeStopped = $false
try {
  switch ($act) {
    'list' {
      $cur = Current-Profile
      $names = @(Get-SavedAccounts | ForEach-Object Name)
      if (-not $names) { 'No accounts saved yet.'; break }
      foreach ($n in $names) { if ($n -eq $cur) { "* $n (active)" } else { "  $n" } }
      if (-not $cur) { '(the signed-in account is not saved)' }
    }
    'json' {
      $list = @(Get-SavedAccounts | ForEach-Object { [ordered]@{ name = $_.Name; label = (Get-Label $_.FullName) } })
      # the app's language (Settings > Language), for the mod's texts
      $locale = ''
      if ((Test-Path $Config) -and [IO.File]::ReadAllText($Config) -match '"locale"\s*:\s*"([^"]+)"') { $locale = $Matches[1] }
      $j = ConvertTo-Json -Compress -Depth 4 -InputObject ([ordered]@{ active = (Current-Profile); locale = $locale; accounts = $list })
      # escape non-ASCII (e.g. the middle dot) so the output survives any console code page
      [regex]::Replace($j, '[^\x00-\x7F]', { param($m) '\u{0:x4}' -f [int][char]$m.Value })
    }
    'label' {
      Check-Name $Name
      $dir = Join-Path $Profiles $Name
      if (-not (Test-Path $dir)) { throw "No saved account '$Name'." }
      $text = ($Rest -join ' ').Trim()
      if ($text.Length -gt 80) { throw 'Label too long (max. 80 characters).' }
      Write-TextFile (Join-Path $dir 'label.txt') $text
      Log "Label of '$Name': '$text'"
    }
    'delete' {
      Check-Name $Name
      $dir = Join-Path $Profiles $Name
      if (-not (Test-Path $dir)) { throw "No saved account '$Name'." }
      if ($Name -eq (Current-Profile)) { throw "'$Name' is signed in right now and cannot be removed." }
      Remove-Item $dir -Recurse -Force
      Log "'$Name' removed."
    }
    'save' {
      if (-not $Name) { $Name = Name-For-Current }
      Check-Name $Name
      Stop-Claude; $claudeStopped = $true; Backup-Once
      Save-Profile $Name
      Set-Content $ActiveF $Name -NoNewline
      Log "Signed-in account saved as '$Name'."
      Start-Claude
    }
    'new' {
      Stop-Claude; $claudeStopped = $true; Backup-Once; Take-Snapshot
      if (Has-Login) { $a = Name-For-Current; Save-Profile $a; Log "'$a' saved." }   # never lose a login
      Clear-Login
      Set-Content $ActiveF '' -NoNewline
      $script:OpenLink = @()   # the sign-in page should show, no session
      Log 'Signed out. Sign in to the other account - it is saved on the next switch.'
      Start-Claude
    }
    { $_ -in 'use', 'transfer' } {
      Check-Name $Name
      if (-not (Test-Path (Join-Path $Profiles "$Name\auth.json"))) { throw "No saved account '$Name'." }
      if ($act -eq 'transfer') {
        # "Transfer this session": the chat itself (~/.claude/projects/<dir>/<id>.jsonl) is shared by
        # all accounts; the app's own resume link imports it into the account signed in after the swap
        $cliId = "$($Rest[0])"
        if ($cliId -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') { throw "Invalid session id '$cliId'." }
        $script:OpenLink = @("claude://resume?session=$cliId")
      }
      Stop-Claude; $claudeStopped = $true; Backup-Once; Take-Snapshot
      if (Has-Login) {
        # keep the signed-in login (with its freshly refreshed tokens) under its own account
        $a = Name-For-Current
        if ($a -ne $Name) { Save-Profile $a; Log "'$a' saved." }
      }
      Restore-Profile $Name
      Set-Content $ActiveF $Name -NoNewline
      Log "Switched to '$Name'$(if ($act -eq 'transfer') { ' (with this session)' })."
      Start-Claude
    }
    default { throw "Unknown action '$Action'." }
  }
} catch {
  Log "ERROR: $($_.Exception.Message)"
  if ($act -in $Mutating) {
    try { Undo-Snapshot } catch { Log "ERROR while restoring: $($_.Exception.Message)" }
    # Claude was closed by this run: open it again (no session link after a failure)
    if ($claudeStopped -and -not (Get-ClaudeProcs)) { $script:OpenLink = @(); Start-Claude }
  }
  exit 1
} finally {
  if ($script:Lock) { $script:Lock.Dispose() }
}
