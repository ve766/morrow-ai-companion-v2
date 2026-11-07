param(
  [int]$DurationMinutes = 10,
  [string]$OutputPath = ""
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MorrowWindowSample {
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
}
"@

$samples = New-Object System.Collections.ArrayList
$iterations = [Math]::Max(1, [int]($DurationMinutes * 12))
for ($i = 0; $i -lt $iterations; $i++) {
  $process = Get-Process Morrow -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if (-not $process) {
    [void]$samples.Add([pscustomobject]@{ at = (Get-Date).ToUniversalTime().ToString('o'); alive = $false; visible = $false; iconic = $false })
    break
  }
  $handle = $process.MainWindowHandle
  [void]$samples.Add([pscustomobject]@{
    at = (Get-Date).ToUniversalTime().ToString('o')
    alive = $true
    pid = $process.Id
    visible = [MorrowWindowSample]::IsWindowVisible($handle)
    iconic = [MorrowWindowSample]::IsIconic($handle)
  })
  Start-Sleep -Seconds 5
}

$visible = ($samples | Where-Object { $_.visible -and -not $_.iconic }).Count
$summary = [pscustomobject]@{
  capturedAt = (Get-Date).ToUniversalTime().ToString('o')
  durationMinutes = $DurationMinutes
  os = [System.Environment]::OSVersion.VersionString
  samples = $samples.Count
  visibleAndRestored = $visible
  hiddenOrMinimized = $samples.Count - $visible
  first = if ($samples.Count -gt 0) { $samples[0].at } else { $null }
  last = if ($samples.Count -gt 0) { $samples[-1].at } else { $null }
  result = if ($samples.Count -gt 0 -and $visible -eq $samples.Count) { 'PASS_VISIBLE_WINDOW' } else { 'BLOCKED_HUMAN_DESKTOP' }
  samplesDetail = $samples
}

if (-not $OutputPath) {
  $root = Join-Path $env:LOCALAPPDATA 'MorrowV2-LocalAcceptance\evidence'
  New-Item -ItemType Directory -Force -Path $root | Out-Null
  $OutputPath = Join-Path $root ('window-visibility-' + (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ') + '.json')
}
$summary | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
$summary | Select-Object durationMinutes, samples, visibleAndRestored, hiddenOrMinimized, result | ConvertTo-Json
Write-Host "evidence=$OutputPath"
