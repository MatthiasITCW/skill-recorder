import type { Analysis, AnalysisFeedback, Confidence } from "./analysis";
import type { CaptureConfig, CaptureLevel } from "./config";
import type { BuiltSkill, SkillArchitecture, SkillPlan } from "./skill";
import type { RecorderState } from "./types";

/** The last completed session — the one that can be analyzed. */
export interface LastSession {
  id: string;
  /** True once post-processing (bundle/description/frames) has finished. */
  processed: boolean;
}

/** A saved recording as shown in the sessions library. */
export interface SessionSummary {
  id: string;
  startedAt: number | null;
  stoppedAt: number | null;
  durationMs: number | null;
  /** True once post-processing produced a bundle. */
  processed: boolean;
  hasVideo: boolean;
  /** True once a skill has been built and persisted for this session. */
  hasSkill: boolean;
  /** Present once the describer has produced an analysis for this session. */
  analysis: {
    revision: number;
    title: string;
    intent: string;
    intentConfidence: Confidence;
    stepCount: number;
  } | null;
}

export interface RecorderStatus {
  state: RecorderState;
  sessionId: string | null;
  startedAt: number | null;
  eventCount: number;
  /** Set after a recording stops; drives the "Analyze" affordance. */
  lastSession: LastSession | null;
}

/** Streamed to the renderer while the describer agent works. */
export interface AnalyzeProgress {
  sessionId: string;
  phase: "start" | "working" | "drafting" | "done" | "error";
  message: string;
}

/** Result of an analyze / feedback round. */
export interface AnalyzeResult {
  ok: boolean;
  analysis?: Analysis;
  error?: string;
}

/** Feedback payload sent from the renderer for a re-analysis round. */
export interface AnalysisFeedbackInput extends AnalysisFeedback {
  sessionId: string;
}

/** A direct text edit to the intent/title, applied without re-running the agent. */
export interface AnalysisEditInput {
  sessionId: string;
  /** New short label; empty string clears it (list falls back to the intent). */
  title?: string;
  /** New one-sentence goal; blank/whitespace is ignored (intent can't be emptied). */
  intent?: string;
}

/* --- Skill Builder -------------------------------------------------------- */

/** Streamed to the renderer while the skill-builder agent works. */
export interface SkillBuildProgress {
  sessionId: string;
  phase: "start" | "working" | "drafting" | "done" | "error";
  message: string;
}

/** Start a build (or refine one) for a session's analysis. */
export interface SkillBuildInput {
  sessionId: string;
  /** Target architecture (only "scout" is enabled today). */
  architecture: SkillArchitecture;
  /** Natural-language refinement for the current plan; omit for the first pass. */
  feedback?: string;
}

/** Result of a propose/refine round: the plan to show the user. */
export interface SkillPlanResult {
  ok: boolean;
  plan?: SkillPlan;
  error?: string;
}

/** Result of finalizing + exporting a skill. */
export interface SkillCreateResult {
  ok: boolean;
  skill?: BuiltSkill;
  /** Absolute path of the exported SKILL.md. */
  path?: string;
  error?: string;
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

export interface DeleteSessionResult {
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
  analyze: "analyze:start",
  analyzeFeedback: "analyze:feedback",
  getAnalysis: "analyze:get",
  updateAnalysis: "analyze:update",
  cancelAnalysis: "analyze:cancel",
  analyzeProgress: "analyze:progress",
  listSessions: "sessions:list",
  deleteSession: "sessions:delete",
  buildSkill: "skill:build",
  createSkill: "skill:create",
  getSkill: "skill:get",
  cancelSkill: "skill:cancel",
  revealSkill: "skill:reveal",
  skillProgress: "skill:progress",
  openLibrary: "ui:open-library",
  closeLibrary: "ui:close-library",
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
  /** Run the Copilot describer on a session (defaults to the last completed one). */
  analyze(sessionId?: string): Promise<AnalyzeResult>;
  /** Send NL feedback and re-analyze in the same multi-turn session. */
  analyzeFeedback(input: AnalysisFeedbackInput): Promise<AnalyzeResult>;
  /** Load the persisted analysis for a session, if any. */
  getAnalysis(sessionId: string): Promise<Analysis | null>;
  /** Edit the title/intent text directly (no re-analysis). */
  updateAnalysis(input: AnalysisEditInput): Promise<AnalyzeResult>;
  /** Abort an in-flight analysis. */
  cancelAnalysis(sessionId: string): Promise<{ ok: boolean }>;
  onAnalyzeProgress(cb: (progress: AnalyzeProgress) => void): () => void;
  /** All saved recordings, newest first, for the sessions library. */
  listSessions(): Promise<SessionSummary[]>;
  /** Permanently delete a saved recording and all its artifacts from disk. */
  deleteSession(sessionId: string): Promise<DeleteSessionResult>;
  /**
   * Propose (or refine) a skill from a recording's analysis. Pass `feedback` to
   * revise the current plan in the same multi-turn conversation.
   */
  buildSkill(input: SkillBuildInput): Promise<SkillPlanResult>;
  /** Finalize the proposed skill and export its SKILL.md into the target agent. */
  createSkill(sessionId: string): Promise<SkillCreateResult>;
  /** Load a previously built skill for a session, if any. */
  getSkill(sessionId: string): Promise<BuiltSkill | null>;
  /** Abort an in-flight build. */
  cancelSkill(sessionId: string): Promise<{ ok: boolean }>;
  /** Reveal an exported SKILL.md in the OS file manager. */
  /** Reveal a session's exported SKILL.md in the OS file manager. */
  revealSkill(sessionId: string): Promise<{ ok: boolean }>;
  onSkillProgress(cb: (progress: SkillBuildProgress) => void): () => void;
  /** Open (and focus) the Sessions library window, docked to the recorder. */
  openLibrary(): Promise<void>;
  /** Close the Sessions library window from within it. */
  closeLibrary(): Promise<void>;
}
