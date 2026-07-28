#!/usr/bin/env bash
#
# Skill Recorder — download & run (macOS / Linux).
#
# Fetches Skill Recorder from source into a local directory, installs its
# dependencies, builds it, and launches it. This is a lightweight alternative
# to packaged installers (no .dmg / .exe): it just runs the app from source.
#
# The script is idempotent — re-running it fast-forwards to the latest code and
# skips any step (dependency install, build) whose inputs haven't changed, so
# the same one-liner both installs and updates the app.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/adilei/skill-recorder/master/install.sh | bash
#
# Node.js is the only heavy prerequisite, and you don't need it pre-installed:
# if a suitable Node isn't already on your PATH, this script downloads an
# official, checksum-verified Node.js binary into the install directory and uses
# it just for this app. Nothing is installed system-wide and no executables are
# built.
#
# Environment overrides:
#   SKILL_RECORDER_HOME          install directory       (default: ~/.skill-recorder)
#   SKILL_RECORDER_REPO          owner/repo              (default: adilei/skill-recorder)
#   SKILL_RECORDER_REF           branch / tag / commit   (default: master)
#   SKILL_RECORDER_NO_RUN        set to install & build only, without launching
#   SKILL_RECORDER_NODE_VERSION  Node to fetch when missing (default: latest-v22.x)
#   SKILL_RECORDER_NODE_MIRROR   Node dist mirror        (default: https://nodejs.org/dist)
#
set -euo pipefail

REPO="${SKILL_RECORDER_REPO:-adilei/skill-recorder}"
REF="${SKILL_RECORDER_REF:-master}"
INSTALL_DIR="${SKILL_RECORDER_HOME:-$HOME/.skill-recorder}"
NODE_MIN_MAJOR=22

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# Detect a usable Copilot CLI the way the Electron app does. The app uses the
# platform binary bundled in node_modules (installed by npm), so that is the
# real signal — not a `copilot` on PATH. Fall back to the desktop app or PATH.
copilot_available() {
  local plat arch
  case "$(uname -s)" in Darwin) plat="darwin" ;; *) plat="linux" ;; esac
  case "$(uname -m)" in arm64|aarch64) arch="arm64" ;; *) arch="x64" ;; esac
  [ -e "$INSTALL_DIR/node_modules/@github/copilot-$plat-$arch/copilot" ] && return 0
  [ -d "/Applications/GitHub Copilot.app" ] && return 0
  have copilot
}

sha256() { # print the sha256 of a file, or nothing if it doesn't exist
  [ -f "$1" ] || return 0
  if have shasum; then shasum -a 256 "$1" | awk '{print $1}'
  else sha256sum "$1" | awk '{print $1}'; fi
}

# True when a Node new enough to build & run the app is already on PATH.
node_ok() {
  have node || return 1
  # Parse "node -v" (e.g. v22.23.1) rather than a quoted JS expression, to stay
  # consistent with the Windows script and avoid any arg-quoting surprises.
  local ver maj
  ver="$(node -v 2>/dev/null)" || return 1
  maj="${ver#v}"; maj="${maj%%.*}"
  case "$maj" in ''|*[!0-9]*) return 1 ;; esac
  [ "$maj" -ge "$NODE_MIN_MAJOR" ]
}

# Echo "<os> <arch>" tokens matching Node's dist filenames, or die if unsupported.
detect_node_platform() {
  local os arch
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux)  os=linux ;;
    *) die "Can't auto-download Node for $(uname -s); install Node ${NODE_MIN_MAJOR}+ manually." ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64)  arch=x64 ;;
    arm64|aarch64) arch=arm64 ;;
    *) die "Can't auto-download Node for $(uname -m); install Node ${NODE_MIN_MAJOR}+ manually." ;;
  esac
  printf '%s %s' "$os" "$arch"
}

# Ensure a usable Node/npm is on PATH: prefer the system one, otherwise download
# an official binary into "$INSTALL_DIR/.node" (once) and prepend it to PATH.
ensure_node() {
  if node_ok; then
    info "Using existing Node $(node -v)."
    return
  fi

  local node_dir="$INSTALL_DIR/.node"
  if [ -x "$node_dir/bin/node" ]; then
    PATH="$node_dir/bin:$PATH"; export PATH
    if node_ok; then
      info "Using bundled Node $(node -v) (in $node_dir)."
      return
    fi
  fi

  have curl || die "curl is required to download Node.js."
  have tar  || die "tar is required to unpack Node.js."

  local platform os arch
  platform="$(detect_node_platform)"; os="${platform% *}"; arch="${platform#* }"

  local channel="${SKILL_RECORDER_NODE_VERSION:-latest-v${NODE_MIN_MAJOR}.x}"
  local mirror="${SKILL_RECORDER_NODE_MIRROR:-https://nodejs.org/dist}"
  case "$channel" in
    latest-*|v*) : ;;    # already a dist subdirectory name
    *)           channel="v$channel" ;;
  esac
  local base="$mirror/$channel"

  info "Node ${NODE_MIN_MAJOR}+ not found — downloading a private copy for Skill Recorder…"
  local sums; sums="$(curl -fsSL "$base/SHASUMS256.txt")" \
    || die "Couldn't fetch Node checksums from $base/SHASUMS256.txt"
  local file; file="$(printf '%s\n' "$sums" \
    | awk -v re="node-.*-${os}-${arch}\\.tar\\.gz$" '$2 ~ re {print $2; exit}')"
  [ -n "$file" ] || die "No Node ${os}-${arch} build found at $base."
  local want; want="$(printf '%s\n' "$sums" | awk -v f="$file" '$2==f {print $1; exit}')"

  local tmp; tmp="$(mktemp -d -t sr-node.XXXXXX)"
  trap 'rm -rf "$tmp"' RETURN
  info "  downloading $file"
  curl -fSL --progress-bar "$base/$file" -o "$tmp/$file" || die "Download failed: $base/$file"
  local got; got="$(sha256 "$tmp/$file")"
  [ "$got" = "$want" ] || die "Checksum mismatch for $file (expected $want, got $got)."
  info "  checksum verified"

  rm -rf "$node_dir"; mkdir -p "$node_dir"
  tar -xzf "$tmp/$file" -C "$node_dir" --strip-components=1
  PATH="$node_dir/bin:$PATH"; export PATH
  node_ok || die "Downloaded Node is still unusable — please report this."
  info "Installed Node $(node -v) into $node_dir"
}

# --- fetch source ----------------------------------------------------------
version_token=""
if have git; then
  if [ ! -d "$INSTALL_DIR/.git" ]; then
    rm -rf "$INSTALL_DIR"
    mkdir -p "$INSTALL_DIR"
    git -C "$INSTALL_DIR" init -q
    git -C "$INSTALL_DIR" remote add origin "https://github.com/$REPO.git"
  else
    git -C "$INSTALL_DIR" remote set-url origin "https://github.com/$REPO.git"
  fi
  info "Fetching $REPO ($REF) into $INSTALL_DIR"
  git -C "$INSTALL_DIR" fetch --depth 1 origin "$REF"
  git -C "$INSTALL_DIR" reset --hard FETCH_HEAD
  version_token="$(git -C "$INSTALL_DIR" rev-parse HEAD)"
else
  warn "'git' not found — downloading a source tarball instead."
  have curl || die "Either 'git' or 'curl' is required to download Skill Recorder."
  have tar  || die "'tar' is required to extract the source tarball."
  mkdir -p "$INSTALL_DIR"
  tarball="$(mktemp -t skill-recorder.XXXXXX)"
  trap 'rm -f "$tarball"' EXIT
  info "Downloading $REPO ($REF) into $INSTALL_DIR"
  curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$REF" -o "$tarball"
  # --strip-components=1 drops the top "repo-ref/" directory; node_modules and
  # dist/ live only locally (they're not in the tarball) so they survive.
  tar -xzf "$tarball" --strip-components=1 -C "$INSTALL_DIR"
  version_token="$(sha256 "$tarball")"
  rm -f "$tarball"
  trap - EXIT
fi

cd "$INSTALL_DIR"

# --- ensure a Node.js runtime (download one if the system has none) --------
ensure_node

# --- install dependencies (only when the lockfile changed) -----------------
deps_stamp="$INSTALL_DIR/.skill-recorder-deps.sha"
deps_now="$(sha256 package-lock.json)"
if [ ! -d node_modules ] || [ "$(cat "$deps_stamp" 2>/dev/null || true)" != "$deps_now" ]; then
  info "Installing dependencies (npm install)…"
  npm install --no-audit --no-fund
  printf '%s\n' "$deps_now" > "$deps_stamp"
else
  info "Dependencies already up to date — skipping npm install."
fi

# --- check for Copilot CLI (bundled, desktop app, or PATH) -----------------
copilot_available || warn "No Copilot CLI found. Install GitHub Copilot \
(https://github.com/features/copilot) or ensure the bundled package installed \
correctly. The app will launch, but recording analysis needs it."

# --- build (only when the source or dependencies changed) ------------------
build_stamp="$INSTALL_DIR/.skill-recorder-build.sha"
build_now="${version_token}:${deps_now}"
if [ ! -f dist-electron/main.js ] || [ ! -f dist/index.html ] \
   || [ "$(cat "$build_stamp" 2>/dev/null || true)" != "$build_now" ]; then
  info "Building app (npm run build)…"
  npm run build
  printf '%s\n' "$build_now" > "$build_stamp"
else
  info "Build already up to date — skipping npm run build."
fi

info "Skill Recorder is installed in $INSTALL_DIR"
info "Re-run the same command any time to update & launch, or: (cd \"$INSTALL_DIR\" && npm start)"

# --- launch ----------------------------------------------------------------
if [ -n "${SKILL_RECORDER_NO_RUN:-}" ]; then
  info "SKILL_RECORDER_NO_RUN set — not launching."
  exit 0
fi

info "Launching Skill Recorder…"
exec npm start
