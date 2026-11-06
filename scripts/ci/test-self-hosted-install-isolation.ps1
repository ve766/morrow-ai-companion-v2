# PS 5.1 regression probes for the self-hosted CI install isolation.
#
# These probes never touch a real Morrow installation. Every fixture lives under
# a unique temporary directory and is removed at the end. Run with:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ci/test-self-hosted-install-isolation.ps1

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'self-hosted-ci-helpers.ps1')

$results = New-Object System.Collections.Generic.List[object]
function Record([string]$Name, [string]$Status, [string]$Detail) {
  $results.Add([pscustomobject]@{ name = $Name; status = $Status; detail = $Detail })
  Write-Host ("{0,-6} {1} {2}" -f $Status, $Name, $(if ($Detail) { "($Detail)" } else { '' }))
}
function Assert-True([string]$Name, [bool]$Condition, [string]$Detail = '') {
  if ($Condition) { Record $Name 'PASS' $Detail } else { Record $Name 'FAIL' $Detail }
}
function Assert-Throws([string]$Name, [scriptblock]$Block) {
  try { & $Block | Out-Null; Record $Name 'FAIL' 'expected a throw, none happened' }
  catch { Record $Name 'PASS' $_.Exception.Message }
}
function Get-Hash([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }

$root = Join-Path ([System.IO.Path]::GetTempPath()) ("morrow ci probe " + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $root | Out-Null
$env:STUB_OUT = Join-Path $root 'stub-out.txt'

try {
  # 1. NSIS argument keeps spaces and the required /D ordering.
  $spaceTarget = Join-Path $root 'run dir with spaces\installed-app'
  $argument = Get-NsisInstallArgument $spaceTarget
  Assert-True 'nsis-argument-spaces' ($argument -eq "/S /D=$spaceTarget") $argument
  Assert-True 'nsis-argument-no-quotes' (-not $argument.Contains('"')) 'no quote characters'

  # 2. The raw argument string reaches a child process intact.
  $stub = Join-Path $root 'argument stub.cmd'
  Set-Content -LiteralPath $stub -Value @('@echo off', 'echo %* > "%STUB_OUT%"', 'exit /b 3')
  $raw = Invoke-ProcessWithTimeout -FilePath $stub -Arguments $argument -WorkingDirectory $root -TimeoutSeconds 30
  $observed = if (Test-Path -LiteralPath $env:STUB_OUT) { (Get-Content -LiteralPath $env:STUB_OUT -Raw).Trim() } else { '' }
  Assert-True 'raw-argument-exit-code' ($raw.ExitCode -eq 3) "exit=$($raw.ExitCode)"
  Assert-True 'raw-argument-preserved' ($observed -eq $argument) $observed

  # 2b. Captured step runner propagates real exit codes on PS 5.1.
  $capOut = Join-Path $root 'capture-node.out'
  $capErr = Join-Path $root 'capture-node.err'
  $nodeCapture = Invoke-CapturedProcess -Exe 'node.exe' -Arguments @('--version') -WorkingDirectory $root -StdoutPath $capOut -StderrPath $capErr -TimeoutSeconds 60
  Assert-True 'captured-process-exit-code' ($nodeCapture.ExitCode -eq 0) "exit=$($nodeCapture.ExitCode)"
  Assert-True 'captured-process-output' ($nodeCapture.Output -match '^v\d+\.') $nodeCapture.Output.Trim()
  $exitCapture = Invoke-CapturedProcess -Exe $env:ComSpec -Arguments @('/d', '/s', '/c', 'exit 7') -WorkingDirectory $root -StdoutPath (Join-Path $root 'cap7.out') -StderrPath (Join-Path $root 'cap7.err') -TimeoutSeconds 60
  Assert-True 'captured-process-nonzero' ($exitCapture.ExitCode -eq 7) "exit=$($exitCapture.ExitCode)"
  $timeoutCapture = Invoke-CapturedProcess -Exe $env:ComSpec -Arguments @('/d', '/s', '/c', 'ping -n 30 127.0.0.1 > nul') -WorkingDirectory $root -StdoutPath (Join-Path $root 'capt.out') -StderrPath (Join-Path $root 'capt.err') -TimeoutSeconds 1
  Assert-True 'captured-process-timeout' ($timeoutCapture.TimedOut -and $null -eq $timeoutCapture.ExitCode) "timedOut=$($timeoutCapture.TimedOut)"
  Assert-True 'nsis-process-check-available' (Test-NsisProcessCheckAvailable) 'PowerShell Get-CimInstance usable'

  # 3. A pre-existing install target fails closed and keeps its bytes.
  $runExisting = Join-Path $root 'run-existing'
  $existingTarget = Join-Path $runExisting 'installed-app'
  New-Item -ItemType Directory -Force -Path $existingTarget | Out-Null
  $keep = Join-Path $existingTarget 'keep.txt'
  Set-Content -LiteralPath $keep -Value 'keep-me'
  $keepHash = Get-Hash $keep
  Assert-Throws 'existing-target-fails-closed' { Assert-IsolatedInstallTarget -RunDir $runExisting -InstallDir $existingTarget }
  Assert-True 'existing-target-unchanged' ((Get-Hash $keep) -eq $keepHash) 'byte-identical'

  # 4. Path traversal is rejected.
  $runTraversal = Join-Path $root 'run-traversal'
  New-Item -ItemType Directory -Force -Path $runTraversal | Out-Null
  Assert-Throws 'path-traversal-rejected' { Assert-IsolatedInstallTarget -RunDir $runTraversal -InstallDir (Join-Path $runTraversal '..\outside') }

  # 5. A junction in the target chain is rejected, and cleanup refuses it.
  $outside = Join-Path $root 'outside-target'
  New-Item -ItemType Directory -Force -Path $outside | Out-Null
  Set-Content -LiteralPath (Join-Path $outside 'outside.txt') -Value 'outside'
  $runJunction = Join-Path $root 'run-junction'
  New-Item -ItemType Directory -Force -Path $runJunction | Out-Null
  $junction = Join-Path $runJunction 'linked'
  & cmd.exe /c mklink /J "$junction" "$outside" 2>&1 | Out-Null
  Assert-True 'junction-created' (Test-Path -LiteralPath $junction) $junction
  Assert-Throws 'junction-target-rejected' { Assert-IsolatedInstallTarget -RunDir $runJunction -InstallDir (Join-Path $junction 'installed-app') }
  $junctionCleanup = Remove-IsolatedPaths -RunDir $runJunction -RelativePaths @('linked')
  Assert-True 'junction-cleanup-refused' ($junctionCleanup.Status -eq 'CLEANUP_FAILED') ($junctionCleanup.Errors -join '; ')
  Assert-True 'junction-outside-intact' (Test-Path -LiteralPath (Join-Path $outside 'outside.txt')) 'outside content kept'
  $dangling = Join-Path $runJunction 'dangling'
  & cmd.exe /c mklink /J "$dangling" "$root\does-not-exist" 2>&1 | Out-Null
  $danglingItem = Get-Item -LiteralPath $dangling -Force -ErrorAction SilentlyContinue
  Assert-True 'dangling-junction-created' ($danglingItem -and (($danglingItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) 'reparse attribute present'
  Assert-Throws 'dangling-junction-target-rejected' { Assert-IsolatedInstallTarget -RunDir $runJunction -InstallDir (Join-Path $dangling 'installed-app') }

  # 6. A fixture old user installation is never read, launched, changed or deleted.
  $oldInstall = Join-Path $root 'user profile\AppData\Local\Programs\Morrow'
  New-Item -ItemType Directory -Force -Path $oldInstall | Out-Null
  $oldExe = Join-Path $oldInstall 'Morrow.exe'
  Set-Content -LiteralPath $oldExe -Value 'OLD-USER-INSTALL'
  $oldSentinel = Join-Path $oldInstall 'sentinel.bin'
  Set-Content -LiteralPath $oldSentinel -Value 'sentinel'
  $oldExeHash = Get-Hash $oldExe
  $oldSentinelHash = Get-Hash $oldSentinel
  $runOld = Join-Path $root 'run-old'
  New-Item -ItemType Directory -Force -Path $runOld | Out-Null
  Assert-Throws 'old-install-target-rejected' { Assert-IsolatedInstallTarget -RunDir $runOld -InstallDir (Join-Path $oldInstall 'installed-app') }
  $oldCleanup = Remove-IsolatedPaths -RunDir $runOld -RelativePaths @('..\user profile\AppData\Local\Programs\Morrow')
  Assert-True 'old-install-cleanup-rejected' ($oldCleanup.Status -eq 'CLEANUP_FAILED') ($oldCleanup.Errors -join '; ')
  Assert-True 'old-install-exe-unchanged' ((Get-Hash $oldExe) -eq $oldExeHash) 'byte-identical'
  Assert-True 'old-install-sentinel-unchanged' ((Get-Hash $oldSentinel) -eq $oldSentinelHash) 'byte-identical'
  Assert-True 'old-install-file-count' (@(Get-ChildItem -LiteralPath $oldInstall -File).Count -eq 2) 'no files added'

  # 7. Normal cleanup removes only the run children and is idempotent.
  $runClean = Join-Path $root 'run-clean'
  $cleanInstall = Join-Path $runClean 'installed-app'
  $cleanProfile = Join-Path $runClean 'smoke-profile'
  New-Item -ItemType Directory -Force -Path $cleanInstall, $cleanProfile | Out-Null
  Set-Content -LiteralPath (Join-Path $cleanInstall 'Morrow.exe') -Value 'fake'
  Set-Content -LiteralPath (Join-Path $cleanProfile 'profile.db') -Value 'fake'
  $cleanup1 = Remove-IsolatedPaths -RunDir $runClean -RelativePaths @('installed-app', 'smoke-profile')
  Assert-True 'cleanup-success' ($cleanup1.Status -eq 'PASS' -and $cleanup1.RemovedPaths.Count -eq 2) ($cleanup1.RemovedPaths -join ',')
  Assert-True 'cleanup-removed-targets' (-not (Test-Path -LiteralPath $cleanInstall) -and -not (Test-Path -LiteralPath $cleanProfile)) 'both gone'
  $cleanup2 = Remove-IsolatedPaths -RunDir $runClean -RelativePaths @('installed-app', 'smoke-profile')
  Assert-True 'cleanup-idempotent' ($cleanup2.Status -eq 'PASS' -and $cleanup2.RemovedPaths.Count -eq 0) 'second pass no-op'

  # 8. A locked file produces CLEANUP_FAILED and keeps the directory.
  $runLocked = Join-Path $root 'run-locked'
  $lockedInstall = Join-Path $runLocked 'installed-app'
  New-Item -ItemType Directory -Force -Path $lockedInstall | Out-Null
  $lockedFile = Join-Path $lockedInstall 'locked.bin'
  Set-Content -LiteralPath $lockedFile -Value 'locked'
  $handle = [System.IO.File]::Open($lockedFile, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::None)
  try {
    $lockedCleanup = Remove-IsolatedPaths -RunDir $runLocked -RelativePaths @('installed-app')
    Assert-True 'cleanup-locked-file-fails' ($lockedCleanup.Status -eq 'CLEANUP_FAILED') ($lockedCleanup.Errors -join '; ')
    Assert-True 'cleanup-locked-file-kept' (Test-Path -LiteralPath $lockedInstall) 'directory kept for inspection'
  } finally {
    $handle.Close()
  }

  # 9. Uninstaller discovery uses the real file name and rejects ambiguity.
  $runUninstall = Join-Path $root 'run-uninstall'
  $uninstallDir = Join-Path $runUninstall 'installed-app'
  New-Item -ItemType Directory -Force -Path $uninstallDir | Out-Null
  Copy-Item -LiteralPath $env:ComSpec -Destination (Join-Path $uninstallDir 'Uninstall Morrow.exe')
  $found = Get-Uninstaller $uninstallDir
  Assert-True 'uninstaller-discovered' ($found -like '*Uninstall Morrow.exe') $found
  Copy-Item -LiteralPath $env:ComSpec -Destination (Join-Path $uninstallDir 'Uninstall Extra.exe')
  Assert-Throws 'uninstaller-ambiguous-rejected' { Get-Uninstaller $uninstallDir }

  # 10. Uninstaller exit code and timeout are surfaced.
  $uninstallStub = Join-Path $root 'uninstall stub.cmd'
  Set-Content -LiteralPath $uninstallStub -Value @('@echo off', 'exit /b 5')
  $uninstallResult = Invoke-IsolatedUninstall -InstallDir $uninstallDir -UninstallerPath $uninstallStub -TimeoutSeconds 30
  Assert-True 'uninstall-exit-code' ($uninstallResult.ExitCode -eq 5 -and -not $uninstallResult.TimedOut) "exit=$($uninstallResult.ExitCode)"
  $timeoutStub = Join-Path $root 'timeout stub.cmd'
  Set-Content -LiteralPath $timeoutStub -Value @('@echo off', 'ping -n 30 127.0.0.1 > nul')
  $timeoutResult = Invoke-IsolatedUninstall -InstallDir $uninstallDir -UninstallerPath $timeoutStub -TimeoutSeconds 1
  Assert-True 'uninstall-timeout-surfaced' ($timeoutResult.TimedOut -and $null -eq $timeoutResult.ExitCode) "timedOut=$($timeoutResult.TimedOut)"

  # 11. Redaction covers header, JSON, assignment and token forms; benign text survives.
  $sentinel = 'FAKE_SENTINEL_9f7a3c'
  $secretText = @(
    "Authorization: Bearer $sentinel",
    "{`"authorization`":`"Bearer $sentinel`"}",
    '{"apiKey":"FAKE VALUE WITH SPACES"}',
    "api_key=$sentinel",
    "token: $sentinel",
    "refresh_token=$sentinel",
    "client_secret=$sentinel",
    "password=$sentinel",
    "secret: $sentinel",
    'ghp_aaaaaaaaaaaaaaaaaaaaaaaa',
    ('s' + 'k-' + 'abcdefghijklmnop'),
    'ordinary diagnostic text'
  ) -join "`n"
  $redacted = Redact-Text $secretText
  Assert-True 'redaction-removes-sentinel' (-not $redacted.Contains($sentinel)) 'sentinel absent'
  Assert-True 'redaction-removes-spaced-value' (-not $redacted.Contains('FAKE VALUE WITH SPACES')) 'spaced JSON value absent'
  Assert-True 'redaction-keeps-benign-text' ($redacted.Contains('ordinary diagnostic text')) 'benign line kept'
  Assert-True 'redaction-marks-values' ($redacted.Contains('[REDACTED]')) 'placeholder present'
  Assert-True 'redaction-residual-clean' (@(Test-RedactionResidual $redacted).Count -eq 0) 'second pass clean'
  Assert-True 'redaction-residual-detects-raw' (@(Test-RedactionResidual $secretText).Count -gt 0) 'raw text detected'

  # 12. Evidence archive accepts only fresh files from the allowed root.
  $allowed = Join-Path $root 'repo\docs\ui\evidence'
  $source = Join-Path $allowed 'run-1'
  New-Item -ItemType Directory -Force -Path $source | Out-Null
  $oldEvidence = Join-Path $source 'old.png'
  Set-Content -LiteralPath $oldEvidence -Value 'old'
  (Get-Item -LiteralPath $oldEvidence).LastWriteTimeUtc = (Get-Date).ToUniversalTime().AddHours(-2)
  $newEvidence = Join-Path $source 'new.png'
  Set-Content -LiteralPath $newEvidence -Value 'new'
  $destination = Join-Path $root 'archive\screenshots\run-1'
  $entries = @(Copy-ArchiveEvidence -SourceRoot $source -DestinationRoot $destination -RunStart (Get-Date).ToUniversalTime().AddMinutes(-5) -AllowedRoot $allowed)
  Assert-True 'evidence-fresh-only' ($entries.Count -eq 1 -and $entries[0].source -like '*new.png') "entries=$($entries.Count)"
  Assert-True 'evidence-hash-recorded' ($entries[0].sha256 -eq (Get-Hash $newEvidence)) $entries[0].sha256
  Assert-Throws 'evidence-outside-root-rejected' { Copy-ArchiveEvidence -SourceRoot $root -DestinationRoot $destination -RunStart (Get-Date).AddMinutes(-5) -AllowedRoot $allowed }
  $evidenceJunction = Join-Path $allowed 'run-junction-evidence'
  $outsideEvidence = Join-Path $root 'outside-evidence'
  New-Item -ItemType Directory -Force -Path $evidenceJunction, $outsideEvidence | Out-Null
  Set-Content -LiteralPath (Join-Path $outsideEvidence 'outside.png') -Value 'outside'
  & cmd.exe /c mklink /J "$evidenceJunction\nested" "$outsideEvidence" 2>&1 | Out-Null
  Assert-Throws 'evidence-nested-junction-rejected' { Copy-ArchiveEvidence -SourceRoot $evidenceJunction -DestinationRoot (Join-Path $root 'archive\screenshots\junction') -RunStart (Get-Date).AddMinutes(-5) -AllowedRoot $allowed }

  # 13. Installer selection ignores stale installers and records the fresh one.
  $fakeRepo = Join-Path $root 'fake-repo'
  $fakeRelease = Join-Path $fakeRepo 'release'
  New-Item -ItemType Directory -Force -Path $fakeRelease | Out-Null
  $staleInstaller = Join-Path $fakeRelease 'Morrow-Setup-1.0.0-x64.exe'
  Set-Content -LiteralPath $staleInstaller -Value 'stale'
  (Get-Item -LiteralPath $staleInstaller).LastWriteTimeUtc = (Get-Date).ToUniversalTime().AddHours(-2)
  Assert-Throws 'stale-installer-rejected' { Get-FreshInstaller -Repo $fakeRepo -RunStart (Get-Date).ToUniversalTime().AddMinutes(-5) }
  $freshInstaller = Join-Path $fakeRelease 'Morrow-Setup-2.0.0-x64.exe'
  Set-Content -LiteralPath $freshInstaller -Value 'fresh'
  $selected = Get-FreshInstaller -Repo $fakeRepo -RunStart (Get-Date).ToUniversalTime().AddMinutes(-5)
  Assert-True 'fresh-installer-selected' ($selected.Name -eq 'Morrow-Setup-2.0.0-x64.exe') $selected.Name
  Assert-True 'fresh-installer-hash' ($selected.Sha256 -eq (Get-Hash $freshInstaller)) $selected.Sha256
  $ciRelease = Join-Path $fakeRepo 'release-ci'
  New-Item -ItemType Directory -Force -Path $ciRelease | Out-Null
  $ciInstaller = Join-Path $ciRelease 'Morrow-CI-Setup-2.0.0-x64.exe'
  Set-Content -LiteralPath $ciInstaller -Value 'ci-fresh'
  $ciSelected = Get-FreshInstaller -Repo $fakeRepo -RunStart (Get-Date).ToUniversalTime().AddMinutes(-5) -RelativeDirectory 'release-ci' -Pattern 'Morrow-CI-Setup-*.exe'
  Assert-True 'ci-installer-selected' ($ciSelected.Name -eq 'Morrow-CI-Setup-2.0.0-x64.exe') $ciSelected.Name
  Assert-Throws 'ci-installer-not-in-release' { Get-FreshInstaller -Repo $fakeRepo -RunStart (Get-Date).ToUniversalTime().AddMinutes(-5) -RelativeDirectory 'release' -Pattern 'Morrow-CI-Setup-*.exe' }

  # 14. Installed executable lookup is exact and never scans a tree.
  $exactDir = Join-Path $root 'exact-install'
  $nestedDir = Join-Path $exactDir 'nested\other'
  New-Item -ItemType Directory -Force -Path $nestedDir | Out-Null
  Set-Content -LiteralPath (Join-Path $nestedDir 'Morrow.exe') -Value 'nested'
  Assert-Throws 'installed-exe-no-recursive-scan' { Get-InstalledExecutable -InstallDir $exactDir }
  Copy-Item -LiteralPath $env:ComSpec -Destination (Join-Path $exactDir 'Morrow.exe')
  $exact = Get-InstalledExecutable -InstallDir $exactDir
  Assert-True 'installed-exe-exact-path' ($exact.FullName -eq (Join-Path $exactDir 'Morrow.exe')) $exact.FullName
  Assert-Throws 'installed-version-mismatch-rejected' { Assert-InstalledVersion -ExePath $exact.FullName -ExpectedVersion '2.0.0' }

  # 15. The runner script contains no recursive user-install discovery.
  $runnerText = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'run-self-hosted-ci.ps1') -Raw
  Assert-True 'runner-no-recursive-morrow-scan' (-not ($runnerText -match 'Get-ChildItem[^\r\n]*-Recurse[^\r\n]*Morrow\.exe')) 'no recursive exe scan'
  Assert-True 'runner-no-localappdata-program-scan' (-not ($runnerText -match 'LOCALAPPDATA[^\r\n]*Programs')) 'no LOCALAPPDATA program scan'
  Assert-True 'runner-builds-ci-installer' ($runnerText -match 'Morrow-CI-Setup-' -and $runnerText -match 'release-ci') 'CI-only installer variant wired'
  Assert-True 'runner-installs-ci-variant' ($runnerText -match 'Invoke-IsolatedInstall -InstallerPath \$installer\.FullName') 'only the CI variant is installed'
  Assert-True 'runner-unique-nsis-guid' ($runnerText -match '-c\.nsis\.guid=') 'unique GUID isolates uninstall keys'
  Assert-True 'runner-ci-artifact-name-wins' ($runnerText -match '-c\.win\.artifactName=Morrow-CI-Setup-') 'win.artifactName overrides build.win.artifactName'
  # 16. Unique run directory: atomic creation, reuse rejected, old bytes unchanged.
  $uniqueRoot = Join-Path $root 'archive-unique'
  $fixedStamp = '20260101T000000Z'
  $fixedRunId = 'a' * 32
  $uniqueInfo = New-UniqueRunDirectory -ArchiveRoot $uniqueRoot -Sha ('b' * 40) -RunId $fixedRunId -Stamp $fixedStamp
  Assert-True 'run-dir-created' (Test-Path -LiteralPath $uniqueInfo.RunDir -PathType Container) $uniqueInfo.RunDir
  Assert-True 'run-dir-subdirs' ((@('logs', 'results', 'results\transcripts', 'installers', 'screenshots') | ForEach-Object { Test-Path -LiteralPath (Join-Path $uniqueInfo.RunDir $_) } | Where-Object { -not $_ }).Count -eq 0) 'all subdirectories exist'
  $uniqueMarker = Join-Path $uniqueInfo.RunDir 'logs\marker.txt'
  Set-Content -LiteralPath $uniqueMarker -Value 'keep-unique'
  $uniqueMarkerHash = Get-Hash $uniqueMarker
  $uniqueMarkerTime = (Get-Item -LiteralPath $uniqueMarker).LastWriteTimeUtc
  Assert-Throws 'run-dir-reuse-rejected' { New-UniqueRunDirectory -ArchiveRoot $uniqueRoot -Sha ('b' * 40) -RunId $fixedRunId -Stamp $fixedStamp }
  Assert-True 'run-dir-old-bytes-unchanged' ((Get-Hash $uniqueMarker) -eq $uniqueMarkerHash) 'marker byte-identical'
  Assert-True 'run-dir-old-timestamp-unchanged' ((Get-Item -LiteralPath $uniqueMarker).LastWriteTimeUtc -eq $uniqueMarkerTime) 'marker timestamp unchanged'

  $preRoot = Join-Path $root 'archive-preexisting'
  $preRun = Join-Path $preRoot "$fixedStamp-$('c' * 40)-$fixedRunId"
  New-Item -ItemType Directory -Force -Path $preRun | Out-Null
  $preFile = Join-Path $preRun 'keep.txt'
  Set-Content -LiteralPath $preFile -Value 'keep-preexisting'
  $preHash = Get-Hash $preFile
  Assert-Throws 'run-dir-preexisting-rejected' { New-UniqueRunDirectory -ArchiveRoot $preRoot -Sha ('c' * 40) -RunId $fixedRunId -Stamp $fixedStamp }
  Assert-True 'run-dir-preexisting-unchanged' ((Get-Hash $preFile) -eq $preHash) 'pre-existing bytes unchanged'

  Assert-Throws 'run-dir-sha-traversal-rejected' { New-UniqueRunDirectory -ArchiveRoot $uniqueRoot -Sha '..\evil' -RunId $fixedRunId -Stamp $fixedStamp }
  $junctionRoot = Join-Path $root 'archive-junction'
  New-Item -ItemType Directory -Force -Path $junctionRoot | Out-Null
  $junctionTarget = Join-Path $root 'junction-outside-run'
  New-Item -ItemType Directory -Force -Path $junctionTarget | Out-Null
  Set-Content -LiteralPath (Join-Path $junctionTarget 'outside.txt') -Value 'outside'
  $junctionRun = Join-Path $junctionRoot "$fixedStamp-$('d' * 40)-$fixedRunId"
  & cmd.exe /c mklink /J "$junctionRun" "$junctionTarget" 2>&1 | Out-Null
  Assert-Throws 'run-dir-junction-rejected' { New-UniqueRunDirectory -ArchiveRoot $junctionRoot -Sha ('d' * 40) -RunId $fixedRunId -Stamp $fixedStamp }
  Assert-True 'run-dir-junction-outside-intact' (Test-Path -LiteralPath (Join-Path $junctionTarget 'outside.txt')) 'outside kept'

  # 17. Manifest finalization: PASS only when README, checksums and manifest all succeed.
  $archiveNormal = Join-Path $root 'archive-normal'
  New-Item -ItemType Directory -Force -Path $archiveNormal | Out-Null
  Set-Content -LiteralPath (Join-Path $archiveNormal 'result.json') -Value '{"ok":true}'
  $normalManifest = [pscustomobject]@{ status = 'PASS'; failedStage = $null; exitCode = 0; runId = 'r1'; sha = 's1' }
  $normalResult = Complete-RunArchive -RunDir $archiveNormal -Manifest $normalManifest -ReadmeText 'normal run'
  $normalParsed = Get-Content -LiteralPath (Join-Path $archiveNormal 'run-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  Assert-True 'manifest-normal-pass' ($normalResult.Status -eq 'PASS' -and $normalParsed.status -eq 'PASS' -and [int]$normalParsed.exitCode -eq 0) "status=$($normalResult.Status)"
  $normalChecksumPath = Join-Path $archiveNormal 'checksums.sha256'
  Assert-True 'manifest-normal-checksum-hash' ($normalParsed.archive.checksumsFileSha256 -eq (Get-Hash $normalChecksumPath)) $normalParsed.archive.checksumsFileSha256
  $normalChecksumText = Get-Content -LiteralPath $normalChecksumPath -Raw
  Assert-True 'manifest-normal-no-cycle' (-not $normalChecksumText.Contains('run-manifest.json') -and -not $normalChecksumText.Contains('checksums.sha256')) 'manifest and checksum file excluded'

  $archiveReadmeFault = Join-Path $root 'archive-readme-fault'
  New-Item -ItemType Directory -Force -Path $archiveReadmeFault | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $archiveReadmeFault 'README.txt') | Out-Null
  $readmeFaultManifest = [pscustomobject]@{ status = 'PASS'; failedStage = $null; exitCode = 0 }
  $readmeFaultResult = Complete-RunArchive -RunDir $archiveReadmeFault -Manifest $readmeFaultManifest -ReadmeText 'x'
  $readmeFaultParsed = Get-Content -LiteralPath (Join-Path $archiveReadmeFault 'run-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  Assert-True 'manifest-readme-failure' ($readmeFaultResult.Status -eq 'FAILED' -and $readmeFaultResult.FailedStage -eq 'readme' -and $readmeFaultParsed.status -eq 'FAILED' -and [int]$readmeFaultParsed.exitCode -eq 1) "status=$($readmeFaultResult.Status) stage=$($readmeFaultResult.FailedStage)"

  $archiveChecksumFault = Join-Path $root 'archive-checksum-fault'
  New-Item -ItemType Directory -Force -Path $archiveChecksumFault | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $archiveChecksumFault 'checksums.sha256') | Out-Null
  $checksumFaultManifest = [pscustomobject]@{ status = 'PASS'; failedStage = $null; exitCode = 0 }
  $checksumFaultResult = Complete-RunArchive -RunDir $archiveChecksumFault -Manifest $checksumFaultManifest -ReadmeText 'x'
  $checksumFaultParsed = Get-Content -LiteralPath (Join-Path $archiveChecksumFault 'run-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  Assert-True 'manifest-checksum-failure' ($checksumFaultResult.Status -eq 'FAILED' -and $checksumFaultResult.FailedStage -eq 'checksums' -and $checksumFaultParsed.status -eq 'FAILED') "status=$($checksumFaultResult.Status) stage=$($checksumFaultResult.FailedStage)"

  $archiveManifestFault = Join-Path $root 'archive-manifest-fault'
  New-Item -ItemType Directory -Force -Path $archiveManifestFault | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $archiveManifestFault 'run-manifest.json.tmp') | Out-Null
  $manifestFaultManifest = [pscustomobject]@{ status = 'PASS'; failedStage = $null; exitCode = 0 }
  $manifestFaultResult = Complete-RunArchive -RunDir $archiveManifestFault -Manifest $manifestFaultManifest -ReadmeText 'x'
  $manifestFaultPath = Join-Path $archiveManifestFault 'run-manifest.json'
  $manifestFaultPass = $false
  if (Test-Path -LiteralPath $manifestFaultPath -PathType Leaf) {
    $manifestFaultPass = ((Get-Content -LiteralPath $manifestFaultPath -Raw -Encoding UTF8 | ConvertFrom-Json).status -eq 'PASS')
  }
  Assert-True 'manifest-write-failure' ($manifestFaultResult.Status -eq 'FAILED' -and $manifestFaultResult.FailedStage -eq 'manifest' -and -not $manifestFaultPass) "status=$($manifestFaultResult.Status) stage=$($manifestFaultResult.FailedStage)"

  $archiveFailedManifest = [pscustomobject]@{ status = 'FAILED'; failedStage = 'archive'; exitCode = 1 }
  $archiveFailedRun = Join-Path $root 'archive-failed'
  New-Item -ItemType Directory -Force -Path $archiveFailedRun | Out-Null
  $archiveFailedResult = Complete-RunArchive -RunDir $archiveFailedRun -Manifest $archiveFailedManifest -ReadmeText 'x'
  $archiveFailedParsed = Get-Content -LiteralPath (Join-Path $archiveFailedRun 'run-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  Assert-True 'manifest-archive-failure-preserved' ($archiveFailedResult.Status -eq 'FAILED' -and $archiveFailedParsed.failedStage -eq 'archive' -and [int]$archiveFailedParsed.exitCode -eq 1) "status=$($archiveFailedResult.Status)"

  # 18. Process tree ownership and bounded termination.
  $fakeInstall = Join-Path $root 'fake-install'
  New-Item -ItemType Directory -Force -Path $fakeInstall | Out-Null
  $fakeExe = Join-Path $fakeInstall 'Morrow.exe'
  Copy-Item -LiteralPath (Get-Process -Id $PID).Path -Destination $fakeExe
  $started = @()
  $sleepOutside = $null
  try {
    $rootProcess = Start-Process -FilePath $fakeExe -ArgumentList '-NoProfile -Command "Start-Sleep -Seconds 30"' -PassThru
    $started += $rootProcess.Id
    $owned = @(Get-OwnedProcesses -InstallDir $fakeInstall -Since (Get-Date).AddSeconds(-10))
    Assert-True 'process-tree-owned-root' (@($owned | Where-Object ProcessId -eq $rootProcess.Id).Count -eq 1) "owned=$($owned.Count)"
    $treeResult = Stop-OwnedProcessTree -Owned $owned -InstallDir $fakeInstall -GraceSeconds 0
    Assert-True 'process-tree-stopped' ($treeResult.Remaining.Count -eq 0 -and $treeResult.Errors.Count -eq 0) ($treeResult.Errors -join '; ')
    $rootExited = $false
    try { $rootExited = $rootProcess.WaitForExit(5000) } catch { $rootExited = $false }
    Assert-True 'process-tree-root-gone' ($rootExited -or $rootProcess.HasExited) 'root exited'

    $childScript = Join-Path $root 'spawn-child.ps1'
    Set-Content -LiteralPath $childScript -Value @(
      ("Start-Process -FilePath '" + $fakeExe + "' -ArgumentList '-NoProfile -Command `"Start-Sleep -Seconds 30`"'"),
      'Start-Sleep -Seconds 1'
    )
    $parentProcess = Start-Process -FilePath $fakeExe -ArgumentList ("-NoProfile -File `"$childScript`"") -PassThru
    $started += $parentProcess.Id
    Start-Sleep -Seconds 3
    $childOwned = @(Get-OwnedProcesses -InstallDir $fakeInstall -Since (Get-Date).AddSeconds(-15))
    Assert-True 'process-tree-child-owned' ($childOwned.Count -ge 1) "owned=$($childOwned.Count)"
    $childStop = Stop-OwnedProcessTree -Owned $childOwned -InstallDir $fakeInstall -GraceSeconds 0
    Assert-True 'process-tree-child-stopped' ($childStop.Remaining.Count -eq 0) ($childStop.Errors -join '; ')
    $started = @($started | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })

    $sleepOutside = Start-Process -FilePath (Get-Process -Id $PID).Path -ArgumentList '-NoProfile -Command "Start-Sleep -Seconds 30"' -PassThru
    $started += $sleepOutside.Id
    $notOwned = @(Get-OwnedProcesses -InstallDir $fakeInstall -Since (Get-Date).AddSeconds(-10))
    Assert-True 'process-tree-user-process-not-owned' (@($notOwned | Where-Object ProcessId -eq $sleepOutside.Id).Count -eq 0) "owned=$($notOwned.Count)"

    $fakeRecord = [pscustomobject]@{ ProcessId = $PID; ParentProcessId = 0; Name = 'powershell.exe'; ExecutablePath = (Join-Path $fakeInstall 'Morrow.exe'); CreationDate = $null; Reason = 'install-path' }
    Assert-True 'process-tree-pid-path-mismatch' (-not (Test-ProcessRecordOwned -Record $fakeRecord -InstallDir $fakeInstall)) 'foreign path not owned'
    $mismatchStop = Stop-OwnedProcessTree -Owned @($fakeRecord) -InstallDir $fakeInstall -GraceSeconds 0
    Assert-True 'process-tree-no-mismatch-kill' ($null -ne (Get-Process -Id $PID -ErrorAction SilentlyContinue)) 'current process alive'

    $denyProcess = Start-Process -FilePath $fakeExe -ArgumentList '-NoProfile -Command "Start-Sleep -Seconds 30"' -PassThru
    $started += $denyProcess.Id
    Start-Sleep -Milliseconds 500
    $denyOwned = @(Get-OwnedProcesses -InstallDir $fakeInstall -Since (Get-Date).AddSeconds(-10) | Where-Object ProcessId -eq $denyProcess.Id)
    $denyResult = Stop-OwnedProcessTree -Owned $denyOwned -InstallDir $fakeInstall -GraceSeconds 0 -StopAction { param($id) throw [System.UnauthorizedAccessException]::new('denied for probe') }
    Assert-True 'process-tree-access-denied' ($denyResult.Errors.Count -gt 0 -and $denyResult.Remaining.Count -gt 0) ($denyResult.Errors -join '; ')
    Stop-Process -Id $denyProcess.Id -Force -ErrorAction SilentlyContinue
    $started = @($started | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })

    $timeoutProcess = Start-Process -FilePath $fakeExe -ArgumentList '-NoProfile -Command "Start-Sleep -Seconds 30"' -PassThru
    $started += $timeoutProcess.Id
    Start-Sleep -Milliseconds 500
    $timeoutOwned = @(Get-OwnedProcesses -InstallDir $fakeInstall -Since (Get-Date).AddSeconds(-10) | Where-Object ProcessId -eq $timeoutProcess.Id)
    $timeoutResult = Stop-OwnedProcessTree -Owned $timeoutOwned -InstallDir $fakeInstall -GraceSeconds 0 -StopAction { param($id) }
    Assert-True 'process-tree-timeout-remaining' ($timeoutResult.Errors.Count -gt 0 -and $timeoutResult.Remaining.Count -gt 0) ($timeoutResult.Errors -join '; ')
    Stop-Process -Id $timeoutProcess.Id -Force -ErrorAction SilentlyContinue
    $started = @($started | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
  } finally {
    foreach ($processId in $started) { Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue }
    if ($sleepOutside) { Stop-Process -Id $sleepOutside.Id -Force -ErrorAction SilentlyContinue }
  }

  # 19. Runner static wiring for the three fixes.
  Assert-True 'runner-unique-run-dir' ($runnerText -match 'New-UniqueRunDirectory') 'uses atomic unique run dir'
  Assert-True 'runner-no-run-dir-force' ($runnerText -notmatch 'New-Item[^\r\n]*-ItemType Directory[^\r\n]*-Force[^\r\n]*\$runDir') 'no -Force on run dir'
  Assert-True 'runner-finalizer' ($runnerText -match 'Complete-RunArchive') 'single finalizer'
  Assert-True 'runner-process-tree' ($runnerText -match 'Get-OwnedProcesses' -and $runnerText -match 'Stop-OwnedProcessTree') 'process tree cleanup wired'
  Assert-True 'runner-no-name-taskkill' ($runnerText -notmatch 'taskkill[^\r\n]*/IM') 'no name-based taskkill'
  Assert-True 'runner-manifest-exit-code' ($runnerText -match 'exitCode') 'manifest records exit code'

} finally {
  if (Test-Path -LiteralPath $root) {
    try { Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction Stop } catch { Write-Host "probe cleanup warning: $($_.Exception.Message)" }
  }
}

$failed = @($results | Where-Object { $_.status -eq 'FAIL' })
$passed = @($results | Where-Object { $_.status -eq 'PASS' })
Write-Host ''
Write-Host ("probe summary: passed={0} failed={1} total={2}" -f $passed.Count, $failed.Count, $results.Count)
if ($failed.Count -gt 0) {
  $failed | ForEach-Object { Write-Host ("FAILED: {0} ({1})" -f $_.name, $_.detail) }
  exit 1
}
exit 0
