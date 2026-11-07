# Edge-case tests for hotswitch.ps1 on fake data (dummy tokens, a fake config.json) -
# never touches Claude or the real login. Run:  pwsh -NoProfile -File tests\run-tests.ps1
$ErrorActionPreference = 'Stop'
$S   = Join-Path (Split-Path $PSScriptRoot) 'scripts\hotswitch.ps1'
$PS5 = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$T   = Join-Path ([IO.Path]::GetTempPath()) "hotswitch-tests-$PID"
$env:HOTSWITCH_TEST = $T
$dot = [char]0x00B7
$U = @{ A = 'aaaaaaaa-0000-4000-8000-000000000001'; B = 'bbbbbbbb-0000-4000-8000-000000000002'; C = 'cccccccc-0000-4000-8000-000000000003' }
$script:fail = 0; $script:pass = 0

function Reset {
  if (Test-Path $T) { Remove-Item $T -Recurse -Force }
  New-Item -ItemType Directory -Force "$T\data\Network", "$T\state" | Out-Null
}
function Login($who) {
  # a config with other settings around the login, incl. a date string that must stay as written
  $json = @"
{
  "locale": "de-DE",
  "updaterBannerStagedAt": "2026-11-01T10:00:00.000Z",
  "oauth:tokenCache": "tc-$who",
  "oauth:tokenCacheV2": "tc2-$who",
  "lastKnownAccountUuid": "$($U[$who])",
  "windowSizeWasSignedIn": true
}
"@
  [IO.File]::WriteAllText("$T\data\config.json", $json)
  [IO.File]::WriteAllText("$T\data\Network\Cookies", "cookie-$who")
}
function Who($n) { [IO.File]::WriteAllText("$T\state\current-label.txt", "$n $dot Pro") }
function Run { $out = & pwsh -NoProfile -File $S @args 2>&1; $script:code = $LASTEXITCODE; $script:out = ($out -join "`n") }
function Run5 { $out = & $PS5 -NoProfile -ExecutionPolicy Bypass -File $S @args 2>&1; $script:code = $LASTEXITCODE; $script:out = ($out -join "`n") }
function Cfg { Get-Content "$T\data\config.json" -Raw | ConvertFrom-Json -DateKind String }
function Login-Now { (Cfg).'oauth:tokenCacheV2' }
function Cookie-Now { if (Test-Path "$T\data\Network\Cookies") { [IO.File]::ReadAllText("$T\data\Network\Cookies") } else { '<none>' } }
function Saved($n) { if (Test-Path "$T\state\profiles\$n\auth.json") { (Get-Content "$T\state\profiles\$n\auth.json" -Raw | ConvertFrom-Json).'oauth:tokenCacheV2' } else { '<none>' } }
function Check($name, $cond) {
  if ($cond) { $script:pass++; Write-Host "  ok   $name" -ForegroundColor Green }
  else { $script:fail++; Write-Host "  FAIL $name" -ForegroundColor Red; Write-Host "       last output: $script:out" }
}

Write-Host '1. basic: + Konto, sign in to B, switch back and forth'
Reset; Login A; Who Alex; Run new
Check 'new saves A as account1'            ((Saved account1) -eq 'tc2-A')
Check 'new signs out'                    ((Login-Now) -eq $null -and (Cookie-Now) -eq '<none>')
Check 'new opens no link (sign-in page)' ($out -match 'would open: $' -or $out -match 'would open: *(\n|$)')
Login B; Who Sam; Run use account1
Check 'use: B saved as account2'           ((Saved account2) -eq 'tc2-B')
Check 'use: A signed in again'           ((Login-Now) -eq 'tc2-A' -and (Cookie-Now) -eq 'cookie-A')
Check 'use: opens the empty new chat'    ($out -match 'code/new')
Check 'other settings kept as written'   ((Cfg).locale -eq 'de-DE' -and (Cfg).updaterBannerStagedAt -eq '2026-11-01T10:00:00.000Z' -and (Cfg).windowSizeWasSignedIn -eq $true)
Run use account2
Check 'use account2: B signed in'          ((Login-Now) -eq 'tc2-B')
Run5 json
Check 'json (PS5): active is account2'     ($code -eq 0 -and ($out | ConvertFrom-Json).active -eq 'account2')
Check 'json (PS5): labels escaped'       ($out -match 'Sam \\u00b7 Pro')

Write-Host '2. signed in to another saved account by hand: it must not overwrite the wrong one'
Reset; Login A; Who Alex; Run new; Login B; Who Sam; Run use account1   # account1=A, account2=B, A signed in
Login B   # by hand: B signs in although A was the last one switched to
[IO.File]::WriteAllText("$T\data\config.json", ([IO.File]::ReadAllText("$T\data\config.json")).Replace('tc2-B', 'tc2-B-fresh'))
Run use account1
Check 'B (fresh tokens) went to account2'  ((Saved account2) -eq 'tc2-B-fresh')
Check 'account1 still holds A'             ((Saved account1) -eq 'tc2-A')
Check 'A signed in'                      ((Login-Now) -eq 'tc2-A')

Write-Host '3. a new, unsaved account signed in by hand gets its own entry'
Login C; Who Alex   # same shown name as account1 on purpose
Run use account2
Check 'C saved as account3'                ((Saved account3) -eq 'tc2-C')
Check 'account1 untouched (same name!)'    ((Saved account1) -eq 'tc2-A')
Check 'B signed in (its fresh tokens)'   ((Login-Now) -eq 'tc2-B-fresh')

Write-Host '4. broken saved login: nothing changes'
[IO.File]::WriteAllText("$T\state\profiles\account1\auth.json", '{ broken')
Run use account1
Check 'fails with exit 1'                ($code -eq 1)
Check 'still signed in as B'             ((Login-Now) -eq 'tc2-B-fresh' -and (Cookie-Now) -eq 'cookie-B')
Check 'Claude started again, no link'    ($out -match 'would open: *(\n|$)')

Write-Host '5. failure after the old login was removed: it is put back'
Reset; Login A; Who Alex; Run new; Login B; Who Sam; Run use account1   # A signed in
# the saved cookie file of account2 is held open by another program: the copy fails after
# the old login was already removed
$hold = [IO.File]::Open("$T\state\profiles\account2\Cookies", 'Open', 'Read', 'None')
Run use account2
$hold.Dispose()
Check 'fails with exit 1'                ($code -eq 1)
Check 'rolled back to A'                 ((Login-Now) -eq 'tc2-A' -and (Cookie-Now) -eq 'cookie-A')
Check 'log says it was put back'         ((Get-Content "$T\state\hotswitch.log" -Raw) -match 'restored to how it was')
Remove-Item "$T\state\profiles\account2\Cookies"; New-Item -ItemType Directory "$T\state\profiles\account2\Cookies" | Out-Null
Run use account2
Check 'damaged saved cookies refused'    ($code -eq 1 -and (Login-Now) -eq 'tc2-A')

Write-Host '6. one run at a time'
Reset; Login A; Who Alex; Run new; Login B; Who Sam; Run use account1
$lock = [IO.File]::Open("$T\state\hotswitch.lock", 'OpenOrCreate', 'ReadWrite', 'None')
Run use account2
$lock.Dispose()
Check 'second run exits 3'               ($code -eq 3)
Check 'nothing changed'                  ((Login-Now) -eq 'tc2-A')
Run use account2
Check 'works again after the lock'       ((Login-Now) -eq 'tc2-B')

Write-Host '7. transfer'
Run transfer account1 'x; calc'
Check 'bad session id refused'           ($code -eq 1 -and (Login-Now) -eq 'tc2-B')
Run transfer account1 11834ed6-d50b-47d6-afc3-a62637e5e9c0
Check 'transfer switches'                ((Login-Now) -eq 'tc2-A')
Check 'transfer opens the resume link'   ($out -match 'claude://resume\?session=11834ed6-d50b-47d6-afc3-a62637e5e9c0')

Write-Host '8. delete and label'
Run5 delete account1
Check 'signed-in account not removable'  ($code -eq 1 -and (Test-Path "$T\state\profiles\account1"))
Run5 label account2 'Sam (Uni)'
Check 'label set'                        ([IO.File]::ReadAllText("$T\state\profiles\account2\label.txt") -eq 'Sam (Uni)')
Run5 delete account2
Check 'other account removed'            ($code -eq 0 -and -not (Test-Path "$T\state\profiles\account2"))
Run5 delete '..\..\x'
Check 'path in name refused'             ($code -eq 1)
Run use __pending__
Check 'reserved name refused'            ($code -eq 1)

Write-Host '9. nothing set up yet'
Reset
Run5 json
Check 'json with no config works'        ($code -eq 0 -and ($out | ConvertFrom-Json).accounts.Count -eq 0)
[IO.File]::WriteAllText("$T\data\config.json", '{ "locale": "fr-FR" }')
Run new
Check 'new while signed out saves none'  ($code -eq 0 -and -not (Test-Path "$T\state\profiles"))
Run use account1
Check 'use unknown account fails'        ($code -eq 1)

Write-Host '10. the log stays small'
Reset; Login A; Who Alex
[IO.File]::WriteAllLines("$T\state\hotswitch.log", [string[]](1..20000 | ForEach-Object { "line $_ xxxxxxxxxxxxxxxxxxxx" }))
Run new
Check 'log trimmed'                      ((Get-Content "$T\state\hotswitch.log").Count -le 510)

Remove-Item $T -Recurse -Force
Write-Host ''
Write-Host "$script:pass passed, $script:fail failed" -ForegroundColor ($(if ($script:fail) { 'Red' } else { 'Green' }))
exit $script:fail
