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
    if (Test-Path -LiteralPath $current) {
      $item = Get-Item -LiteralPath $current -Force
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
  if (Test-Path -LiteralPath $installFull) {
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

function Get-FreshInstaller([string]$Repo, [datetime]$RunStart) {
  $release = Join-Path $Repo 'release'
  if (-not (Test-Path -LiteralPath $release -PathType Container)) { throw "Release directory not found: $release" }
  $candidates = @(Get-ChildItem -LiteralPath $release -Filter 'Morrow-Setup-*.exe' -File |
    Where-Object { $_.LastWriteTimeUtc -ge $RunStart.ToUniversalTime() })
  if ($candidates.Count -eq 0) { throw 'No NSIS installer produced by this run.' }
  $installer = $candidates | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
  if (-not (Test-PathWithin -Child $installer.FullName -Parent $release)) {
    throw "Installer escaped the release directory: $($installer.FullName)"
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
    try { $code = $process.ExitCode } catch { $code = $null }
  }
  return [pscustomobject]@{ ExitCode = $code; TimedOut = $timedOut; ProcessId = $process.Id }
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
  $Text = [regex]::Replace($Text, '(?i)("?(?:api[_-]?key|apikey|authorization|token|access[_-]?token|refresh[_-]?token)"?\s*[:=]\s*")[^"]*(")', '$1[REDACTED]$2')
  $Text = [regex]::Replace($Text, '(?i)("?(?:api[_-]?key|apikey|authorization|token|access[_-]?token|refresh[_-]?token)"?\s*[:=]\s*''?)(?!(?:bearer|token|basic)\b)[^\s"'',}]+', '$1[REDACTED]')
  return $Text
}

function Test-RedactionResidual([string]$Text) {
  $patterns = @(
    'sk-[A-Za-z0-9_-]{10,}',
    'gh[pousr]_[A-Za-z0-9]{20,}',
    'github_pat_[A-Za-z0-9_]{20,}',
    '(?i)authorization:\s*(?:bearer|token|basic)\s+(?!\[REDACTED\])[^\s]+',
    '(?i)"?(?:api[_-]?key|apikey|authorization|token|access[_-]?token|refresh[_-]?token)"?\s*[:=]\s*"?(?!\[REDACTED\])(?!bearer\b|token\b|basic\b)[^"\s,}]+'
  )
  $matches = @()
  foreach ($pattern in $patterns) {
    foreach ($match in [regex]::Matches($Text, $pattern)) { $matches += $match.Value }
  }
  return $matches
}
