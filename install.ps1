<#
  Skill Recorder — download & run (Windows).

  Fetches Skill Recorder from source into a local directory, installs its
  dependencies, builds it, and launches it. A lightweight alternative to
  packaged installers (no .exe / .msi): it just runs the app from source.

  The script is idempotent — re-running it fast-forwards to the latest code and
  skips any step (dependency install, build) whose inputs haven't changed, so
  the same one-liner both installs and updates the app.

  Usage (one line, from any Windows terminal — cmd.exe or PowerShell):
    powershell -c "irm https://raw.githubusercontent.com/adilei/skill-recorder/master/install.ps1 | iex"

  Node.js is downloaded automatically when it's missing: an official,
  checksum-verified Node binary (win-x64 or win-arm64) is placed under the
  install directory and used just for this app — nothing is installed
  system-wide and no executables are built.

  Environment overrides:
    SKILL_RECORDER_HOME          install directory      (default: %USERPROFILE%\.skill-recorder)
    SKILL_RECORDER_REPO          owner/repo             (default: adilei/skill-recorder)
    SKILL_RECORDER_REF           branch / tag / commit  (default: master)
    SKILL_RECORDER_NO_RUN        set to install & build only, without launching
    SKILL_RECORDER_NODE_VERSION  Node to fetch when missing (default: latest-v22.x)
    SKILL_RECORDER_NODE_MIRROR   Node dist mirror       (default: https://nodejs.org/dist)
#>

$ErrorActionPreference = 'Stop'
# Invoke-WebRequest is ~10x slower with the progress bar on Windows PowerShell 5.1.
$ProgressPreference = 'SilentlyContinue'

$Repo       = if ($env:SKILL_RECORDER_REPO) { $env:SKILL_RECORDER_REPO } else { 'adilei/skill-recorder' }
$Ref        = if ($env:SKILL_RECORDER_REF)  { $env:SKILL_RECORDER_REF }  else { 'master' }
$InstallDir = if ($env:SKILL_RECORDER_HOME) { $env:SKILL_RECORDER_HOME } else { Join-Path $env:USERPROFILE '.skill-recorder' }
$NodeMinMajor = 22

function Info($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Have($c) { [bool](Get-Command $c -ErrorAction SilentlyContinue) }

# Detect the Copilot CLI the same way the app's doctor does (it runs `where
# copilot`). Get-Command alone misses an extensionless `copilot` launcher or a
# Windows App Execution Alias that `where.exe` — and therefore the app — finds.
function Test-CopilotAvailable {
  # 1. Bundled in node_modules (what the Electron app actually uses)
  $arch = if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq 'Arm64') { 'arm64' } else { 'x64' }
  $bundled = Join-Path $InstallDir "node_modules\@github\copilot-win32-$arch\copilot.exe"
  if (Test-Path -LiteralPath $bundled) { return $true }
  # 2. GitHub Copilot desktop app
  $ghcpApp = Join-Path $env:LOCALAPPDATA 'Programs\GitHub Copilot\github.exe'
  if (Test-Path -LiteralPath $ghcpApp) { return $true }
  # 3. copilot on PATH (Get-Command or where.exe)
  if (Have 'copilot') { return $true }
  try { $null = & where.exe copilot 2>$null; return ($LASTEXITCODE -eq 0) } catch { return $false }
}

# Abort if the most recent native command reported a non-zero exit code
# (PowerShell does not treat native exit codes as terminating errors on its own).
function Assert-Ok($what) {
  if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" }
}

function FileSha($path) {
  if (Test-Path -LiteralPath $path) { (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash } else { '' }
}

# True when a Node new enough to build & run the app is already on PATH.
function Test-NodeAvailable {
  if (-not (Have 'node')) { return $false }
  try {
    # Parse "node -v" (e.g. v22.23.1); avoid passing a JS expression, because
    # Windows strips the embedded quotes from 'node -p "...".split()' arguments.
    $v = & node -v 2>$null
    if ($v -match '^v?(\d+)\.') { return ([int]$Matches[1] -ge $NodeMinMajor) }
    return $false
  } catch { return $false }
}

# Ensure a usable Node/npm is on PATH: prefer the system one, otherwise download
# an official Node binary into "$InstallDir\.node" (once) and prepend it to PATH.
function Initialize-NodeRuntime {
  if (Test-NodeAvailable) { Info "Using existing Node $(& node -v)."; return }

  $nodeDir = Join-Path $InstallDir '.node'
  if (Test-Path -LiteralPath (Join-Path $nodeDir 'node.exe')) {
    $env:Path = "$nodeDir;$env:Path"
    if (Test-NodeAvailable) { Info "Using bundled Node $(& node -v) (in $nodeDir)."; return }
  }

  # OSArchitecture reports the true OS arch even from an x64 process emulated on
  # ARM64, so ARM64 devices get the native win-arm64 build.
  $osArch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
  $arch = switch ($osArch) {
    'X64'   { 'x64' }
    'Arm64' { 'arm64' }
    default { throw "Can't auto-download Node for Windows $osArch; install Node $NodeMinMajor+ manually." }
  }

  $channel = if ($env:SKILL_RECORDER_NODE_VERSION) { $env:SKILL_RECORDER_NODE_VERSION } else { "latest-v$NodeMinMajor.x" }
  if ($channel -notlike 'latest-*' -and $channel -notlike 'v*') { $channel = "v$channel" }
  $mirror  = if ($env:SKILL_RECORDER_NODE_MIRROR) { $env:SKILL_RECORDER_NODE_MIRROR } else { 'https://nodejs.org/dist' }
  $base = "$mirror/$channel"

  Info "Node $NodeMinMajor+ not found — downloading a private copy for Skill Recorder…"
  $sums = (Invoke-WebRequest -UseBasicParsing -Uri "$base/SHASUMS256.txt").Content
  $line = ($sums -split "`n") | Where-Object { $_ -match "node-.*-win-$arch\.zip$" } | Select-Object -First 1
  if (-not $line) { throw "No Node win-$arch build found at $base." }
  $fields = ($line.Trim() -split '\s+')
  $want = $fields[0].ToLower(); $file = $fields[1]

  $tmp = Join-Path $env:TEMP ("sr-node-" + [guid]::NewGuid().ToString())
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  try {
    $zip = Join-Path $tmp $file
    Info "  downloading $file"
    Invoke-WebRequest -UseBasicParsing -Uri "$base/$file" -OutFile $zip
    $got = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLower()
    if ($got -ne $want) { throw "Checksum mismatch for $file (expected $want, got $got)." }
    Info "  checksum verified"

    if (Test-Path -LiteralPath $nodeDir) { Remove-Item -Recurse -Force -LiteralPath $nodeDir }
    Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
    $inner = Get-ChildItem -Directory -LiteralPath $tmp | Where-Object { $_.Name -like 'node-*' } | Select-Object -First 1
    Move-Item -LiteralPath $inner.FullName -Destination $nodeDir
  } finally {
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue -LiteralPath $tmp
  }

  $env:Path = "$nodeDir;$env:Path"
  if (-not (Test-NodeAvailable)) { throw "Downloaded Node is still unusable — please report this." }
  Info "Installed Node $(& node -v) into $nodeDir"
}

# --- prerequisites ---------------------------------------------------------

# --- fetch source ----------------------------------------------------------
$versionToken = ''
if (Have 'git') {
  if (-not (Test-Path -LiteralPath (Join-Path $InstallDir '.git'))) {
    if (Test-Path -LiteralPath $InstallDir) { Remove-Item -Recurse -Force -LiteralPath $InstallDir }
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    & git -C $InstallDir init -q; Assert-Ok 'git init'
    & git -C $InstallDir remote add origin "https://github.com/$Repo.git"; Assert-Ok 'git remote add'
  } else {
    & git -C $InstallDir remote set-url origin "https://github.com/$Repo.git"; Assert-Ok 'git remote set-url'
  }
  Info "Fetching $Repo ($Ref) into $InstallDir"
  & git -C $InstallDir fetch --depth 1 origin $Ref; Assert-Ok 'git fetch'
  & git -C $InstallDir reset --hard FETCH_HEAD; Assert-Ok 'git reset'
  $versionToken = (& git -C $InstallDir rev-parse HEAD).Trim(); Assert-Ok 'git rev-parse'
} else {
  Write-Warning "'git' not found — downloading a source zip instead."
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  $zip = Join-Path $env:TEMP ("skill-recorder-" + [guid]::NewGuid().ToString() + ".zip")
  $tmp = Join-Path $env:TEMP ("skill-recorder-" + [guid]::NewGuid().ToString())
  try {
    Info "Downloading $Repo ($Ref) into $InstallDir"
    Invoke-WebRequest -UseBasicParsing -Uri "https://codeload.github.com/$Repo/zip/$Ref" -OutFile $zip
    Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
    $inner = Get-ChildItem -Directory -LiteralPath $tmp | Select-Object -First 1
    # Copy the source over the install dir; node_modules and dist/ are local-only
    # (not in the zip) and are excluded so they survive re-runs.
    robocopy $inner.FullName $InstallDir /E /XD node_modules dist dist-electron /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed (exit $LASTEXITCODE)" }
    $versionToken = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
  } finally {
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue -LiteralPath $zip, $tmp
  }
}

Set-Location -LiteralPath $InstallDir

# --- ensure a Node.js runtime (download one if the system has none) --------
Initialize-NodeRuntime

# --- install dependencies (only when the lockfile changed) -----------------
$depsStamp = Join-Path $InstallDir '.skill-recorder-deps.sha'
$depsNow   = FileSha 'package-lock.json'
if (-not (Test-Path 'node_modules') -or ((Get-Content -LiteralPath $depsStamp -ErrorAction SilentlyContinue) -ne $depsNow)) {
  Info "Installing dependencies (npm install)…"
  & npm install --no-audit --no-fund; Assert-Ok 'npm install'
  Set-Content -LiteralPath $depsStamp -Value $depsNow
} else {
  Info "Dependencies already up to date — skipping npm install."
}

# --- check for Copilot CLI (bundled, desktop app, or PATH) -----------------
if (-not (Test-CopilotAvailable)) {
  Write-Warning "No Copilot CLI found. Install GitHub Copilot (https://github.com/features/copilot) or ensure the bundled package installed correctly. The app will launch, but recording analysis needs it."
}

# --- build (only when the source or dependencies changed) ------------------
$buildStamp = Join-Path $InstallDir '.skill-recorder-build.sha'
$buildNow   = "${versionToken}:${depsNow}"
if (-not (Test-Path 'dist-electron/main.js') -or -not (Test-Path 'dist/index.html') -or
    ((Get-Content -LiteralPath $buildStamp -ErrorAction SilentlyContinue) -ne $buildNow)) {
  Info "Building app (npm run build)…"
  & npm run build; Assert-Ok 'npm run build'
  Set-Content -LiteralPath $buildStamp -Value $buildNow
} else {
  Info "Build already up to date — skipping npm run build."
}

Info "Skill Recorder is installed in $InstallDir"
Info "Re-run the same command any time to update & launch, or: cd `"$InstallDir`"; npm start"

# --- launch ----------------------------------------------------------------
if ($env:SKILL_RECORDER_NO_RUN) {
  Info "SKILL_RECORDER_NO_RUN set — not launching."
  return
}

Info "Launching Skill Recorder…"
& npm start; Assert-Ok 'npm start'
