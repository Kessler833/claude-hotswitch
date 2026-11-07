# Prints the signed-in account as Claude Desktop shows it bottom-left, as JSON {"label": "<name> <middle dot> <plan>"},
# read via Windows UI Automation (the app reports its own buttons) - no screenshot, no credentials.
# Windows PowerShell 5. Keep this file ASCII-only: PowerShell 5 reads it in the ANSI code page.
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A  = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
$CT = [System.Windows.Automation.ControlType]
$dot = [char]0x00B7
$btnCond = New-Object System.Windows.Automation.PropertyCondition ($A::ControlTypeProperty, $CT::Button)
$best = $null
try {
  foreach ($w in $A::RootElement.FindAll($TS::Children, [System.Windows.Automation.Condition]::TrueCondition)) {
    if ($w.Current.Name -ne 'Claude') { continue }
    foreach ($b in $w.FindAll($TS::Descendants, $btnCond)) {
      $n = $b.Current.Name
      if ($n -notmatch '^(?<name>\S.{0,40}?)\s+(?<plan>Pro|Max|Free|Team|Enterprise|Kostenlos)$') { continue }
      # the account button sits at the very bottom of the sidebar; a chat title that happens to
      # end in "Pro" sits higher up - so take the lowest match
      $r = $b.Current.BoundingRectangle
      if ($r.IsEmpty) { continue }
      if (-not $best -or $r.Bottom -gt $best.Bottom) {
        $best = @{ Bottom = $r.Bottom; Label = ("{0} {1} {2}" -f $Matches.name, $dot, $Matches.plan) }
      }
    }
  }
} catch { exit 1 }
if (-not $best) { exit 1 }
# escape non-ASCII so the output survives any console code page
$json = ConvertTo-Json -Compress -InputObject @{ label = $best.Label }
Write-Output ([regex]::Replace($json, '[^\x00-\x7F]', { param($m) '\u{0:x4}' -f [int][char]$m.Value }))
exit 0
