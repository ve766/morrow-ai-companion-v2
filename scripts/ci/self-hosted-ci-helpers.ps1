# Morrow self-hosted CI helpers.
#
# Dot-sourced by scripts/ci/run-self-hosted-ci.ps1 and by the PS 5.1 probes in
# scripts/ci/test-self-hosted-install-isolation.ps1. Everything here must stay
# Windows PowerShell 5.1 compatible. No function may touch a path outside the
# per-run archive directory, and no function may discover or scan an existing
# user installation.

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  [System.IO.File]::WriteAllText($Path, $Content, (New-Object System.Text.UTF8Encoding($false)))
}

function Get-NormalizedPath([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { throw 'Path is empty.' }
  $full = [System.IO.Path]::GetFullPath($Path)
  if ($full.Length -gt 3) { $full = $full.TrimEnd('\') }
  return $full
}

function Test-PathWithin([string]$Child, [string]$Parent) {
  $c = Get-NormalizedPath $Child
  $p = Get-NormalizedPath $Parent
  if ($c.Equals($p, [System.StringComparison]::OrdinalIgnoreCase)) { return $false }
  return $c.StartsWith($p + '\', [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-ReparsePointChain([string]$Path, [string]$StopAt) {
  $current = Get-NormalizedPath $Path
  $stop = Get-NormalizedPath $StopAt
  while ($true) {
    $item = Get-Item -LiteralPath $current -Force -ErrorAction SilentlyContinue
    if ($item) {
      if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { return $true }
    }
    if ($current.Equals($stop, [System.StringComparison]::OrdinalIgnoreCase)) { break }
    $parent = [System.IO.Path]::GetDirectoryName($current)
    if ([string]::IsNullOrEmpty($parent) -or $parent -eq $current) { break }
    if (-not $parent.StartsWith($stop, [System.StringComparison]::OrdinalIgnoreCase)) { break }
    $current = $parent
  }
  return $false
}

function Assert-IsolatedInstallTarget([string]$RunDir, [string]$InstallDir) {
  $runFull = Get-NormalizedPath $RunDir
  $installFull = Get-NormalizedPath $InstallDir
  if (-not (Test-Path -LiteralPath $runFull -PathType Container)) {
    throw "Run directory does not exist: $runFull"
  }
  if (-not (Test-PathWithin -Child $installFull -Parent $runFull)) {
    throw "Install target must be a strict child of the run directory: $installFull"
  }
  $existing = Get-Item -LiteralPath $installFull -Force -ErrorAction SilentlyContinue
  if ($existing) {
    throw "Refusing to reuse an existing install target: $installFull"
  }
  if (Test-ReparsePointChain -Path $installFull -StopAt $runFull) {
    throw "Install target or its run-directory ancestors contain a reparse point: $installFull"
  }
  return $installFull
}

function Get-NsisInstallArgument([string]$InstallDir) {
  $full = Get-NormalizedPath $InstallDir
  if (-not [System.IO.Path]::IsPathRooted($full)) { throw 'NSIS install directory must be absolute.' }
  if ($full.Contains('"')) { throw 'NSIS /D path must not contain quotes.' }
  if ($full -match "[\r\n]") { throw 'NSIS /D path must not contain line breaks.' }
  # NSIS requires /D to be the last parameter and the path must stay unquoted,
  # even when it contains spaces. Returning one raw argument string preserves
  # that rule through Start-Process.
  return "/S /D=$full"
}

function Get-FreshInstaller([string]$Repo, [datetime]$RunStart, [string]$RelativeDirectory = 'release', [string]$Pattern = 'Morrow-Setup-*.exe') {
  $repoFull = Get-NormalizedPath $Repo
  $release = Get-NormalizedPath (Join-Path $repoFull $RelativeDirectory)
  if (-not (Test-PathWithin -Child $release -Parent $repoFull)) { throw "Installer directory escaped the repository: $release" }
  if (-not (Test-Path -LiteralPath $release -PathType Container)) { throw "Release directory not found: $release" }
  $candidates = @(Get-ChildItem -LiteralPath $release -Filter $Pattern -File |
    Where-Object { $_.LastWriteTimeUtc -ge $RunStart.ToUniversalTime() })
  if ($candidates.Count -eq 0) { throw "No installer matching $Pattern produced by this run in $release." }
  $installer = $candidates | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
  if (-not (Test-PathWithin -Child $installer.FullName -Parent $release)) {
    throw "Installer escaped its release directory: $($installer.FullName)"
  }
  return [pscustomobject]@{
    FullName = $installer.FullName
    Name = $installer.Name
    Length = $installer.Length
    LastWriteTimeUtc = $installer.LastWriteTimeUtc.ToString('o')
    Sha256 = (Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

function Get-InstalledExecutable([string]$InstallDir, [string]$ProductName = 'Morrow') {
  $installFull = Get-NormalizedPath $InstallDir
  if (-not (Test-Path -LiteralPath $installFull -PathType Container)) { throw "Install directory not found: $installFull" }
  $exe = Join-Path $installFull "$ProductName.exe"
  if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "Expected installed executable not found: $exe" }
  if (-not (Test-PathWithin -Child $exe -Parent $installFull)) { throw "Installed executable escaped the install directory: $exe" }
  $item = Get-Item -LiteralPath $exe -Force
  return [pscustomobject]@{
    FullName = $item.FullName
    Length = $item.Length
    Sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    ProductVersion = $item.VersionInfo.ProductVersion
    FileVersion = $item.VersionInfo.FileVersion
  }
}

function Assert-InstalledVersion([string]$ExePath, [string]$ExpectedVersion) {
  $info = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($ExePath)
  $candidates = @($info.ProductVersion, $info.FileVersion) | Where-Object { $_ }
  foreach ($candidate in $candidates) {
    $trimmed = $candidate.Split('+')[0].Trim()
    if ($trimmed -eq $ExpectedVersion) { return $trimmed }
    try {
      if ([version]$trimmed -eq [version]$ExpectedVersion) { return $trimmed }
    } catch {
      # Not a parsable version; keep checking the other candidate.
    }
  }
  throw "Installed executable version '$($candidates -join ', ')' did not match expected '$ExpectedVersion'."
}

function Get-Uninstaller([string]$InstallDir) {
  $installFull = Get-NormalizedPath $InstallDir
  $uninstallers = @(Get-ChildItem -LiteralPath $installFull -Filter 'Uninstall*.exe' -File)
  if ($uninstallers.Count -eq 0) { throw "No Uninstall*.exe found in $installFull" }
  if ($uninstallers.Count -gt 1) { throw "Ambiguous uninstallers in ${installFull}: $($uninstallers.Name -join ', ')" }
  return $uninstallers[0].FullName
}

function Invoke-ProcessWithTimeout([string]$FilePath, [string]$Arguments, [string]$WorkingDirectory, [int]$TimeoutSeconds) {
  $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory -PassThru
  $timedOut = $false
  if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    $timedOut = $true
    & taskkill.exe /PID $process.Id /T /F 2>&1 | Out-Null
    try { $process.WaitForExit(10000) | Out-Null } catch { }
  }
  $code = $null
  if (-not $timedOut) {
    try {
      # Windows PowerShell 5.1 leaves ExitCode unset after WaitForExit(ms);
      # the parameterless overload (or touching Handle) populates it.
      $process.WaitForExit()
      $code = $process.ExitCode
    } catch { $code = $null }
  }
  return [pscustomobject]@{ ExitCode = $code; TimedOut = $timedOut; ProcessId = $process.Id }
}

function Invoke-CapturedProcess([string]$Exe, [string[]]$Arguments, [string]$WorkingDirectory, [string]$StdoutPath, [string]$StderrPath, [int]$TimeoutSeconds) {
  $file = $Exe
  $argumentString = $Arguments -join ' '
  if ($Exe -match '\.(cmd|bat)$') {
    $file = $env:ComSpec
    $argumentString = '/d /s /c "' + $Exe + ' ' + $argumentString + '"'
  }
  # Start-Process -PassThru leaves ExitCode null under Windows PowerShell 5.1
  # when output is redirected. System.Diagnostics.Process populates it.
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $file
  $startInfo.Arguments = $argumentString
  $startInfo.WorkingDirectory = $WorkingDirectory
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.CreateNoWindow = $true
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  [void]$process.Start()
  $outTask = $process.StandardOutput.ReadToEndAsync()
  $errTask = $process.StandardError.ReadToEndAsync()
  $timedOut = $false
  if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    $timedOut = $true
    & taskkill.exe /PID $process.Id /T /F 2>&1 | Out-Null
    try { $process.WaitForExit(10000) | Out-Null } catch { }
  } else {
    $process.WaitForExit()
  }
  $outText = ''
  $errText = ''
  try { if ($outTask.Wait(5000)) { $outText = $outTask.Result } } catch { }
  try { if ($errTask.Wait(5000)) { $errText = $errTask.Result } } catch { }
  $code = $null
  if (-not $timedOut) { try { $code = $process.ExitCode } catch { $code = $null } }
  if ($StdoutPath) { Write-Utf8NoBom $StdoutPath $outText }
  if ($StderrPath) { Write-Utf8NoBom $StderrPath $errText }
  return [pscustomobject]@{ ExitCode = $code; TimedOut = $timedOut; Output = ($outText + $errText); ProcessId = $process.Id }
}

function Test-NsisProcessCheckAvailable {
  # electron-builder's NSIS installer only checks processes under $INSTDIR when
  # PowerShell + Get-CimInstance are usable. Otherwise it falls back to
  # taskkill /IM Morrow.exe, which could terminate a user's running app. Refuse
  # to install when that fallback would be used.
  $command = '-NoProfile -Command "if ((Get-Command Get-CimInstance -ErrorAction SilentlyContinue) -and ((Get-ExecutionPolicy -Scope Process) -ne ''Restricted'')) { exit 0 } else { exit 1 }"'
  $result = Invoke-ProcessWithTimeout -FilePath 'powershell.exe' -Arguments $command -WorkingDirectory $env:SystemRoot -TimeoutSeconds 60
  return (-not $result.TimedOut -and $result.ExitCode -eq 0)
}

function Invoke-IsolatedInstall([string]$InstallerPath, [string]$InstallDir, [int]$TimeoutSeconds = 180) {
  if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) { throw "Installer not found: $InstallerPath" }
  $argument = Get-NsisInstallArgument $InstallDir
  return Invoke-ProcessWithTimeout -FilePath $InstallerPath -Arguments $argument -WorkingDirectory (Split-Path $InstallerPath -Parent) -TimeoutSeconds $TimeoutSeconds
}

function Invoke-IsolatedUninstall([string]$InstallDir, [string]$UninstallerPath, [int]$TimeoutSeconds = 180) {
  if ([string]::IsNullOrWhiteSpace($UninstallerPath)) { $UninstallerPath = Get-Uninstaller $InstallDir }
  if (-not (Test-Path -LiteralPath $UninstallerPath -PathType Leaf)) { throw "Uninstaller not found: $UninstallerPath" }
  $result = Invoke-ProcessWithTimeout -FilePath $UninstallerPath -Arguments '/S' -WorkingDirectory $InstallDir -TimeoutSeconds $TimeoutSeconds
  return [pscustomobject]@{
    ExitCode = $result.ExitCode
    TimedOut = $result.TimedOut
    ProcessId = $result.ProcessId
    Uninstaller = $UninstallerPath
  }
}

function Stop-ProcessesUnderPath([string]$ExecutablePath) {
  $target = Get-NormalizedPath $ExecutablePath
  $leaf = [System.IO.Path]::GetFileName($target)
  $stopped = @()
  $processes = @(Get-CimInstance Win32_Process -Filter "Name = '$leaf'" -ErrorAction SilentlyContinue)
  foreach ($process in $processes) {
    $processPath = $null
    try { $processPath = $process.ExecutablePath } catch { $processPath = $null }
    if ([string]::IsNullOrWhiteSpace($processPath)) { continue }
    if (-not (Get-NormalizedPath $processPath).Equals($target, [System.StringComparison]::OrdinalIgnoreCase)) { continue }
    try {
      Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
      $stopped += $process.ProcessId
    } catch {
      # A process that already exited is fine; anything else is reported by the caller.
    }
  }
  return $stopped
}

function Remove-IsolatedPaths([string]$RunDir, [string[]]$RelativePaths) {
  $runFull = Get-NormalizedPath $RunDir
  $removed = @()
  $errors = @()
  foreach ($relative in $RelativePaths) {
    $candidate = Get-NormalizedPath (Join-Path $runFull $relative)
    if (-not (Test-PathWithin -Child $candidate -Parent $runFull)) {
      $errors += "Refusing to remove a path outside the run directory: $candidate"
      continue
    }
    if (-not (Test-Path -LiteralPath $candidate)) { continue }
    $item = Get-Item -LiteralPath $candidate -Force
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      $errors += "Refusing to remove a reparse point: $candidate"
      continue
    }
    $nestedReparse = @(Get-ChildItem -LiteralPath $candidate -Recurse -Force -ErrorAction SilentlyContinue |
      Where-Object { ($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 })
    if ($nestedReparse.Count -gt 0) {
      $errors += "Refusing to remove a tree containing a reparse point: $($nestedReparse[0].FullName)"
      continue
    }
    try {
      Remove-Item -LiteralPath $candidate -Recurse -Force -ErrorAction Stop
      $removed += $candidate
    } catch {
      $errors += "Failed to remove ${candidate}: $($_.Exception.Message)"
    }
  }
  $status = 'PASS'
  if ($errors.Count -gt 0) { $status = 'CLEANUP_FAILED' }
  return [pscustomobject]@{ Status = $status; RemovedPaths = $removed; Errors = $errors }
}

function Copy-ArchiveEvidence([string]$SourceRoot, [string]$DestinationRoot, [datetime]$RunStart, [string]$AllowedRoot) {
  $sourceFull = Get-NormalizedPath $SourceRoot
  $destinationFull = Get-NormalizedPath $DestinationRoot
  $allowedFull = Get-NormalizedPath $AllowedRoot
  if (-not (Test-PathWithin -Child $sourceFull -Parent $allowedFull) -and -not $sourceFull.Equals($allowedFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Evidence source is outside the allowed root: $sourceFull"
  }
  if (-not (Test-Path -LiteralPath $sourceFull -PathType Container)) { return @() }
  $reparse = @(Get-ChildItem -LiteralPath $sourceFull -Recurse -Force -ErrorAction SilentlyContinue |
    Where-Object { ($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 })
  if ($reparse.Count -gt 0) {
    throw "Evidence source contains a reparse point: $($reparse[0].FullName)"
  }
  $entries = @()
  $files = @(Get-ChildItem -LiteralPath $sourceFull -Recurse -File -Force)
  foreach ($file in $files) {
    if (Test-ReparsePointChain -Path $file.FullName -StopAt $sourceFull) {
      throw "Evidence source contains a reparse point: $($file.FullName)"
    }
    if ($file.LastWriteTimeUtc -lt $RunStart.ToUniversalTime()) { continue }
    $relative = $file.FullName.Substring($sourceFull.Length).TrimStart('\')
    $target = Join-Path $destinationFull $relative
    if (-not (Test-PathWithin -Child $target -Parent $destinationFull)) {
      throw "Evidence destination escaped the archive directory: $target"
    }
    $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    if (Test-Path -LiteralPath $target) {
      $existing = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($existing -ne $hash) { throw "Evidence file name conflict with different content: $target" }
      continue
    }
    New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $target -Force
    $entries += [pscustomobject]@{
      source = $file.FullName
      destination = $target
      size = $file.Length
      sha256 = $hash
    }
  }
  return $entries
}

function Redact-Text([string]$Text) {
  $Text = [regex]::Replace($Text, '(?i)(authorization:\s*(?:bearer|token|basic)\s+)\S+', '$1[REDACTED]')
  $Text = [regex]::Replace($Text, 'sk-[A-Za-z0-9_-]{10,}', '[REDACTED]')
  $Text = [regex]::Replace($Text, 'gh[pousr]_[A-Za-z0-9]{20,}', '[REDACTED]')
  $Text = [regex]::Replace($Text, 'github_pat_[A-Za-z0-9_]{20,}', '[REDACTED]')
  $Text = [regex]::Replace($Text, '(?i)("?(?:api[_-]?key|apikey|authorization|token|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|secret)"?\s*[:=]\s*")[^"]*(")', '$1[REDACTED]$2')
  $Text = [regex]::Replace($Text, '(?i)("?(?:api[_-]?key|apikey|authorization|token|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|secret)"?\s*[:=]\s*''?)(?!(?:bearer|token|basic)\b)[^\s"'',}]+', '$1[REDACTED]')
  return $Text
}

function Test-RedactionResidual([string]$Text) {
  $patterns = @(
    'sk-[A-Za-z0-9_-]{10,}',
    'gh[pousr]_[A-Za-z0-9]{20,}',
    'github_pat_[A-Za-z0-9_]{20,}',
    '(?i)authorization:\s*(?:bearer|token|basic)\s+(?!\[REDACTED\])[^\s]+',
    '(?i)"?(?:api[_-]?key|apikey|authorization|token|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|secret)"?\s*[:=]\s*"?(?!\[REDACTED\])(?!bearer\b|token\b|basic\b)[^"\s,}]+'
  )
  $matches = @()
  foreach ($pattern in $patterns) {
    foreach ($match in [regex]::Matches($Text, $pattern)) { $matches += $match.Value }
  }
  return $matches
}

function Set-ObjectProperty([object]$Object, [string]$Name, [object]$Value) {
  $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force
}

function Write-AtomicJson([string]$Path, [object]$Object) {
  $temporary = "$Path.tmp"
  Write-Utf8NoBom $temporary ($Object | ConvertTo-Json -Depth 12)
  Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function New-UniqueRunDirectory([string]$ArchiveRoot, [string]$Sha, [string]$RunId, [string]$Stamp = $null) {
  if ([string]::IsNullOrWhiteSpace($RunId)) { throw 'RunId is required.' }
  if ($Sha -notmatch '^[0-9a-fA-F]{7,64}$') { throw "Sha must be hexadecimal without path separators: $Sha" }
  $root = Get-NormalizedPath $ArchiveRoot
  if (Test-Path -LiteralPath $root) {
    if (-not (Test-Path -LiteralPath $root -PathType Container)) { throw "Archive root is not a directory: $root" }
  } else {
    New-Item -ItemType Directory -Path $root -ErrorAction Stop | Out-Null
  }
  if (Test-ReparsePointChain -Path $root -StopAt $root) { throw "Archive root is a reparse point: $root" }
  if ([string]::IsNullOrWhiteSpace($Stamp)) { $Stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ') }
  $runDir = Get-NormalizedPath (Join-Path $root "$Stamp-$Sha-$RunId")
  if (-not (Test-PathWithin -Child $runDir -Parent $root)) { throw "Run directory escaped the archive root: $runDir" }
  $existing = Get-Item -LiteralPath $runDir -Force -ErrorAction SilentlyContinue
  if ($existing) { throw "Refusing to reuse an existing run directory: $runDir" }
  New-Item -ItemType Directory -Path $runDir -ErrorAction Stop | Out-Null
  if (Test-ReparsePointChain -Path $runDir -StopAt $root) { throw "Run directory contains a reparse point: $runDir" }
  foreach ($child in @('logs', 'results', 'results\transcripts', 'installers', 'screenshots')) {
    $path = Join-Path $runDir $child
    $childExisting = Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
    if ($childExisting) { throw "Refusing to reuse an existing run subdirectory: $path" }
    New-Item -ItemType Directory -Path $path -ErrorAction Stop | Out-Null
  }
  return [pscustomobject]@{
    RunId = $RunId
    RunDir = $runDir
    ArchiveRoot = $root
    CreatedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
  }
}

function Complete-RunArchive([string]$RunDir, [object]$Manifest, [string]$ReadmeText) {
  $runFull = Get-NormalizedPath $RunDir
  $result = [pscustomobject]@{
    Status = $Manifest.status
    FailedStage = $Manifest.failedStage
    Errors = @()
    ChecksumsFileSha256 = $null
    FileCount = 0
  }
  $checksumPolicy = 'run-manifest.json and checksums.sha256 are excluded from the checksum list; checksums.sha256 is hashed into the manifest.'
  try {
    Write-Utf8NoBom (Join-Path $runFull 'README.txt') $ReadmeText
  } catch {
    $result.Status = 'FAILED'
    if (-not $result.FailedStage) { $result.FailedStage = 'readme' }
    $result.Errors += "README write failed: $($_.Exception.Message)"
  }
  try {
    $files = @(Get-ChildItem -LiteralPath $runFull -Recurse -File |
      Where-Object { $_.Name -ne 'checksums.sha256' -and $_.Name -ne 'run-manifest.json' -and $_.Extension -ne '.tmp' })
    $lines = @()
    $expected = @{}
    foreach ($file in $files) {
      $relative = $file.FullName.Substring($runFull.Length).TrimStart('\')
      $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
      $lines += "$hash *$relative"
      $expected[$relative] = $hash
    }
    Write-Utf8NoBom (Join-Path $runFull 'checksums.sha256') (($lines) -join "`r`n")
    $result.FileCount = $files.Count
    $result.ChecksumsFileSha256 = (Get-FileHash -LiteralPath (Join-Path $runFull 'checksums.sha256') -Algorithm SHA256).Hash.ToLowerInvariant()
    foreach ($file in $files) {
      $relative = $file.FullName.Substring($runFull.Length).TrimStart('\')
      $actual = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($actual -ne $expected[$relative]) { throw "Checksum mismatch for $relative" }
    }
    Set-ObjectProperty $Manifest 'archive' ([pscustomobject]@{
      integrity = 'verified'
      checksumPolicy = $checksumPolicy
      checksumsFileSha256 = $result.ChecksumsFileSha256
      fileCount = $result.FileCount
    })
  } catch {
    $result.Status = 'FAILED'
    if (-not $result.FailedStage) { $result.FailedStage = 'checksums' }
    $result.Errors += "Checksum stage failed: $($_.Exception.Message)"
    Set-ObjectProperty $Manifest 'archive' ([pscustomobject]@{
      integrity = 'failed'
      checksumPolicy = $checksumPolicy
      checksumsFileSha256 = $result.ChecksumsFileSha256
      fileCount = $result.FileCount
      error = $_.Exception.Message
    })
  }
  $manifestPath = Join-Path $runFull 'run-manifest.json'
  try {
    Set-ObjectProperty $Manifest 'status' $result.Status
    Set-ObjectProperty $Manifest 'failedStage' $result.FailedStage
    Set-ObjectProperty $Manifest 'exitCode' $(if ($result.Status -eq 'PASS') { 0 } else { 1 })
    Write-AtomicJson $manifestPath $Manifest
    $parsed = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($parsed.status -ne $Manifest.status -or [int]$parsed.exitCode -ne [int]$Manifest.exitCode) {
      throw 'Manifest verification mismatch after atomic write.'
    }
  } catch {
    $result.Status = 'FAILED'
    $result.FailedStage = 'manifest'
    $result.Errors += "Manifest stage failed: $($_.Exception.Message)"
    try {
      Set-ObjectProperty $Manifest 'status' 'FAILED'
      Set-ObjectProperty $Manifest 'failedStage' 'manifest'
      Set-ObjectProperty $Manifest 'exitCode' 1
      Write-AtomicJson $manifestPath $Manifest
    } catch {
      $result.Errors += "Minimal failure manifest could not be written: $($_.Exception.Message)"
    }
  }
  return $result
}

function Get-OwnedProcesses([string]$InstallDir, [datetime]$Since, [int[]]$ExcludePids = @()) {
  $installFull = Get-NormalizedPath $InstallDir
  $all = @(Get-CimInstance Win32_Process -ErrorAction Stop)
  $owned = @{}
  foreach ($process in $all) {
    $processId = [int]$process.ProcessId
    if ($ExcludePids -contains $processId) { continue }
    $path = $null
    try { $path = $process.ExecutablePath } catch { $path = $null }
    if ([string]::IsNullOrWhiteSpace($path)) { continue }
    if (-not (Test-PathWithin -Child $path -Parent $installFull)) { continue }
    $created = $null
    try { $created = [datetime]$process.CreationDate } catch { $created = $null }
    if ($created -and $created.ToUniversalTime() -lt $Since.ToUniversalTime()) { continue }
    $owned[$processId] = [pscustomobject]@{
      ProcessId = $processId
      ParentProcessId = [int]$process.ParentProcessId
      Name = $process.Name
      ExecutablePath = $path
      CreationDate = $(if ($created) { $created.ToUniversalTime().ToString('o') } else { $null })
      Reason = 'install-path'
    }
  }
  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($process in $all) {
      $processId = [int]$process.ProcessId
      if ($owned.ContainsKey($processId)) { continue }
      $parentId = [int]$process.ParentProcessId
      if (-not $owned.ContainsKey($parentId)) { continue }
      $created = $null
      try { $created = [datetime]$process.CreationDate } catch { $created = $null }
      if ($created -and $created.ToUniversalTime() -lt $Since.ToUniversalTime()) { continue }
      $path = $null
      try { $path = $process.ExecutablePath } catch { $path = $null }
      $owned[$processId] = [pscustomobject]@{
        ProcessId = $processId
        ParentProcessId = $parentId
        Name = $process.Name
        ExecutablePath = $path
        CreationDate = $(if ($created) { $created.ToUniversalTime().ToString('o') } else { $null })
        Reason = 'descendant'
      }
      $changed = $true
    }
  }
  return @($owned.Values | Sort-Object ProcessId)
}

function Test-ProcessRecordOwned([object]$Record, [string]$InstallDir) {
  try {
    $process = [System.Diagnostics.Process]::GetProcessById($Record.ProcessId)
  } catch [System.ArgumentException] {
    return $false
  }
  if ($process.HasExited) { return $false }
  if ($Record.CreationDate) {
    $recordTime = [datetime]::Parse($Record.CreationDate).ToUniversalTime()
    $actualTime = $process.StartTime.ToUniversalTime()
    if ([math]::Abs(($actualTime - $recordTime).TotalSeconds) -gt 2) { return $false }
  }
  try {
    $path = $process.MainModule.FileName
  } catch {
    if ($Record.Reason -eq 'descendant') { return $true }
    throw
  }
  if ($path -and (Test-PathWithin -Child $path -Parent $InstallDir)) { return $true }
  if ($Record.Reason -eq 'descendant') { return $true }
  return $false
}

function Stop-OwnedProcessTree([object[]]$Owned, [string]$InstallDir, [int]$GraceSeconds = 5, [scriptblock]$StopAction = $null) {
  $errors = @()
  $stopped = @()
  foreach ($record in $Owned) {
    try {
      if (-not (Test-ProcessRecordOwned -Record $record -InstallDir $InstallDir)) { continue }
      $process = [System.Diagnostics.Process]::GetProcessById($record.ProcessId)
      if ($process) { [void]$process.CloseMainWindow() }
    } catch {
      $errors += "Cannot inspect or close PID $($record.ProcessId): $($_.Exception.Message)"
    }
  }
  if ($GraceSeconds -gt 0) { Start-Sleep -Seconds $GraceSeconds }
  foreach ($record in $Owned) {
    try {
      if (-not (Test-ProcessRecordOwned -Record $record -InstallDir $InstallDir)) { continue }
      if ($StopAction) {
        & $StopAction $record.ProcessId
      } else {
        Stop-Process -Id $record.ProcessId -Force -ErrorAction Stop
      }
      $stopped += $record.ProcessId
    } catch {
      $errors += "Failed to stop PID $($record.ProcessId): $($_.Exception.Message)"
    }
  }
  $deadline = (Get-Date).AddSeconds(10)
  while ((Get-Date) -lt $deadline) {
    $alive = @()
    foreach ($record in $Owned) {
      try {
        if (Test-ProcessRecordOwned -Record $record -InstallDir $InstallDir) { $alive += $record }
      } catch {
        $errors += "Cannot verify PID $($record.ProcessId): $($_.Exception.Message)"
        $alive += $record
      }
    }
    if ($alive.Count -eq 0) { break }
    Start-Sleep -Milliseconds 250
  }
  $remaining = @()
  foreach ($record in $Owned) {
    try {
      if (Test-ProcessRecordOwned -Record $record -InstallDir $InstallDir) { $remaining += $record }
    } catch {
      $errors += "Cannot verify PID $($record.ProcessId): $($_.Exception.Message)"
      $remaining += $record
    }
  }
  foreach ($record in $remaining) {
    $errors += "Process still alive: PID $($record.ProcessId) $($record.ExecutablePath)"
  }
  return [pscustomobject]@{
    Stopped = @($stopped)
    Remaining = @($remaining)
    Errors = @($errors)
  }
}
