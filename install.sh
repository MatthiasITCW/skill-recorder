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
# Environment overrides:
#   SKILL_RECORDER_HOME    install directory        (default: ~/.skill-recorder)
#   SKILL_RECORDER_REPO    owner/repo               (default: adilei/skill-recorder)
#   SKILL_RECORDER_REF     branch / tag / commit    (default: master)
#   SKILL_RECORDER_NO_RUN  set to install & build only, without launching
#
set -euo pipefail

REPO="${SKILL_RECORDER_REPO:-adilei/skill-recorder}"
REF="${SKILL_RECORDER_REF:-master}"
INSTALL_DIR="${SKILL_RECORDER_HOME:-$HOME/.skill-recorder}"

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

sha256() { # print the sha256 of a file, or nothing if it doesn't exist
  [ -f "$1" ] || return 0
  if have shasum; then shasum -a 256 "$1" | awk '{print $1}'
  else sha256sum "$1" | awk '{print $1}'; fi
}

# --- prerequisites ---------------------------------------------------------
have node || die "Node.js 22+ is required but 'node' was not found on PATH."
have npm  || die "npm is required but was not found on PATH."

node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
[ "${node_major:-0}" -ge 22 ] || die "Node.js 22+ is required (found $(node -v))."

have copilot || warn "GitHub Copilot CLI ('copilot') not found on PATH. The app will \
launch, but recording analysis and skill/automation building need it — install it and \
sign in first."

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
