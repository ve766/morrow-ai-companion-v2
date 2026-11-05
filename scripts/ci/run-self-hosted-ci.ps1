param(
  [Parameter(Mandatory = $true)]
  [string]$ExpectedSha,
  [string]$ArchiveRoot = (Join-Path $env:LOCALAPPDATA 'Morrow\CI')
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'self-hosted-ci-helpers.ps1')

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$sha = (& git -C $repo rev-parse HEAD).Trim()
if ($sha -ne $ExpectedSha.Trim()) {
  throw "Checkout SHA mismatch: expected $ExpectedSha, got $sha"
}

$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$runDir = Get-NormalizedPath (Join-Path $ArchiveRoot "$stamp-$sha")
$logsDir = Join-Path $runDir 'logs'
$resultsDir = Join-Path $runDir 'results'
$transcriptsDir = Join-Path $runDir 'results\transcripts'
$installersDir = Join-Path $runDir 'installers'
$screenshotsDir = Join-Path $runDir 'screenshots'
New-Item -ItemType Directory -Force -Path $logsDir, $resultsDir, $transcriptsDir, $installersDir, $screenshotsDir | Out-Null

$steps = [System.Collections.Generic.List[object]]::new()
$failure = $null
$startedAt = (Get-Date).ToUniversalTime().ToString('o')
$runStartUtc = [datetime]::Parse($startedAt).ToUniversalTime()
$installer = $null
$installerHash = $null
$nodeReported = $null
$npmReported = $null
$redactionBlocked = $false
$installDir = Join-Path $runDir 'installed-app'
$installAttempted = $false
$installResult = $null
$installedInfo = $null
$smokeProfile = Join-Path $runDir 'smoke-profile'
$cleanup = [pscustomobject]@{
  status = 'NOT_REQUIRED'
  uninstaller = $null
  uninstallerExitCode = $null
  removedPaths = @()
  errors = @()
}
$evidence = [pscustomobject]@{
  screenshots = @()
  results = @()
  transcripts = @()
}

function Invoke-CiStep([string]$Name, [string]$Exe, [string[]]$Arguments, [int]$TimeoutSeconds = 3600) {
  $safeName = ($Name -replace '[^A-Za-z0-9._-]', '-').ToLowerInvariant()
  $log = Join-Path $logsDir ("{0:D2}-{1}.log" -f ($steps.Count + 1), $safeName)
  $stdout = Join-Path $logsDir ("{0:D2}-{1}.stdout.tmp" -f ($steps.Count + 1), $safeName)
  $stderr = Join-Path $logsDir ("{0:D2}-{1}.stderr.tmp" -f ($steps.Count + 1), $safeName)
  $start = (Get-Date).ToUniversalTime()
  Write-Host "==> $Name"
  $file = $Exe
  $argumentString = $Arguments -join ' '
  if ($Exe -match '\.(cmd|bat)$') {
    $file = $env:ComSpec
    $argumentString = '/d /s /c "' + $Exe + ' ' + $argumentString + '"'
  }
  $process = Start-Process -FilePath $file -ArgumentList $argumentString -WorkingDirectory $repo `
    -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -NoNewWindow
  $timedOut = $false
  if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    $timedOut = $true
    & taskkill.exe /PID $process.Id /T /F 2>&1 | Out-Null
    try { $process.WaitForExit(10000) | Out-Null } catch { }
  }
  $raw = ''
  if (Test-Path -LiteralPath $stdout) { $raw += (Get-Content -LiteralPath $stdout -Raw) }
  if (Test-Path -LiteralPath $stderr) { $raw += (Get-Content -LiteralPath $stderr -Raw) }
  Remove-Item -LiteralPath $stdout, $stderr -Force -ErrorAction SilentlyContinue
  $code = $null
  if (-not $timedOut) { try { $code = $process.ExitCode } catch { $code = $null } }
  $end = (Get-Date).ToUniversalTime()
  $redacted = Redact-Text $raw
  if (@(Test-RedactionResidual $redacted).Count -gt 0) {
    Write-Utf8NoBom $log "[REDACTION FAILURE: output of '$Name' was suppressed.]"
    $script:redactionBlocked = $true
    $steps.Add([pscustomobject]@{
      name = $Name
      command = "$Exe $($Arguments -join ' ')"
      exitCode = $code
      timedOut = $timedOut
      startedAt = $start.ToString('o')
      finishedAt = $end.ToString('o')
      log = (Split-Path $log -Leaf)
    })
    throw "Redaction residual detected in step '$Name'; output suppressed and archiving blocked."
  }
  Write-Utf8NoBom $log $redacted
  Write-Host $redacted
  $steps.Add([pscustomobject]@{
    name = $Name
    command = "$Exe $($Arguments -join ' ')"
    exitCode = $code
    timedOut = $timedOut
    startedAt = $start.ToString('o')
    finishedAt = $end.ToString('o')
    log = (Split-Path $log -Leaf)
  })
  if ($timedOut) { throw "Step '$Name' timed out after $TimeoutSeconds seconds." }
  if ($code -ne 0) { throw "Step '$Name' failed with exit code $code" }
}

try {
  Push-Location $repo
  $nodeVersion = (& node.exe --version).Trim()
  $nodeReported = $nodeVersion
  if ([int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 22) {
    throw "Node 22+ is required; found $nodeVersion"
  }
  $npmReported = (& npm.cmd --version).Trim()
  Invoke-CiStep 'node-version' 'node.exe' @('--version') 120
  Invoke-CiStep 'npm-version' 'npm.cmd' @('--version') 120
  Invoke-CiStep 'git-head' 'git.exe' @('rev-parse', 'HEAD') 120
  Invoke-CiStep 'install-dependencies' 'npm.cmd' @('ci', '--no-audit', '--no-fund') 1800
  if (-not (Test-Path (Join-Path $repo 'node_modules\electron\dist\electron.exe'))) {
    Invoke-CiStep 'install-electron-binary' 'node.exe' @('node_modules/electron/install.js') 900
  }
  if (Test-Path (Join-Path $repo 'node_modules\better-sqlite3')) {
    Invoke-CiStep 'rebuild-better-sqlite3' 'npm.cmd' @('rebuild', 'better-sqlite3') 900
  }
  Invoke-CiStep 'typecheck' 'npm.cmd' @('run', 'typecheck') 600
  Invoke-CiStep 'full-tests' 'npm.cmd' @('test') 1800
  Invoke-CiStep 'offline-evaluation' 'npm.cmd' @('run', 'evaluate') 600
  Invoke-CiStep 'cognitive-evaluation' 'npm.cmd' @('run', 'evaluate:cognition') 600
  Invoke-CiStep 'build' 'npm.cmd' @('run', 'build') 900
  New-Item -ItemType Directory -Force -Path $smokeProfile | Out-Null
  $env:MORROW_SMOKE_PROFILE = $smokeProfile
  Invoke-CiStep 'electron-smoke' 'npm.cmd' @('run', 'smoke') 900
  Invoke-CiStep 'product-path-smoke' 'npm.cmd' @('run', 'smoke:product-path') 1200
  Invoke-CiStep 'persistence-migration-tests' 'npx.cmd' @('vitest', 'run', 'src/persistence') 600
  Invoke-CiStep 'windows-nsis-package' 'npm.cmd' @('run', 'package:win') 1800

  $installer = Get-FreshInstaller -Repo $repo -RunStart $runStartUtc
  $installerHash = $installer.Sha256
  $installDir = Assert-IsolatedInstallTarget -RunDir $runDir -InstallDir $installDir
  $installAttempted = $true
  $installResult = Invoke-IsolatedInstall -InstallerPath $installer.FullName -InstallDir $installDir -TimeoutSeconds 180
  if ($installResult.TimedOut) { throw 'NSIS installer timed out after 180 seconds.' }
  if ($installResult.ExitCode -ne 0) { throw "NSIS installer exited with $($installResult.ExitCode)." }

  $installedInfo = Get-InstalledExecutable -InstallDir $installDir
  $packageVersion = (Get-Content -LiteralPath (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json).version
  Assert-InstalledVersion -ExePath $installedInfo.FullName -ExpectedVersion $packageVersion | Out-Null
  $env:MORROW_SMOKE_EXECUTABLE = $installedInfo.FullName
  $env:MORROW_SMOKE_EXPECT_VERSION = $packageVersion
  Invoke-CiStep 'installed-app-smoke' 'node.exe' @('scripts/smoke.mjs', '--verify-upgrade') 1200
} catch {
  $failure = $_.Exception.Message
} finally {
  try {
    if ($installedInfo) {
      $stopped = @(Stop-ProcessesUnderPath -ExecutablePath $installedInfo.FullName)
      if ($stopped.Count -gt 0) { Write-Host "stopped-installed-app-pids=$($stopped -join ',')" }
    }
    $uninstallErrors = @()
    if ($installAttempted -and (Test-Path -LiteralPath $installDir)) {
      try {
        $uninstall = Invoke-IsolatedUninstall -InstallDir $installDir -TimeoutSeconds 180
        $cleanup.uninstaller = $uninstall.Uninstaller
        $cleanup.uninstallerExitCode = $uninstall.ExitCode
        if ($uninstall.TimedOut) {
          $uninstallErrors += 'Uninstaller timed out after 180 seconds.'
        } elseif ($uninstall.ExitCode -ne 0) {
          $uninstallErrors += "Uninstaller exited with $($uninstall.ExitCode)."
        }
      } catch {
        $uninstallErrors += "Uninstall failed: $($_.Exception.Message)"
      }
    }
    $relativePaths = @('smoke-profile')
    if ($uninstallErrors.Count -eq 0) { $relativePaths = @('installed-app', 'smoke-profile') }
    $removal = Remove-IsolatedPaths -RunDir $runDir -RelativePaths $relativePaths
    $cleanup.removedPaths = @($removal.RemovedPaths)
    $cleanup.errors = @($uninstallErrors + $removal.Errors)
    if ($uninstallErrors.Count -gt 0 -or $removal.Status -eq 'CLEANUP_FAILED') {
      $cleanup.status = 'CLEANUP_FAILED'
    } elseif ($installAttempted) {
      $cleanup.status = 'PASS'
    } else {
      $cleanup.status = 'NOT_REQUIRED'
    }
  } catch {
    $cleanup.status = 'CLEANUP_FAILED'
    $cleanup.errors = @($cleanup.errors + $_.Exception.Message)
  }
  if ($cleanup.status -eq 'CLEANUP_FAILED' -and -not $failure) {
    $failure = "Cleanup failed: $($cleanup.errors -join '; ')"
  }

  if (-not $redactionBlocked) {
    try {
      $evidenceRoot = Join-Path $repo 'docs\ui\evidence'
      if (Test-Path -LiteralPath $evidenceRoot) {
        $latest = Get-ChildItem -LiteralPath $evidenceRoot -Directory |
          Where-Object {
            ($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0 -and
            @(Get-ChildItem -LiteralPath $_.FullName -Recurse -File -Force | Where-Object { $_.LastWriteTimeUtc -ge $runStartUtc }).Count -gt 0
          } |
          Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($latest) {
          $evidence.screenshots = @(Copy-ArchiveEvidence -SourceRoot $latest.FullName `
            -DestinationRoot (Join-Path $screenshotsDir $latest.Name) -RunStart $runStartUtc -AllowedRoot $evidenceRoot)
        }
      }
      $resultsSource = Join-Path $repo 'evals\morrow-v2-final\results'
      if (Test-Path -LiteralPath $resultsSource) {
        $evidence.results = @(Copy-ArchiveEvidence -SourceRoot $resultsSource -DestinationRoot $resultsDir `
          -RunStart $runStartUtc -AllowedRoot $resultsSource)
      }
      $transcriptsSource = Join-Path $repo 'evals\morrow-v2-final\transcripts'
      if (Test-Path -LiteralPath $transcriptsSource) {
        $evidence.transcripts = @(Copy-ArchiveEvidence -SourceRoot $transcriptsSource -DestinationRoot $transcriptsDir `
          -RunStart $runStartUtc -AllowedRoot $transcriptsSource)
      }
      if ($installer -and (Test-Path -LiteralPath $installer.FullName)) {
        Copy-Item -LiteralPath $installer.FullName -Destination (Join-Path $installersDir $installer.Name) -Force
        Write-Utf8NoBom (Join-Path $installersDir "$($installer.Name).sha256") $installer.Sha256
      }
    } catch {
      if (-not $failure) { $failure = "Archive collection failed: $($_.Exception.Message)" }
    }
  } elseif (-not $failure) {
    $failure = 'Redaction residual blocked archiving.'
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
      installation = [pscustomobject]@{
        target = $installDir
        installer = if ($installer) { $installer.Name } else { $null }
        installerSha256 = $installerHash
        installExitCode = if ($installResult) { $installResult.ExitCode } else { $null }
        installedExe = if ($installedInfo) { $installedInfo.FullName } else { $null }
        installedExeSha256 = if ($installedInfo) { $installedInfo.Sha256 } else { $null }
        installedVersion = if ($installedInfo) { $installedInfo.ProductVersion } else { $null }
        smokeProfile = $smokeProfile
      }
      cleanup = [pscustomobject]@{
        status = $cleanup.status
        uninstaller = $cleanup.uninstaller
        uninstallerExitCode = $cleanup.uninstallerExitCode
        removedPaths = @($cleanup.removedPaths)
        errors = @($cleanup.errors)
      }
      evidence = [pscustomobject]@{
        screenshots = @($evidence.screenshots)
        results = @($evidence.results)
        transcripts = @($evidence.transcripts)
      }
      redactionResidual = $redactionBlocked
      failure = $failure
      status = if ($failure -or $cleanup.status -eq 'CLEANUP_FAILED') { 'FAILED' } else { 'PASS' }
    }
    $manifest | ConvertTo-Json -Depth 10 | ForEach-Object { Write-Utf8NoBom (Join-Path $runDir 'run-manifest.json') $_ }

    $readme = @(
      'Morrow V2 self-hosted CI run',
      "SHA: $sha",
      "Started: $startedAt",
      "Finished: $finishedAt",
      "Status: $($manifest.status)",
      "Failure: $($failure)",
      "Installer: $($installer.Name) $($installerHash)",
      "Install target: $installDir",
      "Cleanup: $($cleanup.status) (uninstaller exit $($cleanup.uninstallerExitCode))",
      '',
      'Steps:',
      (($steps | ForEach-Object { "  $($_.name): exit $($_.exitCode) timedOut=$($_.timedOut) -> $($_.log)" }) -join "`n"),
      '',
      'The NSIS install target is a new child of this run directory; no existing user installation is searched, launched, modified or uninstalled.',
      'The archive contains only files produced by this run and a SHA256 for every evidence file.',
      'No GitHub Actions artifact upload was performed; storage usage is unchanged.'
    ) -join "`n"
    Write-Utf8NoBom (Join-Path $runDir 'README.txt') $readme

    $checksumLines = Get-ChildItem -LiteralPath $runDir -Recurse -File | Where-Object { $_.Name -ne 'checksums.sha256' } | ForEach-Object {
      $relative = $_.FullName.Substring($runDir.Length).TrimStart('\')
      "$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()) *$relative"
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

if ($failure -or $cleanup.status -eq 'CLEANUP_FAILED') { exit 1 }
exit 0
