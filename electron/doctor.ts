import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { CAPTURE_SOURCES, FULL_CAPTURE } from "../common/config";
import type {
  ActiveWindowInfo,
  BrowserUrlInfo,
  CopilotInfo,
  DoctorReport,
  DoctorSource,
  FfmpegInfo,
} from "../common/ipc";
import { browserUrlProviderKind } from "./collectors/url-provider";
import { sessionsRoot } from "./recorder/session-store";

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

/**
 * Verify the get-windows native addon is actually present for this platform.
 * get-windows silently falls back to no-op stubs when its prebuilt `.node` is
 * missing (e.g. a packaging miss), which would make app-switch tracking die
 * with no error — so we resolve the exact binding path and check it exists.
 */
function checkActiveWindow(): ActiveWindowInfo {
  try {
    const gwIndex = require.resolve("get-windows");
    // Resolve node-pre-gyp from get-windows's own scope so we find the exact copy
    // it uses, whether the dependency is hoisted or nested.
    const gwRequire = createRequire(gwIndex);
    const preGyp = gwRequire("@mapbox/node-pre-gyp") as { find(pkg: string): string };
    const pkgJson = path.join(path.dirname(gwIndex), "package.json");
    const bindingPath = preGyp.find(pkgJson);
    return { ok: existsSync(bindingPath), bindingPath };
  } catch (err) {
    return { ok: false, bindingPath: null, error: err instanceof Error ? err.message : String(err) };
  }
}

function checkBrowserUrl(): BrowserUrlInfo {
  const kind = browserUrlProviderKind();
  return { kind, supported: kind !== "none" };
}

/** Whether a capture source can work at all on the current platform. */
function sourceSupport(key: string, browserUrl: BrowserUrlInfo): { supported: boolean; note?: string } {
  if (key === "browserUrls" && !browserUrl.supported) {
    return { supported: false, note: "Not available on this platform" };
  }
  return { supported: true };
}

/** Environment readiness check surfaced in the UI and (later) a CLI `doctor` command. */
export function runDoctor(): DoctorReport {
  const config = FULL_CAPTURE;
  const browserUrl = checkBrowserUrl();

  const activeSources: DoctorSource[] = CAPTURE_SOURCES.filter((s) => config[s.key]).map((s) => {
    const support = sourceSupport(s.key, browserUrl);
    return { key: s.key, label: s.label, tier: s.tier, cost: s.cost, supported: support.supported, note: support.note };
  });

  return {
    platform: process.platform,
    ffmpeg: checkFfmpeg(),
    copilotCli: checkCopilot(),
    activeWindow: checkActiveWindow(),
    browserUrl,
    sessionsDir: sessionsRoot(),
    activeSources,
  };
}
