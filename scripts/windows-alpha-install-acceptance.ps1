$ErrorActionPreference = 'Stop'
$repository = (Get-Location).Path
$smokeProfile = Join-Path $env:RUNNER_TEMP "morrow-alpha-profile-$PID"
$installDirectory = Join-Path $env:RUNNER_TEMP "morrow-alpha-install-$PID"
$releaseDirectory = Join-Path $repository 'release'
$appDataRoot = Join-Path $smokeProfile 'AppData'
$env:APPDATA = Join-Path $appDataRoot 'Roaming'
$env:LOCALAPPDATA = Join-Path $appDataRoot 'Local'
$env:MORROW_SMOKE_PROFILE = $smokeProfile
$env:MORROW_SMOKE_EXECUTABLE = Join-Path $installDirectory 'Morrow.exe'
New-Item -ItemType Directory -Path $env:APPDATA, $env:LOCALAPPDATA, $installDirectory -Force | Out-Null

function Invoke-Npm {
  param([string[]]$Arguments)
  & npm @Arguments
  if ($LASTEXITCODE -ne 0) { throw "npm failed: $($Arguments -join ' ')" }
}

function Invoke-Node {
  param([string[]]$Arguments)
  & node @Arguments
  if ($LASTEXITCODE -ne 0) { throw "node failed: $($Arguments -join ' ')" }
}

function Find-Setup {
  param([string]$Version)
  $setup = Join-Path $releaseDirectory "Morrow-Setup-$Version-x64.exe"
  if (-not (Test-Path -LiteralPath $setup -PathType Leaf)) { throw "NSIS installer not found for $Version." }
  return $setup
}

function Invoke-Setup {
  param([string]$SetupPath)
  $process = Start-Process -FilePath $SetupPath -ArgumentList @('/S', "/D=$installDirectory") -PassThru -Wait
  if ($process.ExitCode -ne 0) { throw "NSIS install/update failed with exit code $($process.ExitCode)." }
  $deadline = [DateTime]::UtcNow.AddSeconds(20)
  while (-not (Test-Path -LiteralPath $env:MORROW_SMOKE_EXECUTABLE -PathType Leaf) -and [DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 250
  }
  if (-not (Test-Path -LiteralPath $env:MORROW_SMOKE_EXECUTABLE -PathType Leaf)) { throw 'Installed Morrow.exe was not created.' }
}

$firstVersion = '0.1.0-alpha.1'
$updateVersion = '0.1.0-alpha.2'

Invoke-Npm @('version', $firstVersion, '--no-git-tag-version')
Invoke-Npm @('run', 'package:win')
$firstSetup = Find-Setup $firstVersion
$firstSetupCopy = Join-Path $env:RUNNER_TEMP "Morrow-Setup-$firstVersion-x64.exe"
Copy-Item -LiteralPath $firstSetup -Destination $firstSetupCopy -Force

Write-Output "Installing $firstVersion into an isolated per-user directory."
Invoke-Setup $firstSetupCopy
$env:MORROW_SMOKE_EXPECT_VERSION = $firstVersion
Write-Output 'Running the installed app through renderer, preload, IPC, SQLite, UI controls, and restart smoke.'
Invoke-Npm @('run', 'smoke')
Invoke-Node @('scripts/verify-alpha-smoke-profile.mjs', $smokeProfile)

$runningMorrow = Get-Process -Name 'Morrow' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $env:MORROW_SMOKE_EXECUTABLE }
if ($runningMorrow) { $runningMorrow | Stop-Process -Force }
Remove-Item -LiteralPath $releaseDirectory -Recurse -Force -ErrorAction SilentlyContinue
Invoke-Npm @('version', $updateVersion, '--no-git-tag-version')
Invoke-Npm @('run', 'package:win')
$updateSetup = Find-Setup $updateVersion

Write-Output "Updating the installed profile from $firstVersion to $updateVersion."
Invoke-Setup $updateSetup
$env:MORROW_SMOKE_EXPECT_VERSION = $updateVersion
Invoke-Node @('scripts/smoke.mjs', '--verify-upgrade')
Invoke-Node @('scripts/verify-alpha-smoke-profile.mjs', $smokeProfile)

$uninstaller = Get-ChildItem -LiteralPath $installDirectory -File -Filter '*Uninstall*.exe' | Select-Object -First 1
if (-not $uninstaller) { throw 'The installed NSIS uninstaller was not found.' }
$uninstall = Start-Process -FilePath $uninstaller.FullName -ArgumentList @('/S') -PassThru -Wait
if ($uninstall.ExitCode -ne 0) { throw "NSIS uninstall failed with exit code $($uninstall.ExitCode)." }
if (Test-Path -LiteralPath $env:MORROW_SMOKE_EXECUTABLE) { throw 'Morrow.exe remained after uninstall.' }
Invoke-Node @('scripts/verify-alpha-smoke-profile.mjs', $smokeProfile)
Write-Output 'Windows Alpha acceptance passed: isolated NSIS install, real app launch and restart, opt-in/state replay, deletion and failed-clear rollback, successful cognitive clear, in-place update, SQLite integrity, and post-uninstall user-data retention.'

Remove-Item Env:MORROW_SMOKE_EXECUTABLE -ErrorAction SilentlyContinue
Remove-Item Env:MORROW_SMOKE_PROFILE -ErrorAction SilentlyContinue
Remove-Item Env:MORROW_SMOKE_EXPECT_VERSION -ErrorAction SilentlyContinue
