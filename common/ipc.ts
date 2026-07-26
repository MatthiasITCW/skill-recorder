import type { Analysis, AnalysisFeedback, AnalysisStep, Confidence } from "./analysis";
import type { AutomationPlan, BuiltAutomation } from "./automation";
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
  /** True once an automation has been built and persisted for this session. */
  hasAutomation: boolean;
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

/** A direct edit to the analysis, applied without re-running the agent. Any subset
 *  of fields may be sent; the rest are left untouched. */
export interface AnalysisEditInput {
  sessionId: string;
  /** New short label; empty string clears it (list falls back to the intent). */
  title?: string;
  /** New one-sentence goal; blank/whitespace is ignored (intent can't be emptied). */
  intent?: string;
  /** The full, user-edited ordered steps; replaces the current steps when present. */
  steps?: AnalysisStep[];
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

/* --- Automation Builder --------------------------------------------------- */

/** Streamed to the renderer while the automation-builder agent works. */
export interface AutomationBuildProgress {
  sessionId: string;
  phase: "start" | "working" | "drafting" | "done" | "error";
  message: string;
}

/** Start an automation build (or refine one) for a session's analysis. */
export interface AutomationBuildInput {
  sessionId: string;
  /** Target architecture (only "scout" is enabled today). */
  architecture: SkillArchitecture;
  /** Natural-language refinement for the current plan; omit for the first pass. */
  feedback?: string;
}

/** Result of a propose/refine round: the automation plan to show the user. */
export interface AutomationPlanResult {
  ok: boolean;
  plan?: AutomationPlan;
  error?: string;
}

/** Result of finalizing + exporting an automation bundle. */
export interface AutomationCreateResult {
  ok: boolean;
  automation?: BuiltAutomation;
  /** Absolute path of the exported automation.json. */
  path?: string;
  error?: string;
}

export interface StartResult {
  ok: boolean;
  sessionId?: string;
  error?: string;
}

/** Per-session capture choices the user makes in the HUD before recording. */
export interface StartOptions {
  /** Capture microphone narration for this session (opt-in, off by default). */
  narration?: boolean;
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

/** Whether the native window-tracking addon (get-windows) loaded for this platform. */
export interface ActiveWindowInfo {
  ok: boolean;
  /** The prebuilt binding path we resolved, for troubleshooting. */
  bindingPath: string | null;
  error?: string;
}

/** How, and whether, active-tab URLs can be read on this platform. */
export interface BrowserUrlInfo {
  kind: "applescript" | "uia" | "none";
  supported: boolean;
}

/** One capture source in the doctor report, annotated with platform support. */
export interface DoctorSource {
  key: string;
  label: string;
  tier: number;
  cost: string;
  /** False when this source can't work on the current platform. */
  supported: boolean;
  /** Short reason shown when unsupported, or a setup nudge. */
  note?: string;
}

export interface DoctorReport {
  platform: NodeJS.Platform;
  ffmpeg: FfmpegInfo;
  copilotCli: CopilotInfo;
  activeWindow: ActiveWindowInfo;
  browserUrl: BrowserUrlInfo;
  sessionsDir: string;
  activeSources: DoctorSource[];
}

/** IPC channel names — the single source of truth shared by main + preload. */
export const IPC = {
  start: "recorder:start",
  stop: "recorder:stop",
  status: "recorder:status",
  marker: "recorder:marker",
  doctor: "doctor:check",
  statusChanged: "recorder:status-changed",
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
  buildAutomation: "automation:build",
  createAutomation: "automation:create",
  getAutomation: "automation:get",
  cancelAutomation: "automation:cancel",
  revealAutomation: "automation:reveal",
  automationProgress: "automation:progress",
  openLibrary: "ui:open-library",
  closeLibrary: "ui:close-library",
} as const;

/** Shape exposed on `window.skillRecorder` by the preload bridge. */
export interface SkillRecorderApi {
  start(options?: StartOptions): Promise<StartResult>;
  stop(): Promise<StopResult>;
  status(): Promise<RecorderStatus>;
  marker(note: string): Promise<MarkerResult>;
  doctor(): Promise<DoctorReport>;
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
  /**
   * Finalize the (user-edited) skill plan and export its SKILL.md into the target
   * agent. The edited plan the user sees is authoritative — the body is written
   * from exactly these inputs and steps.
   */
  createSkill(sessionId: string, plan: SkillPlan): Promise<SkillCreateResult>;
  /** Load a previously built skill for a session, if any. */
  getSkill(sessionId: string): Promise<BuiltSkill | null>;
  /** Abort an in-flight build. */
  cancelSkill(sessionId: string): Promise<{ ok: boolean }>;
  /** Reveal an exported SKILL.md in the OS file manager. */
  /** Reveal a session's exported SKILL.md in the OS file manager. */
  revealSkill(sessionId: string): Promise<{ ok: boolean }>;
  onSkillProgress(cb: (progress: SkillBuildProgress) => void): () => void;
  /**
   * Propose (or refine) an automation from a recording's analysis. Pass `feedback`
   * to revise the current plan in the same multi-turn conversation.
   */
  buildAutomation(input: AutomationBuildInput): Promise<AutomationPlanResult>;
  /** Finalize the (user-edited) automation plan and export its importable bundle.
   *  The edited plan is authoritative — the bundle is built from it verbatim. */
  createAutomation(sessionId: string, plan: AutomationPlan): Promise<AutomationCreateResult>;
  /** Load a previously built automation for a session, if any. */
  getAutomation(sessionId: string): Promise<BuiltAutomation | null>;
  /** Abort an in-flight automation build. */
  cancelAutomation(sessionId: string): Promise<{ ok: boolean }>;
  /** Reveal a session's exported automation bundle in the OS file manager. */
  revealAutomation(sessionId: string): Promise<{ ok: boolean }>;
  onAutomationProgress(cb: (progress: AutomationBuildProgress) => void): () => void;
  /** Open (and focus) the Sessions library window, docked to the recorder. */
  openLibrary(): Promise<void>;
  /** Close the Sessions library window from within it. */
  closeLibrary(): Promise<void>;
}
