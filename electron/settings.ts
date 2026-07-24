import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { app } from "electron";

import {
  type CaptureConfig,
  type CaptureLevel,
  configForLevel,
  DEFAULT_LEVEL,
  levelForConfig,
  LEVEL_PRESETS,
} from "../common/config";
import { createLogger } from "./logger";

const log = createLogger("Settings");

interface PersistedSettings {
  level: CaptureLevel;
  /** Only meaningful when level === "custom". */
  custom?: CaptureConfig;
}

/**
 * Persists the user's capture-level choice to `<userData>/settings.json` and
 * resolves it into a concrete CaptureConfig for the recorder. Defaults to the
 * frictionless `basic` level on first run so nothing prompts until the user
 * opts in.
 */
export class SettingsStore {
  private readonly file: string;
  private settings: PersistedSettings;

  constructor() {
    this.file = path.join(app.getPath("userData"), "settings.json");
    this.settings = this.load();
  }

  private load(): PersistedSettings {
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as Partial<PersistedSettings>;
      const level = raw.level ?? DEFAULT_LEVEL;
      if (level === "custom" && raw.custom) {
        return { level, custom: { ...LEVEL_PRESETS.basic, ...raw.custom } };
      }
      if (level !== "custom") return { level };
    } catch {
      // Missing/corrupt file — fall through to default.
    }
    return { level: DEFAULT_LEVEL };
  }

  private save(): void {
    try {
      writeFileSync(this.file, JSON.stringify(this.settings, null, 2));
    } catch (err) {
      log.warn("failed to persist settings:", err instanceof Error ? err.message : err);
    }
  }

  get level(): CaptureLevel {
    return this.settings.level;
  }

  /** The concrete capture config in effect right now. */
  resolve(): CaptureConfig {
    if (this.settings.level === "custom" && this.settings.custom) {
      return { ...this.settings.custom };
    }
    if (this.settings.level !== "custom") {
      return configForLevel(this.settings.level);
    }
    return configForLevel("basic");
  }

  /** Select a named preset level. */
  setLevel(level: Exclude<CaptureLevel, "custom">): CaptureConfig {
    this.settings = { level };
    this.save();
    return this.resolve();
  }

  /** Apply a full custom config; normalises to a named level if it matches a preset. */
  setConfig(config: CaptureConfig): CaptureConfig {
    const level = levelForConfig(config);
    this.settings = level === "custom" ? { level, custom: { ...config } } : { level };
    this.save();
    return this.resolve();
  }
}
