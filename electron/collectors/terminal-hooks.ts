import os from "node:os";
import path from "node:path";

/**
 * Terminal capture uses opt-in shell hooks rather than scraping terminal
 * windows (which is fragile and needs Accessibility). Each shell appends a
 * single tab-delimited record per command to a well-known log file; the
 * TerminalCollector tails that file during a recording.
 *
 * Record format (one line):
 *   v1 \t <epochMs> \t <shell> \t <exitCode> \t <durationMs> \t <base64 command> \t <base64 cwd>
 *
 * command and cwd are base64-encoded so arbitrary quotes/newlines/backslashes
 * survive shell printf and our parser without escaping headaches.
 */
export const SHELL_LOG_DIR = path.join(os.homedir(), ".skill-recorder");
export const SHELL_LOG_PATH = path.join(SHELL_LOG_DIR, "shell.jsonl");
export const RECORD_VERSION = "v1";

export interface ShellRecord {
  ts: number;
  shell: string;
  exitCode: number;
  durationMs: number;
  command: string;
  cwd: string;
}

/** Parse one log line; returns null for blank/malformed/other-version lines. */
export function parseShellRecord(line: string): ShellRecord | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const parts = trimmed.split("\t");
  if (parts.length !== 7 || parts[0] !== RECORD_VERSION) return null;
  const [, tsRaw, shell, ecRaw, durRaw, cmdB64, cwdB64] = parts;
  try {
    return {
      ts: Number(tsRaw),
      shell,
      exitCode: Number(ecRaw),
      durationMs: Number(durRaw),
      command: Buffer.from(cmdB64, "base64").toString("utf8"),
      cwd: Buffer.from(cwdB64, "base64").toString("utf8"),
    };
  } catch {
    return null;
  }
}

/** zsh hook for ~/.zshrc. */
export const ZSH_HOOK = `# >>> skill-recorder (zsh) >>>
zmodload zsh/datetime 2>/dev/null
_skr_preexec() { _SKR_CMD=$1; _SKR_T0=$EPOCHREALTIME; }
_skr_precmd() {
  local ec=$?
  [ -n "$_SKR_CMD" ] || return 0
  local dir="$HOME/.skill-recorder"; [ -d "$dir" ] || mkdir -p "$dir"
  local ts=$(( $(date +%s%N) / 1000000 ))
  local dur=0; [ -n "$_SKR_T0" ] && dur=$(( (EPOCHREALTIME - _SKR_T0) * 1000 ))
  printf 'v1\\t%d\\tzsh\\t%d\\t%d\\t%s\\t%s\\n' "$ts" "$ec" "\${dur%.*}" \\
    "$(printf %s "$_SKR_CMD" | base64 | tr -d '\\n')" \\
    "$(printf %s "$PWD" | base64 | tr -d '\\n')" >> "$dir/shell.jsonl"
  _SKR_CMD=
}
autoload -Uz add-zsh-hook
add-zsh-hook preexec _skr_preexec
add-zsh-hook precmd _skr_precmd
# <<< skill-recorder (zsh) <<<`;

/** bash hook for ~/.bashrc. */
export const BASH_HOOK = `# >>> skill-recorder (bash) >>>
_skr_preexec() {
  [ -n "$COMP_LINE" ] && return
  [ "$BASH_COMMAND" = "$PROMPT_COMMAND" ] && return
  _SKR_CMD=$BASH_COMMAND
}
trap '_skr_preexec' DEBUG
_skr_precmd() {
  local ec=$?
  [ -n "$_SKR_CMD" ] || return 0
  local dir="$HOME/.skill-recorder"; [ -d "$dir" ] || mkdir -p "$dir"
  local ts=$(( $(date +%s%N) / 1000000 ))
  printf 'v1\\t%d\\tbash\\t%d\\t0\\t%s\\t%s\\n' "$ts" "$ec" \\
    "$(printf %s "$_SKR_CMD" | base64 | tr -d '\\n')" \\
    "$(printf %s "$PWD" | base64 | tr -d '\\n')" >> "$dir/shell.jsonl"
  _SKR_CMD=
}
PROMPT_COMMAND="_skr_precmd\${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
# <<< skill-recorder (bash) <<<`;

/** PowerShell hook for $PROFILE (Windows / pwsh). */
export const PWSH_HOOK = `# >>> skill-recorder (pwsh) >>>
function prompt {
  $h = Get-History -Count 1
  if ($h -and $h.Id -ne $global:SkrLastId) {
    $global:SkrLastId = $h.Id
    $dir = Join-Path $HOME ".skill-recorder"
    if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
    $ts  = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $ec  = if ($?) { 0 } else { 1 }
    $dur = [int]($h.EndExecutionTime - $h.StartExecutionTime).TotalMilliseconds
    $cmd = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$h.CommandLine))
    $cwd = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($PWD.Path))
    "v1\`t$ts\`tpwsh\`t$ec\`t$dur\`t$cmd\`t$cwd" |
      Out-File -Append -Encoding utf8 (Join-Path $dir "shell.jsonl")
  }
  "PS $($executionContext.SessionState.Path.CurrentLocation)> "
}
# <<< skill-recorder (pwsh) <<<`;

/** All hook snippets keyed by shell, for the setup/doctor UI and docs. */
export const SHELL_HOOKS: Record<"zsh" | "bash" | "pwsh", string> = {
  zsh: ZSH_HOOK,
  bash: BASH_HOOK,
  pwsh: PWSH_HOOK,
};
