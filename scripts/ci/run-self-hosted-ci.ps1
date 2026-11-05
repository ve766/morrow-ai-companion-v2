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
$installerHash = $null
$nodeReported = $null
$npmReported = $null

function Redact-Text([string]$Text) {
  $Text = [regex]::Replace($Text, '(?i)(authorization:\s*(?:bearer|token|basic)\s+)\S+', '$1[REDACTED]')
  $Text = [regex]::Replace($Text, 'sk-[A-Za-z0-9_-]{10,}', '[REDACTED]')
  $Text = [regex]::Replace($Text, 'gh[pousr]_[A-Za-z0-9]{20,}', '[REDACTED]')
  $Text = [regex]::Replace($Text, 'github_pat_[A-Za-z0-9_]{20,}', '[REDACTED]')
  $Text = [regex]::Replace($Text, '(?i)("?(?:api[_-]?key|apikey|authorization|token|access[_-]?token|refresh[_-]?token)"?\s*[:=]\s*")[^"]*(")', '$1[REDACTED]$2')
  $Text = [regex]::Replace($Text, '(?i)("?(?:api[_-]?key|apikey|authorization|token|access[_-]?token|refresh[_-]?token)"?\s*[:=]\s*''?)(?!(?:bearer|token|basic)\b)[^\s"'',}]+', '$1[REDACTED]')
  return $Text
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  [System.IO.File]::WriteAllText($Path, $Content, (New-Object System.Text.UTF8Encoding($false)))
}

function Invoke-CiStep([string]$Name, [string]$Exe, [string[]]$Arguments) {
  $safeName = ($Name -replace '[^A-Za-z0-9._-]', '-').ToLowerInvariant()
  $log = Join-Path $logsDir ("{0:D2}-{1}.log" -f ($steps.Count + 1), $safeName)
  $start = (Get-Date).ToUniversalTime()
  Write-Host "==> $Name"
  $output = (& $Exe @Arguments 2>&1 | Out-String)
  $code = $LASTEXITCODE
  $end = (Get-Date).ToUniversalTime()
  $redacted = Redact-Text $output
  Write-Utf8NoBom $log $redacted
  Write-Host $redacted
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
  $nodeVersion = (& node.exe --version).Trim()
  $nodeReported = $nodeVersion
  if ([int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 22) {
    throw "Node 22+ is required; found $nodeVersion"
  }
  $npmReported = (& npm.cmd --version).Trim()
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
  $smokeProfile = Join-Path $runDir 'smoke-profile'
  New-Item -ItemType Directory -Force -Path $smokeProfile | Out-Null
  $env:MORROW_SMOKE_PROFILE = $smokeProfile
  Invoke-CiStep 'electron-smoke' 'npm.cmd' @('run', 'smoke')
  Invoke-CiStep 'product-path-smoke' 'npm.cmd' @('run', 'smoke:product-path')
  Invoke-CiStep 'persistence-migration-tests' 'npx.cmd' @('vitest', 'run', 'src/persistence')
  Invoke-CiStep 'windows-nsis-package' 'npm.cmd' @('run', 'package:win')
  $installer = Get-ChildItem (Join-Path $repo 'release') -Filter 'Morrow-Setup-*.exe' -File |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $installer) { throw 'NSIS installer was not produced.' }
  $installProcess = Start-Process -FilePath $installer.FullName -ArgumentList '/S' -PassThru
  if (-not $installProcess.WaitForExit(180000)) {
    $installProcess.Kill()
    throw 'NSIS installer did not finish within 180 seconds.'
  }
  if ($installProcess.ExitCode -ne 0) { throw "NSIS installer exited with $($installProcess.ExitCode)." }
  $installedCandidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Morrow\Morrow.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\morrow-ai-companion-v2\Morrow.exe')
  ) | Where-Object { Test-Path $_ }
  if (-not $installedCandidates) {
    $installedCandidates = Get-ChildItem -Path $env:LOCALAPPDATA -Recurse -Filter 'Morrow.exe' -ErrorAction SilentlyContinue |
      Select-Object -First 1 -ExpandProperty FullName
  }
  if (-not $installedCandidates) { throw 'Installed Morrow executable was not found.' }
  $installedExe = @($installedCandidates)[0]
  $env:MORROW_SMOKE_EXECUTABLE = $installedExe
  $env:MORROW_SMOKE_EXPECT_VERSION = '2.0.0'
  Invoke-CiStep 'installed-app-smoke' 'node.exe' @('scripts/smoke.mjs', '--verify-upgrade')
} catch {
  $failure = $_.Exception.Message
} finally {
  try {
    $runStart = [datetime]::Parse($startedAt).ToUniversalTime()
    $evidenceRoot = Join-Path $repo 'docs\ui\evidence'
    if (Test-Path $evidenceRoot) {
      $latest = Get-ChildItem $evidenceRoot -Directory |
        Where-Object { Get-ChildItem $_.FullName -Recurse -File | Where-Object { $_.LastWriteTimeUtc -ge $runStart } } |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
      if ($latest) {
        $dest = Join-Path $screenshotsDir $latest.Name
        Get-ChildItem $latest.FullName -Recurse -File |
          Where-Object { $_.LastWriteTimeUtc -ge $runStart } | ForEach-Object {
            $relative = $_.FullName.Substring($latest.FullName.Length).TrimStart('\')
            $target = Join-Path $dest $relative
            New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
            Copy-Item -Force $_.FullName $target
          }
      }
    }
    $resultsSource = Join-Path $repo 'evals\morrow-v2-final\results'
    $transcriptsSource = Join-Path $repo 'evals\morrow-v2-final\transcripts'
    if (Test-Path $resultsSource) {
      Get-ChildItem $resultsSource -File |
        Where-Object { $_.LastWriteTimeUtc -ge $runStart } |
        Sort-Object LastWriteTime -Descending | Select-Object -First 5 |
        Copy-Item -Destination $resultsDir -Force
    }
    if (Test-Path $transcriptsSource) {
      Get-ChildItem $transcriptsSource -File |
        Where-Object { $_.LastWriteTimeUtc -ge $runStart } |
        Sort-Object LastWriteTime -Descending | Select-Object -First 5 |
        Copy-Item -Destination $resultsDir -Force
    }
    $installer = Get-ChildItem (Join-Path $repo 'release') -Filter 'Morrow-Setup-*.exe' -File -ErrorAction SilentlyContinue |
      Where-Object { $_.LastWriteTimeUtc -ge $runStart } |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($installer) {
      Copy-Item -Force $installer.FullName (Join-Path $installersDir $installer.Name)
      $installerHash = (Get-FileHash $installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
      Write-Utf8NoBom (Join-Path $installersDir "$($installer.Name).sha256") $installerHash
    }
  } catch {
    if (-not $failure) { $failure = "Archive collection failed: $($_.Exception.Message)" }
  }

  $finishedAt = (Get-Date).ToUniversalTime().ToString('o')
  try {
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
      node = $nodeReported
      npm = $npmReported
      actor = $env:GITHUB_ACTOR
      triggeringActor = $env:GITHUB_TRIGGERING_ACTOR
      startedAt = $startedAt
      finishedAt = $finishedAt
      steps = $steps
      installerSha256 = $installerHash
      failure = $failure
      status = if ($failure) { 'FAILED' } else { 'PASS' }
    }
    $manifest | ConvertTo-Json -Depth 8 | ForEach-Object { Write-Utf8NoBom (Join-Path $runDir 'run-manifest.json') $_ }

    $readme = @(
      'Morrow V2 self-hosted CI run',
      "SHA: $sha",
      "Started: $startedAt",
      "Finished: $finishedAt",
      "Status: $($manifest.status)",
      "Failure: $($failure)",
      "Installer SHA256: $installerHash",
      '',
      'Steps:',
      (($steps | ForEach-Object { "  $($_.name): exit $($_.exitCode) -> $($_.log)" }) -join "`n"),
      '',
      'Archive contains logs, machine results, installer (if produced), screenshots (if produced), and checksums.',
      'No GitHub Actions artifact upload was performed; storage usage is unchanged.'
    ) -join "`n"
    Write-Utf8NoBom (Join-Path $runDir 'README.txt') $readme

    $checksumLines = Get-ChildItem $runDir -Recurse -File | Where-Object { $_.Name -ne 'checksums.sha256' } | ForEach-Object {
      $relative = $_.FullName.Substring($runDir.Length).TrimStart('\')
      "$((Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()) *$relative"
    }
    Write-Utf8NoBom (Join-Path $runDir 'checksums.sha256') (($checksumLines) -join "`r`n")
  } catch {
    if (-not $failure) { $failure = "Manifest/checksum write failed: $($_.Exception.Message)" }
    Write-Host "ARCHIVE-ERROR: $($_.Exception.Message)"
  }

  Write-Host "archive=$runDir"
  if ($failure) { Write-Host "FAILED: $failure" }
  try { Pop-Location } catch { Write-Host "POP-LOCATION-ERROR: $($_.Exception.Message)" }
}

if ($failure) { exit 1 }
exit 0
