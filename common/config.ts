/**
 * Capture configuration — the knob the user turns to trade *consent + setup*
 * against *description accuracy*. The guiding principle: the default level
 * must work with ZERO permission prompts and ZERO manual setup, and each step
 * up is an explicit, understood opt-in.
 *
 * Cost tiers (per source):
 *   0 — no prompt, no setup   (works out of the box)
 *   1 — one-time OS grant     (accessibility / screen-capture permission)
 *   2 — manual setup          (install a shell hook)
 *   3 — heaviest OS grant     (screen-capture permission for video)
 */

export type CaptureLevel = "basic" | "standard" | "full" | "custom";

export interface CaptureConfig {
  /** Foreground app switches (app name/bundle/pid). Tier 0 — no prompt. */
  appActivity: boolean;
  /** Clipboard copies (formats, length, hash, short preview). Tier 0 — no prompt. */
  clipboard: boolean;
  /** Window titles. Tier 1 — needs an accessibility / screen-capture grant. */
  windowTitles: boolean;
  /** Active browser tab URLs. Tier 1 — needs the same grant as titles. */
  browserUrls: boolean;
  /** Terminal commands. Tier 2 — needs the opt-in shell hook installed. */
  terminal: boolean;
  /** Low-fps screen video + extracted keyframes. Tier 3 — needs screen-capture. */
  video: boolean;
}

export type CaptureSourceKey = keyof CaptureConfig;

/** Preset levels. "custom" is represented by an explicit CaptureConfig, not here. */
export const LEVEL_PRESETS: Record<Exclude<CaptureLevel, "custom">, CaptureConfig> = {
  // Zero friction: nothing here shows an OS prompt or needs setup.
  basic: {
    appActivity: true,
    clipboard: true,
    windowTitles: false,
    browserUrls: false,
    terminal: false,
    video: false,
  },
  // One-time OS grant unlocks the biggest accuracy jump (what/where, not just which app).
  standard: {
    appActivity: true,
    clipboard: true,
    windowTitles: true,
    browserUrls: true,
    terminal: false,
    video: false,
  },
  // Everything, including shell hooks and screen video for frame correlation.
  full: {
    appActivity: true,
    clipboard: true,
    windowTitles: true,
    browserUrls: true,
    terminal: true,
    video: true,
  },
};

export const DEFAULT_LEVEL: CaptureLevel = "basic";

export interface CaptureSourceInfo {
  key: CaptureSourceKey;
  label: string;
  tier: 0 | 1 | 2 | 3;
  /** Short, human description of what enabling this costs the user. */
  cost: string;
}

/** Metadata for the settings UI and the doctor report. */
export const CAPTURE_SOURCES: readonly CaptureSourceInfo[] = [
  { key: "appActivity", label: "App switches", tier: 0, cost: "No permission needed" },
  { key: "clipboard", label: "Clipboard copies", tier: 0, cost: "No permission needed" },
  {
    key: "windowTitles",
    label: "Window titles",
    tier: 1,
    cost: "One-time OS permission",
  },
  {
    key: "browserUrls",
    label: "Browser URLs",
    tier: 1,
    cost: "One-time OS permission",
  },
  { key: "terminal", label: "Terminal commands", tier: 2, cost: "Install a shell hook (one-time)" },
  { key: "video", label: "Screen video + keyframes", tier: 3, cost: "Screen-capture permission" },
];

export function configForLevel(level: Exclude<CaptureLevel, "custom">): CaptureConfig {
  return { ...LEVEL_PRESETS[level] };
}

export interface CaptureLevelInfo {
  level: Exclude<CaptureLevel, "custom">;
  label: string;
  /** One-line summary of the consent/accuracy trade-off. */
  blurb: string;
}

/** Ordered, user-facing descriptions of the preset levels for the settings UI. */
export const CAPTURE_LEVEL_INFO: readonly CaptureLevelInfo[] = [
  {
    level: "basic",
    label: "Basic",
    blurb: "App switches + clipboard. No permissions, no setup.",
  },
  {
    level: "standard",
    label: "Standard",
    blurb: "Adds window titles + browser URLs. One-time OS permission.",
  },
  {
    level: "full",
    label: "Full",
    blurb: "Adds terminal commands + screen video. Most setup, best detail.",
  },
];

/** Reverse-map a config to a named level, or "custom" if it matches no preset. */
export function levelForConfig(config: CaptureConfig): CaptureLevel {
  for (const level of ["basic", "standard", "full"] as const) {
    const preset = LEVEL_PRESETS[level];
    if ((Object.keys(preset) as CaptureSourceKey[]).every((k) => preset[k] === config[k])) {
      return level;
    }
  }
  return "custom";
}

/** True when the config needs no OS prompt and no manual setup (all tier-0). */
export function isFrictionless(config: CaptureConfig): boolean {
  return CAPTURE_SOURCES.every((s) => s.tier === 0 || !config[s.key]);
}
