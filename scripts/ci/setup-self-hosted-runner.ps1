param(
  [string]$RunnerRoot = (Join-Path $env:LOCALAPPDATA 'Morrow\Runner')
)

$ErrorActionPreference = 'Stop'

Write-Host 'Morrow self-hosted runner preflight (no token is read or stored by this script).'
if ($env:OS -ne 'Windows_NT') { throw 'This guide targets Windows x64.' }
if ($env:PROCESSOR_ARCHITECTURE -notin @('AMD64', 'ARM64')) { throw 'A 64-bit Windows process is required.' }
if ($PSVersionTable.PSVersion.Major -lt 5) { throw 'PowerShell 5.1 or newer is required.' }

$node = (node --version)
$npm = (npm --version)
if ([int]($node.TrimStart('v').Split('.')[0]) -lt 22) { throw "Node 22+ is required; found $node." }
$git = (git --version)
Write-Host "node=$node npm=$npm git=$git"
Write-Host "runnerRoot=$RunnerRoot"

New-Item -ItemType Directory -Force -Path $RunnerRoot, (Join-Path $RunnerRoot '_work') | Out-Null
$free = (Get-Item $RunnerRoot).PSDrive.Free
if ($free -lt 5GB) { Write-Warning "Less than 5 GB free on the runner volume; builds may fail." }

Write-Host ''
Write-Host 'NEXT (perform interactively in the GitHub UI; never paste the token into a chat or repository):'
Write-Host '1. Open https://github.com/ve766/morrow-ai-companion-v2/settings/actions/runners/new'
Write-Host '2. Choose Windows x64 and download the runner archive from that page.'
Write-Host '3. Verify the archive hash shown by GitHub, then extract it under the runner root.'
Write-Host '4. Run config.cmd interactively and paste the short-lived registration token only into that prompt.'
Write-Host '5. Use labels: self-hosted, Windows, X64, morrow-ci (add morrow-ci when asked).'
Write-Host '6. Run run.cmd interactively once, or install the service with svc.cmd install/start.'
Write-Host '7. Confirm the runner is Idle/Online in Settings -> Actions -> Runners.'
Write-Host ''
Write-Host 'Do not run the runner as an administrator or as a shared organization runner.'
Write-Host 'The workflow only runs on manual workflow_dispatch from ve766 on the allowed branch, or on a ci-self-hosted-<sha> tag.'
