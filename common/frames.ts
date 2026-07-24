/** How a retained frame was chosen. `probe` = extracted on demand by the
 *  optimization loop (correlation heuristic or the describer asking for more). */
export type FrameSource = "event" | "scene" | "probe";

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
