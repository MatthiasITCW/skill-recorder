import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

import { CAPTURE_SOURCES } from "../common/config";
import type { CopilotInfo, DoctorReport, FfmpegInfo } from "../common/ipc";
import { sessionsRoot } from "./recorder/session-store";
import type { SettingsStore } from "./settings";

const require = createRequire(import.meta.url);

function which(cmd: string): string | null {
  try {
    const finder = process.platform === "win32" ? "where" : "which";
    const out = execFileSync(finder, [cmd], { encoding: "utf8" })
      .trim()
      .split(/\r?\n/)[0];
    return out || null;
  } catch {
    return null;
  }
}

function checkFfmpeg(): FfmpegInfo {
  let bundled: string | null = null;
  try {
    // ffmpeg-static's default export is the absolute path to a bundled binary.
    bundled = require("ffmpeg-static") as string;
  } catch {
    bundled = null;
  }
  if (bundled && existsSync(bundled)) return { ok: true, path: bundled, source: "bundled" };
  const sys = which("ffmpeg");
  if (sys) return { ok: true, path: sys, source: "system" };
  return { ok: false, path: null, source: "missing" };
}

function checkCopilot(): CopilotInfo {
  const p = which("copilot");
  return { ok: Boolean(p), path: p };
}

/** Environment readiness check surfaced in the UI and (later) a CLI `doctor` command. */
export function runDoctor(settings: SettingsStore): DoctorReport {
  const config = settings.resolve();
  const activeSources = CAPTURE_SOURCES.filter((s) => config[s.key]).map((s) => ({
    key: s.key,
    label: s.label,
    tier: s.tier,
    cost: s.cost,
  }));
  return {
    platform: process.platform,
    ffmpeg: checkFfmpeg(),
    copilotCli: checkCopilot(),
    sessionsDir: sessionsRoot(),
    captureLevel: settings.level,
    activeSources,
  };
}
