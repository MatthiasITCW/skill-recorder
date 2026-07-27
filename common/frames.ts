/** How a retained frame was chosen. `probe` = extracted on demand by the
 *  optimization loop (correlation heuristic or the describer asking for more). */
export type FrameSource = "event" | "scene" | "probe";

export const CAPTURED_FRAME_MANIFEST_VERSION = 1;

/** One low-rate screen snapshot captured alongside the WebM recording. */
export interface CapturedVideoFrame {
  /** Path relative to the session directory. */
  file: string;
  /** Wall-clock epoch derived from the recorder's monotonic start anchor. */
  tMs: number;
  /** Monotonic offset from MediaRecorder start. */
  offsetMs: number;
  width: number;
  height: number;
}

/** Versioned source-frame index written by the video recorder. */
export interface CapturedFrameManifest {
  version: typeof CAPTURED_FRAME_MANIFEST_VERSION;
  format: "jpeg";
  heartbeatMs: number;
  frames: CapturedVideoFrame[];
}

export interface FrameRecord {
  /** Filename within the session's `frames/` directory. */
  file: string;
  /** Wall-clock epoch (ms) of this frame, derived from the video anchor. */
  tMs: number;
  /** Offset into the video (seconds). */
  offsetSec: number;
  source: FrameSource;
  /** 16-hex-char dHash (64-bit) used for near-duplicate suppression. */
  phash: string;
  /** Why this frame was kept (e.g. "app.activate", "scene>0.40", "probe:gap"). */
  reason?: string;
}
