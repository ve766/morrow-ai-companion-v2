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

$startedAt = (Get-Date).ToUniversalTime().ToString('o')
$runStartUtc = [datetime]::Parse($startedAt).ToUniversalTime()
$runId = [guid]::NewGuid().ToString('N')
$ciIdentity = New-CiInstallerIdentity -RunId $runId
$runInfo = New-UniqueRunDirectory -ArchiveRoot $ArchiveRoot -Sha $sha -RunId $runId
$runDir = $runInfo.RunDir
$logsDir = Join-Path $runDir 'logs'
$resultsDir = Join-Path $runDir 'results'
$transcriptsDir = Join-Path $runDir 'results\transcripts'
$installersDir = Join-Path $runDir 'installers'
$screenshotsDir = Join-Path $runDir 'screenshots'
Write-AtomicJson (Join-Path $runDir 'run-identity.json') ([pscustomobject]@{
  runId = $runId
  ciAppId = $ciIdentity.AppId
  ciNsisGuid = $ciIdentity.NsisGuid
  runDir = $runDir
  archiveRoot = $runInfo.ArchiveRoot
  expectedSha = $ExpectedSha
  actualSha = $sha
  startedAt = $startedAt
  status = 'RUNNING'
  note = 'Non-terminal. run-manifest.json is authoritative.'
})

$steps = [System.Collections.Generic.List[object]]::new()
$failure = $null
$failedStage = $null
$installer = $null
$releaseInstaller = $null
$installerHash = $null
$nodeReported = $null
$npmReported = $null
$redactionBlocked = $false
$installDir = Join-Path $runDir 'installed-app'
$installAttempted = $false
$installResult = $null
$installedInfo = $null
$smokeProfile = Join-Path $runDir 'smoke-profile'
$smokeStartedAt = $null
$processTree = [pscustomobject]@{
  status = 'NOT_REQUIRED'
  ownedCount = 0
  records = @()
  stopped = @()
  remaining = @()
  errors = @()
}
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
  $captured = Invoke-CapturedProcess -Exe $Exe -Arguments $Arguments -WorkingDirectory $repo `
    -StdoutPath $stdout -StderrPath $stderr -TimeoutSeconds $TimeoutSeconds
  $raw = $captured.Output
  $timedOut = $captured.TimedOut
  $code = $captured.ExitCode
  Remove-Item -LiteralPath $stdout, $stderr -Force -ErrorAction SilentlyContinue
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
  New-Item -ItemType Directory -Path $smokeProfile -ErrorAction Stop | Out-Null
  $env:MORROW_SMOKE_PROFILE = $smokeProfile
  Invoke-CiStep 'electron-smoke' 'npm.cmd' @('run', 'smoke') 900
  Invoke-CiStep 'product-path-smoke' 'npm.cmd' @('run', 'smoke:product-path') 1200
  Invoke-CiStep 'persistence-migration-tests' 'npx.cmd' @('vitest', 'run', 'src/persistence') 600
  Invoke-CiStep 'windows-nsis-package' 'npm.cmd' @('run', 'package:win') 1800
  $releaseInstaller = Get-FreshInstaller -Repo $repo -RunStart $runStartUtc -RelativeDirectory 'release' -Pattern 'Morrow-Setup-*.exe'
  # The user-facing installer must never be executed here: electron-builder's
  # NSIS calls uninstallOldVersion for the appId-derived GUID before installing,
  # which could uninstall an existing Morrow installation even with /D=.
  Invoke-CiStep 'windows-nsis-ci-package' 'npx.cmd' (Get-CiInstallerArguments -Identity $ciIdentity) 1800
  $installer = Get-FreshInstaller -Repo $repo -RunStart $runStartUtc -RelativeDirectory 'release-ci' -Pattern 'Morrow-CI-Setup-*.exe'
  $installerHash = $installer.Sha256
  if (-not (Test-NsisProcessCheckAvailable)) {
    throw 'NSIS would fall back to name-based taskkill; refusing to install on this host.'
  }
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
  $smokeStartedAt = (Get-Date).ToUniversalTime().AddSeconds(-1)
  Invoke-CiStep 'installed-app-smoke' 'node.exe' @('scripts/smoke.mjs', '--verify-upgrade') 1200
} catch {
  $failure = $_.Exception.Message
  if (-not $failedStage) { $failedStage = 'execution' }
} finally {
  try {
    if ($installedInfo -and $smokeStartedAt) {
      try {
        $owned = @(Get-OwnedProcesses -InstallDir $installDir -Since $smokeStartedAt)
        $processTree.ownedCount = $owned.Count
        $processTree.records = @($owned)
        if ($owned.Count -gt 0) {
          $stop = Stop-OwnedProcessTree -Owned $owned -InstallDir $installDir -GraceSeconds 5
          $processTree.stopped = @($stop.Stopped)
          $processTree.remaining = @($stop.Remaining)
          $processTree.errors = @($stop.Errors)
          $still = @(Get-OwnedProcesses -InstallDir $installDir -Since $smokeStartedAt)
          if ($still.Count -gt 0) {
            $processTree.remaining = @($still)
            $processTree.errors = @($processTree.errors + "Process tree still has $($still.Count) process(es).")
          }
        }
        if ($processTree.errors.Count -gt 0) { $processTree.status = 'CLEANUP_FAILED' } else { $processTree.status = 'PASS' }
      } catch {
        $processTree.status = 'CLEANUP_FAILED'
        $processTree.errors = @($processTree.errors + "Process tree cleanup failed: $($_.Exception.Message)")
      }
    }
    $uninstallErrors = @()
    $treeOk = $processTree.status -ne 'CLEANUP_FAILED'
    if ($installAttempted -and (Test-Path -LiteralPath $installDir) -and $treeOk) {
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
    } elseif ($installAttempted -and -not $treeOk) {
      $uninstallErrors += 'Uninstall skipped: process tree was not confirmed stopped.'
    }
    $relativePaths = @('smoke-profile')
    if ($uninstallErrors.Count -eq 0 -and $treeOk) { $relativePaths = @('installed-app', 'smoke-profile') }
    $removal = Remove-IsolatedPaths -RunDir $runDir -RelativePaths $relativePaths
    $cleanup.removedPaths = @($removal.RemovedPaths)
    $cleanup.errors = @($uninstallErrors + $removal.Errors)
    if ($uninstallErrors.Count -gt 0 -or $removal.Status -eq 'CLEANUP_FAILED' -or -not $treeOk) {
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
    $failedStage = 'cleanup'
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
      if ($releaseInstaller -and (Test-Path -LiteralPath $releaseInstaller.FullName)) {
        Copy-Item -LiteralPath $releaseInstaller.FullName -Destination (Join-Path $installersDir $releaseInstaller.Name) -Force
        Write-Utf8NoBom (Join-Path $installersDir "$($releaseInstaller.Name).sha256") $releaseInstaller.Sha256
      }
    } catch {
      if (-not $failure) { $failure = "Archive collection failed: $($_.Exception.Message)"; $failedStage = 'archive' }
    }
  } elseif (-not $failure) {
    $failure = 'Redaction residual blocked archiving.'
    $failedStage = 'redaction'
  }

  try { Pop-Location } catch { if (-not $failure) { $failure = "Pop-Location failed: $($_.Exception.Message)"; $failedStage = 'location' } }

  $status = 'PASS'
  if ($cleanup.status -eq 'CLEANUP_FAILED') {
    $status = 'CLEANUP_FAILED'
    $failedStage = 'cleanup'
  } elseif ($failure) {
    $status = 'FAILED'
  }
  if ($status -ne 'PASS' -and -not $failedStage) { $failedStage = 'execution' }

  $finishedAt = (Get-Date).ToUniversalTime().ToString('o')
  $manifest = [pscustomobject]@{
    repo = 've766/morrow-ai-companion-v2'
    ref = $env:GITHUB_REF
    runId = $runId
    ciAppId = $ciIdentity.AppId
    nsisGuid = $ciIdentity.NsisGuid
    runDir = $runDir
    archiveRoot = $runInfo.ArchiveRoot
    sha = $sha
    expectedSha = $ExpectedSha
    actualSha = $sha
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
    status = $status
    failedStage = $failedStage
    exitCode = $(if ($status -eq 'PASS') { 0 } else { 1 })
    steps = $steps
    installation = [pscustomobject]@{
      target = $installDir
      installer = if ($installer) { $installer.Name } else { $null }
      installerSha256 = $installerHash
      releaseInstaller = if ($releaseInstaller) { $releaseInstaller.Name } else { $null }
      releaseInstallerSha256 = if ($releaseInstaller) { $releaseInstaller.Sha256 } else { $null }
      installExitCode = if ($installResult) { $installResult.ExitCode } else { $null }
      installedExe = if ($installedInfo) { $installedInfo.FullName } else { $null }
      installedExeSha256 = if ($installedInfo) { $installedInfo.Sha256 } else { $null }
      installedVersion = if ($installedInfo) { $installedInfo.ProductVersion } else { $null }
      smokeProfile = $smokeProfile
    }
    processTree = $processTree
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
  }

  $readme = @(
    'Morrow V2 self-hosted CI run',
    "Run ID: $runId",
    "CI appId: $($ciIdentity.AppId) CI NSIS GUID: $($ciIdentity.NsisGuid)",
    "SHA: $sha",
    "Started: $startedAt",
    "Finished: $finishedAt",
    "Status: see run-manifest.json (authoritative)",
    "Provisional status at archive time: $status",
    "Failed stage: $failedStage",
    "Failure: $($failure)",
    "Installer (CI variant): $($installer.Name) $($installerHash)",
    "Release installer (not executed): $($releaseInstaller.Name) $($releaseInstaller.Sha256)",
    "Install target: $installDir",
    "Process tree: $($processTree.status) owned=$($processTree.ownedCount) remaining=$(@($processTree.remaining).Count)",
    "Cleanup: $($cleanup.status) (uninstaller exit $($cleanup.uninstallerExitCode))",
    '',
    'Steps:',
    (($steps | ForEach-Object { "  $($_.name): exit $($_.exitCode) timedOut=$($_.timedOut) -> $($_.log)" }) -join "`n"),
    '',
    'The NSIS install target is a new child of this run directory; no existing user installation is searched, launched, modified or uninstalled.',
    'The archive contains only files produced by this run. checksums.sha256 lists every archive file except run-manifest.json and itself; the manifest records the checksum file SHA256.',
    'No GitHub Actions artifact upload was performed; storage usage is unchanged.'
  ) -join "`n"

  try {
    $archiveResult = Complete-RunArchive -RunDir $runDir -Manifest $manifest -ReadmeText $readme
  } catch {
    $archiveResult = [pscustomobject]@{ Status = 'FAILED'; FailedStage = 'manifest'; Errors = @($_.Exception.Message) }
    try { Write-Utf8NoBom (Join-Path $runDir 'finalization-error.txt') $_.Exception.Message } catch { }
  }
  if ($archiveResult.Status -ne 'PASS' -and $archiveResult.FailedStage -eq 'manifest') {
    try {
      Write-Utf8NoBom (Join-Path $runDir 'finalization-error.txt') (($archiveResult.Errors) -join "`r`n")
    } catch { }
  }
  Write-Host "archive=$runDir"
  Write-Host "status=$($archiveResult.Status) stage=$($archiveResult.FailedStage)"
}

if ($archiveResult.Status -ne 'PASS') { exit 1 }
exit 0
