param(
  [Parameter(Mandatory = $true)]
  [string]$ExpectedSha,
  [string]$ArchiveRoot = (Join-Path $env:LOCALAPPDATA 'Morrow\CI')
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$sha = (& git -C $repo rev-parse HEAD).Trim()
if ($sha -ne $ExpectedSha.Trim()) {
  throw "Checkout SHA mismatch: expected $ExpectedSha, got $sha"
}

$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$runDir = Join-Path $ArchiveRoot "$stamp-$sha"
$logsDir = Join-Path $runDir 'logs'
$resultsDir = Join-Path $runDir 'results'
$installersDir = Join-Path $runDir 'installers'
$screenshotsDir = Join-Path $runDir 'screenshots'
New-Item -ItemType Directory -Force -Path $logsDir, $resultsDir, $installersDir, $screenshotsDir | Out-Null

$steps = [System.Collections.Generic.List[object]]::new()
$failure = $null
$startedAt = (Get-Date).ToUniversalTime().ToString('o')

function Redact-Log([string]$Path) {
  if (-not (Test-Path $Path)) { return }
  $text = Get-Content -Raw -Path $Path
  $text = [regex]::Replace($text, '(?i)(authorization:\s*bearer\s+)\S+', '$1[REDACTED]')
  $text = [regex]::Replace($text, 'sk-[A-Za-z0-9_-]{10,}', '[REDACTED]')
  $text = [regex]::Replace($text, '(?i)(api[_-]?key\s*[:=]\s*)\S+', '$1[REDACTED]')
  Set-Content -NoNewline -Path $Path -Value $text
}

function Invoke-CiStep([string]$Name, [string]$Exe, [string[]]$Arguments) {
  $safeName = ($Name -replace '[^A-Za-z0-9._-]', '-').ToLowerInvariant()
  $log = Join-Path $logsDir ("{0:D2}-{1}.log" -f ($steps.Count + 1), $safeName)
  $start = (Get-Date).ToUniversalTime()
  Write-Host "==> $Name"
  & $Exe @Arguments 2>&1 | Tee-Object -FilePath $log
  $code = $LASTEXITCODE
  $end = (Get-Date).ToUniversalTime()
  Redact-Log $log
  $steps.Add([pscustomobject]@{
    name = $Name
    command = "$Exe $($Arguments -join ' ')"
    exitCode = $code
    startedAt = $start.ToString('o')
    finishedAt = $end.ToString('o')
    log = (Split-Path $log -Leaf)
  })
  if ($code -ne 0) {
    throw "Step '$Name' failed with exit code $code"
  }
}

try {
  Push-Location $repo
  Invoke-CiStep 'node-version' 'node.exe' @('--version')
  Invoke-CiStep 'npm-version' 'npm.cmd' @('--version')
  Invoke-CiStep 'git-head' 'git.exe' @('rev-parse', 'HEAD')
  Invoke-CiStep 'install-dependencies' 'npm.cmd' @('ci', '--no-audit', '--no-fund')
  if (-not (Test-Path (Join-Path $repo 'node_modules\electron\dist\electron.exe'))) {
    Invoke-CiStep 'install-electron-binary' 'node.exe' @('node_modules/electron/install.js')
  }
  if (Test-Path (Join-Path $repo 'node_modules\better-sqlite3')) {
    Invoke-CiStep 'rebuild-better-sqlite3' 'npm.cmd' @('rebuild', 'better-sqlite3')
  }
  Invoke-CiStep 'typecheck' 'npm.cmd' @('run', 'typecheck')
  Invoke-CiStep 'full-tests' 'npm.cmd' @('test')
  Invoke-CiStep 'offline-evaluation' 'npm.cmd' @('run', 'evaluate')
  Invoke-CiStep 'cognitive-evaluation' 'npm.cmd' @('run', 'evaluate:cognition')
  Invoke-CiStep 'build' 'npm.cmd' @('run', 'build')
  Invoke-CiStep 'electron-smoke' 'npm.cmd' @('run', 'smoke')
  Invoke-CiStep 'product-path-smoke' 'npm.cmd' @('run', 'smoke:product-path')
  Invoke-CiStep 'persistence-migration-tests' 'npx.cmd' @('vitest', 'run', 'src/persistence')
  Invoke-CiStep 'windows-nsis-package' 'npm.cmd' @('run', 'package:win')
} catch {
  $failure = $_.Exception.Message
} finally {
  try {
    $evidenceRoot = Join-Path $repo 'docs\ui\evidence'
    if (Test-Path $evidenceRoot) {
      $latest = Get-ChildItem $evidenceRoot -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1
      if ($latest) {
        Copy-Item -Recurse -Force $latest.FullName (Join-Path $screenshotsDir $latest.Name)
      }
    }
    $resultsSource = Join-Path $repo 'evals\morrow-v2-final\results'
    $transcriptsSource = Join-Path $repo 'evals\morrow-v2-final\transcripts'
    if (Test-Path $resultsSource) {
      Get-ChildItem $resultsSource -File | Sort-Object LastWriteTime -Descending | Select-Object -First 5 |
        Copy-Item -Destination $resultsDir -Force
    }
    if (Test-Path $transcriptsSource) {
      Get-ChildItem $transcriptsSource -File | Sort-Object LastWriteTime -Descending | Select-Object -First 5 |
        Copy-Item -Destination $resultsDir -Force
    }
    $installer = Get-ChildItem (Join-Path $repo 'release') -Filter 'Morrow-Setup-*.exe' -File -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($installer) {
      Copy-Item -Force $installer.FullName (Join-Path $installersDir $installer.Name)
      $installerHash = (Get-FileHash $installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
      Set-Content -NoNewline -Path (Join-Path $installersDir "$($installer.Name).sha256") -Value $installerHash
    }
  } catch {
    if (-not $failure) { $failure = "Archive collection failed: $($_.Exception.Message)" }
  }

  $finishedAt = (Get-Date).ToUniversalTime().ToString('o')
  $manifest = [pscustomobject]@{
    repo = 've766/morrow-ai-companion-v2'
    ref = $env:GITHUB_REF
    sha = $sha
    expectedSha = $ExpectedSha
    runUrl = $env:MORROW_CI_RUN_URL
    runner = [pscustomobject]@{
      name = $env:RUNNER_NAME
      os = $env:RUNNER_OS
      arch = $env:RUNNER_ARCH
      labels = @('self-hosted', 'Windows', 'X64', 'morrow-ci')
    }
    node = (node --version)
    npm = (npm --version)
    actor = $env:GITHUB_ACTOR
    startedAt = $startedAt
    finishedAt = $finishedAt
    steps = $steps
    failure = $failure
    status = if ($failure) { 'FAILED' } else { 'PASS' }
  }
  $manifest | ConvertTo-Json -Depth 8 | Set-Content -Path (Join-Path $runDir 'run-manifest.json') -Encoding UTF8

  $readme = @(
    'Morrow V2 self-hosted CI run',
    "SHA: $sha",
    "Started: $startedAt",
    "Finished: $finishedAt",
    "Status: $($manifest.status)",
    "Failure: $($failure)",
    '',
    'Steps:',
    ($steps | ForEach-Object { "  $($_.name): exit $($_.exitCode) -> $($_.log)" }) -join "`n",
    '',
    'Archive contains logs, machine results, installer (if produced), screenshots (if produced), and checksums.',
    'No GitHub Actions artifact upload was performed; storage usage is unchanged.'
  ) -join "`n"
  Set-Content -Path (Join-Path $runDir 'README.txt') -Value $readme -Encoding UTF8

  $checksumLines = Get-ChildItem $runDir -Recurse -File | Where-Object { $_.Name -ne 'checksums.sha256' } | ForEach-Object {
    $relative = $_.FullName.Substring($runDir.Length).TrimStart('\')
    "$((Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()) *$relative"
  }
  Set-Content -Path (Join-Path $runDir 'checksums.sha256') -Value $checksumLines -Encoding UTF8

  Write-Host "archive=$runDir"
  if ($failure) { Write-Host "FAILED: $failure" }
}

Pop-Location
if ($failure) { exit 1 }
exit 0
