# Watches one key. While it is held, turns on the Claude app's own voice
# input (its record button, through UI Automation); on release, turns it
# off, and the app puts what was said in the prompt box itself.
# Writes one line per event to stdout:
#   BUSY / READY / REC / DONE / NOBUTTON / ERR <message>
# Button names are built from character codes: Windows PowerShell reads
# a file without a BOM in the ANSI code page.
param([string]$Key = 'RightCtrl')

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

# Every session with the mod may start a helper, and two pressing the one
# button would cancel each other out: one watches the key at a time. Any
# other leaves at once, before loading anything, and its session starts
# one again once the heartbeat file below goes stale. A killed owner
# leaves the mutex abandoned, which still hands it to the next.
$mutex = New-Object System.Threading.Mutex($false, 'Local\claude-push-to-talk')
$isOwner = $false
try { $isOwner = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $isOwner = $true }
if (-not $isOwner) { [Console]::Out.WriteLine('BUSY'); exit 0 }

$heartbeat = Join-Path $env:TEMP 'push-to-talk.alive'
function Write-Heartbeat {
  [IO.File]::WriteAllText($heartbeat, [string][DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
}
Write-Heartbeat

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class PttNative {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
}
"@

$keys = @{
  RightCtrl = 0xA3; RightAlt = 0xA5; RightShift = 0xA1
  F8 = 0x77; F9 = 0x78; F10 = 0x79
  Muhenkan = 0x1D; Henkan = 0x1C
}
$vk = $keys[$Key]
if (-not $vk) { $vk = $keys.RightCtrl }

# The record button's name while idle, and while recording.
$startName = -join [char[]](0x9577,0x62BC,0x3057,0x3057,0x3066,0x9332,0x97F3)
$stopName = -join [char[]](0x97F3,0x58F0,0x5165,0x529B,0x3092,0x505C,0x6B62)

$UIA = [System.Windows.Automation.AutomationElement]
$scope = [System.Windows.Automation.TreeScope]

function Say([string]$line) { [Console]::Out.WriteLine($line); [Console]::Out.Flush() }

$script:window = $null
$isButton = New-Object System.Windows.Automation.PropertyCondition ($UIA::ControlTypeProperty), ([System.Windows.Automation.ControlType]::Button)

function Find-Button([string]$name, [int]$tries = 1) {
  $byName = New-Object System.Windows.Automation.PropertyCondition ($UIA::NameProperty), $name
  for ($attempt = 0; $attempt -lt $tries; $attempt++) {
    if ($attempt -gt 0) { Start-Sleep -Milliseconds 150 }
    if ($null -eq $script:window) {
      $byTitle = New-Object System.Windows.Automation.PropertyCondition ($UIA::NameProperty), 'Claude'
      $script:window = $UIA::RootElement.FindFirst($scope::Children, $byTitle)
      if ($null -eq $script:window) { continue }
    }
    try {
      $button = $script:window.FindFirst($scope::Descendants, $byName)
      if ($null -ne $button) { return $button }
      # The search by name can miss a button that a walk over every
      # button still lists, so walk them too.
      foreach ($each in $script:window.FindAll($scope::Descendants, $isButton)) {
        if ($each.Current.Name -eq $name) { return $each }
      }
    }
    catch { $script:window = $null }  # the window closed; look it up again
  }
  return $null
}

# The app builds its accessibility tree only once something asks for it,
# and a moment later, so a first look can come back empty: look again.
function Toggle-Button([string]$name, [int]$tries) {
  $button = Find-Button $name $tries
  if ($null -eq $button) { return $false }
  $button.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Toggle()
  return $true
}

# What this process sees when the button cannot be found, for debugging.
function Write-Diagnosis {
  $log = Join-Path $env:TEMP 'push-to-talk-diag.txt'
  $out = @("=== $(Get-Date -Format o)")
  try {
    $all = $UIA::RootElement.FindAll($scope::Children, [System.Windows.Automation.Condition]::TrueCondition)
    $out += "top-level windows: $($all.Count)"
    foreach ($w in $all) {
      if ($w.Current.Name -notmatch 'Claude') { continue }
      $buttons = $w.FindAll($scope::Descendants, (New-Object System.Windows.Automation.PropertyCondition ($UIA::ControlTypeProperty), ([System.Windows.Automation.ControlType]::Button)))
      $out += "window [$($w.Current.Name)] pid=$($w.Current.ProcessId) buttons=$($buttons.Count) cached=$($null -ne $script:window -and $script:window.Current.ProcessId -eq $w.Current.ProcessId)"
      foreach ($b in $buttons) { $out += "  btn: $($b.Current.Name)" }
    }
  } catch { $out += "diag error: $($_.Exception.Message)" }
  [IO.File]::AppendAllLines($log, [string[]]$out, [Text.Encoding]::UTF8)
}

# Ask once now, so the tree is there by the first press.
$null = Find-Button $startName 1
Say 'READY'

$isDown = $false
$ticks = 0
while ($true) {
  # About every 3 seconds: tells the other sessions this one has the key.
  if ((++$ticks % 100) -eq 0) { try { Write-Heartbeat } catch {} }

  $isHeld = ([PttNative]::GetAsyncKeyState($vk) -band 0x8000) -ne 0

  if ($isHeld -and -not $isDown) {
    $isDown = $true
    try {
      if (Toggle-Button $startName 10) { Say 'REC' } else { Say 'NOBUTTON'; Write-Diagnosis }
    } catch { Say "ERR $($_.Exception.Message)" }
  }
  elseif (-not $isHeld -and $isDown) {
    $isDown = $false
    try {
      # The app may have stopped by itself already; then there is nothing to do.
      $null = Toggle-Button $stopName 3
      Say 'DONE'
    } catch { Say "ERR $($_.Exception.Message)" }
  }

  Start-Sleep -Milliseconds 30
}
