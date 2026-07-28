<#
  Skill Recorder — download & run (Windows).

  Fetches Skill Recorder from source into a local directory, installs its
  dependencies, builds it, and launches it. A lightweight alternative to
  packaged installers (no .exe / .msi): it just runs the app from source.

  The script is idempotent — re-running it fast-forwards to the latest code and
  skips any step (dependency install, build) whose inputs haven't changed, so
  the same one-liner both installs and updates the app.

  Usage (PowerShell):
    irm https://raw.githubusercontent.com/adilei/skill-recorder/master/install.ps1 | iex

  Or with curl.exe:
    curl.exe -fsSL https://raw.githubusercontent.com/adilei/skill-recorder/master/install.ps1 -o "$env:TEMP\install.ps1"; & "$env:TEMP\install.ps1"

  Environment overrides:
    SKILL_RECORDER_HOME    install directory      (default: %USERPROFILE%\.skill-recorder)
    SKILL_RECORDER_REPO    owner/repo             (default: adilei/skill-recorder)
    SKILL_RECORDER_REF     branch / tag / commit  (default: master)
    SKILL_RECORDER_NO_RUN  set to install & build only, without launching
#>

$ErrorActionPreference = 'Stop'

$Repo       = if ($env:SKILL_RECORDER_REPO) { $env:SKILL_RECORDER_REPO } else { 'adilei/skill-recorder' }
$Ref        = if ($env:SKILL_RECORDER_REF)  { $env:SKILL_RECORDER_REF }  else { 'master' }
$InstallDir = if ($env:SKILL_RECORDER_HOME) { $env:SKILL_RECORDER_HOME } else { Join-Path $env:USERPROFILE '.skill-recorder' }

function Info($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Have($c) { [bool](Get-Command $c -ErrorAction SilentlyContinue) }

# Abort if the most recent native command reported a non-zero exit code
# (PowerShell does not treat native exit codes as terminating errors on its own).
function Assert-Ok($what) {
  if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" }
}

function FileSha($path) {
  if (Test-Path -LiteralPath $path) { (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash } else { '' }
}

# --- prerequisites ---------------------------------------------------------
if (-not (Have 'node')) { throw "Node.js 22+ is required but 'node' was not found on PATH." }
if (-not (Have 'npm'))  { throw "npm is required but was not found on PATH." }

$nodeMajor = [int](& node -p 'process.versions.node.split(".")[0]')
if ($nodeMajor -lt 22) { throw "Node.js 22+ is required (found $(& node -v))." }

if (-not (Have 'copilot')) {
  Write-Warning "GitHub Copilot CLI ('copilot') not found on PATH. The app will launch, but recording analysis and skill/automation building need it — install it and sign in first."
}

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
