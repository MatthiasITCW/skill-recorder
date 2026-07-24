import type { CaptureConfig, CaptureLevel } from "./config";
import type { RecorderState } from "./types";

export interface RecorderStatus {
  state: RecorderState;
  sessionId: string | null;
  startedAt: number | null;
  eventCount: number;
}

export interface StartResult {
  ok: boolean;
  sessionId?: string;
  error?: string;
}

export interface StopResult {
  ok: boolean;
  sessionId?: string;
  sessionDir?: string;
  error?: string;
}

export interface MarkerResult {
  ok: boolean;
  error?: string;
}

export interface FfmpegInfo {
  ok: boolean;
  path: string | null;
  source: "system" | "bundled" | "missing";
}

export interface CopilotInfo {
  ok: boolean;
  path: string | null;
}

export interface DoctorReport {
  platform: NodeJS.Platform;
  ffmpeg: FfmpegInfo;
  copilotCli: CopilotInfo;
  sessionsDir: string;
  captureLevel: CaptureLevel;
  activeSources: { key: string; label: string; tier: number; cost: string }[];
}

/** Current capture configuration plus its resolved named level. */
export interface CaptureState {
  level: CaptureLevel;
  config: CaptureConfig;
}

/** IPC channel names — the single source of truth shared by main + preload. */
export const IPC = {
  start: "recorder:start",
  stop: "recorder:stop",
  status: "recorder:status",
  marker: "recorder:marker",
  doctor: "doctor:check",
  statusChanged: "recorder:status-changed",
  getCapture: "capture:get",
  setLevel: "capture:set-level",
  setConfig: "capture:set-config",
} as const;

/** Shape exposed on `window.skillRecorder` by the preload bridge. */
export interface SkillRecorderApi {
  start(): Promise<StartResult>;
  stop(): Promise<StopResult>;
  status(): Promise<RecorderStatus>;
  marker(note: string): Promise<MarkerResult>;
  doctor(): Promise<DoctorReport>;
  getCapture(): Promise<CaptureState>;
  setLevel(level: Exclude<CaptureLevel, "custom">): Promise<CaptureState>;
  setConfig(config: CaptureConfig): Promise<CaptureState>;
  onStatusChanged(cb: (status: RecorderStatus) => void): () => void;
}
