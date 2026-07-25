import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { SHELL_HOOKS } from "./terminal-hooks";

/**
 * Terminal capture needs a one-time shell hook installed into the user's shell
 * profile (see terminal-hooks.ts for the snippets). This module detects the
 * active shell, resolves its profile file, reports whether our hook is present,
 * and installs it idempotently. Cross-platform: zsh/bash on macOS + Linux,
 * PowerShell on Windows.
 *
 * The snippet is wrapped in a marked block so install is idempotent and the
 * status check is a simple substring test.
 */

export type SupportedShell = "zsh" | "bash" | "pwsh";

const MARKER = ">>> skill-recorder";

export interface ShellHookStatus {
  /** Detected shell, or null when it isn't one we can hook. */
  shell: SupportedShell | null;
  /** Absolute path to the profile we'd install into, when known. */
  profilePath: string | null;
  /** True when our marked hook block is already present in the profile. */
  installed: boolean;
}

export interface ShellHookInstallResult {
  ok: boolean;
  shell: SupportedShell | null;
  profilePath: string | null;
  /** True when the block was already there and we made no change. */
  alreadyInstalled: boolean;
  error?: string;
}

/** Detect the shell we'd install a hook for on this platform. */
export function detectShell(): SupportedShell | null {
  if (process.platform === "win32") return "pwsh";
  const shellPath = process.env.SHELL ?? "";
  const base = path.basename(shellPath).toLowerCase();
  if (base.includes("zsh")) return "zsh";
  if (base.includes("bash")) return "bash";
  // A sensible default per platform when $SHELL is unset or exotic.
  return process.platform === "darwin" ? "zsh" : "bash";
}

/**
 * Resolve the profile file for a shell. For pwsh we ask PowerShell for its real
 * `$PROFILE.CurrentUserAllHosts` (locale- / OneDrive-aware), falling back to the
 * conventional path when no interpreter is reachable.
 */
export function resolveProfilePath(shell: SupportedShell): string | null {
  const home = os.homedir();
  if (shell === "zsh") return path.join(home, ".zshrc");
  if (shell === "bash") return path.join(home, ".bashrc");
  return resolvePwshProfile(home);
}

function resolvePwshProfile(home: string): string {
  for (const exe of ["pwsh", "powershell.exe"]) {
    try {
      const out = execFileSync(
        exe,
        ["-NoProfile", "-NonInteractive", "-Command", "$PROFILE.CurrentUserAllHosts"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      )
        .trim()
        .split(/\r?\n/)[0];
      if (out) return out;
    } catch {
      // try the next interpreter
    }
  }
  // Conventional PowerShell 7 location when no interpreter answered.
  return path.join(home, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1");
}

function readProfile(profilePath: string): string | null {
  try {
    return existsSync(profilePath) ? readFileSync(profilePath, "utf8") : "";
  } catch {
    return null;
  }
}

/** Whether our marked hook block is present in the resolved profile. */
export function shellHookStatus(): ShellHookStatus {
  const shell = detectShell();
  if (!shell) return { shell: null, profilePath: null, installed: false };
  const profilePath = resolveProfilePath(shell);
  const contents = profilePath ? readProfile(profilePath) : null;
  return {
    shell,
    profilePath,
    installed: contents != null && contents.includes(MARKER),
  };
}

/** Idempotently append our shell hook to the detected shell's profile. */
export function installShellHook(): ShellHookInstallResult {
  const shell = detectShell();
  if (!shell) {
    return {
      ok: false,
      shell: null,
      profilePath: null,
      alreadyInstalled: false,
      error: "No supported shell detected (zsh, bash, or PowerShell).",
    };
  }
  const profilePath = resolveProfilePath(shell);
  if (!profilePath) {
    return { ok: false, shell, profilePath: null, alreadyInstalled: false, error: "Could not resolve a shell profile path." };
  }

  const existing = readProfile(profilePath);
  if (existing == null) {
    return { ok: false, shell, profilePath, alreadyInstalled: false, error: `Could not read ${profilePath}.` };
  }
  if (existing.includes(MARKER)) {
    return { ok: true, shell, profilePath, alreadyInstalled: true };
  }

  try {
    mkdirSync(path.dirname(profilePath), { recursive: true });
    const sep = existing.length && !existing.endsWith("\n") ? "\n\n" : existing.length ? "\n" : "";
    writeFileSync(profilePath, `${existing}${sep}${SHELL_HOOKS[shell]}\n`, "utf8");
    return { ok: true, shell, profilePath, alreadyInstalled: false };
  } catch (err) {
    return {
      ok: false,
      shell,
      profilePath,
      alreadyInstalled: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
