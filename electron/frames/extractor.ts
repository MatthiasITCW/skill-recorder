import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";

import type { FrameRecord, FrameSource } from "../../common/frames";
import { createLogger } from "../logger";

const log = createLogger("Frames");
const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);

const ffmpegPath = require("ffmpeg-static") as string;
// sharp is native and externalized; require it lazily so a load failure degrades
// to "no dedupe" rather than crashing extraction.
type Sharp = typeof import("sharp");
let sharpMod: Sharp | null | undefined;
function sharp(): Sharp | null {
  if (sharpMod === undefined) {
    try {
      sharpMod = require("sharp") as Sharp;
    } catch (err) {
      log.warn("sharp unavailable; perceptual dedupe disabled:", err instanceof Error ? err.message : err);
      sharpMod = null;
    }
  }
  return sharpMod;
}

export interface ExtractorOptions {
  videoPath: string;
  framesDir: string;
  /** `video.json` startEpoch — the wall-clock anchor for offset↔epoch mapping. */
  anchorEpochMs: number;
  /** Optional known duration (s); guards windows against running past the end. */
  durationSec?: number;
  /** dHash Hamming distance under which two frames count as duplicates. */
  dedupeThreshold?: number;
  /** Hard cap on retained frames, so the adaptive loop can't run away. */
  maxFrames?: number;
  /** Event anchors within this many seconds of each other collapse to one
   *  extraction (≈ one source frame at the video's low fps). Default 0.5. */
  frameGridSec?: number;
}

export interface WindowRequest {
  /** Window start/end as wall-clock epochs (ms). */
  startMs: number;
  endMs: number;
  /** Sampling density within the window (frames per second). */
  fps?: number;
  /** Upper bound on frames pulled from this window. */
  maxFrames?: number;
  /** Optional pixel crop to "zoom" into a region of interest. */
  crop?: { x: number; y: number; w: number; h: number };
  reason?: string;
}

const DEFAULTS = { dedupeThreshold: 8, maxFrames: 300, sceneThreshold: 0.4, frameGridSec: 0.5 };

/**
 * Extracts a *sparse* set of visually-distinct frames from the session video and
 * correlates them to wall-clock time. It is deliberately **re-entrant and
 * additive**: every `extract*` call appends to a single deduplicated manifest
 * (`frames.json`), so callers can keep asking for more frames without producing
 * duplicates. This is what enables the optimization loop — when the correlation
 * engine flags an unexplained gap, or the describer model is unsure about a
 * moment, it calls `extractWindow(...)` to densely (and optionally zoomed-in)
 * sample just that slice, and only genuinely-new frames are kept.
 */
export class FrameExtractor {
  private readonly opts: Required<Omit<ExtractorOptions, "durationSec">> & { durationSec?: number };
  private readonly manifestPath: string;
  private frames: FrameRecord[] = [];

  constructor(opts: ExtractorOptions) {
    this.opts = {
      dedupeThreshold: DEFAULTS.dedupeThreshold,
      maxFrames: DEFAULTS.maxFrames,
      frameGridSec: DEFAULTS.frameGridSec,
      ...opts,
    };
    this.manifestPath = path.join(opts.framesDir, "frames.json");
    if (existsSync(this.manifestPath)) {
      try {
        this.frames = JSON.parse(readFileSync(this.manifestPath, "utf8")) as FrameRecord[];
      } catch {
        this.frames = [];
      }
    }
  }

  /** Current manifest (sorted by time). */
  get manifest(): readonly FrameRecord[] {
    return [...this.frames].sort((a, b) => a.tMs - b.tMs);
  }

  offsetForEpoch(epochMs: number): number {
    return Math.max(0, (epochMs - this.opts.anchorEpochMs) / 1000);
  }

  private epochForOffset(offsetSec: number): number {
    return Math.round(this.opts.anchorEpochMs + offsetSec * 1000);
  }

  /**
   * Extract one frame at each event's wall-clock time. Anchors that land on the
   * same low-fps video frame are collapsed (grid-dedupe) so a burst of events
   * doesn't fire many redundant ffmpeg decodes — event-anchored extraction stays
   * cheap even when the non-video stream is dense.
   */
  async extractAtEpochs(
    events: { tMs: number; reason?: string }[],
    source: FrameSource = "event",
  ): Promise<FrameRecord[]> {
    const gridSec = this.opts.frameGridSec;
    const seen = new Set<number>();
    const added: FrameRecord[] = [];
    const sorted = [...events].sort((a, b) => a.tMs - b.tMs);
    for (const ev of sorted) {
      const offsetSec = this.offsetForEpoch(ev.tMs);
      if (this.opts.durationSec != null && offsetSec > this.opts.durationSec) continue;
      const cell = Math.round(offsetSec / gridSec);
      if (seen.has(cell)) continue;
      seen.add(cell);
      const rec = await this.extractSingle(offsetSec, source, ev.reason);
      if (rec) added.push(rec);
    }
    this.persist();
    return added;
  }

  /** One-pass scene-change detection → keep only visually-distinct frames. */
  async extractScenes(threshold = DEFAULTS.sceneThreshold): Promise<FrameRecord[]> {
    const stamp = Date.now();
    const pattern = path.join(this.opts.framesDir, `scene_${stamp}_%04d.jpg`);
    // showinfo prints pts_time for each selected frame to stderr, in output order.
    const filter = `select='gt(scene,${threshold})',showinfo`;
    let stderr = "";
    try {
      const res = await execFileAsync(
        ffmpegPath,
        ["-hide_banner", "-i", this.opts.videoPath, "-vf", filter, "-vsync", "vfr", "-q:v", "3", pattern],
        { maxBuffer: 32 * 1024 * 1024 },
      );
      stderr = res.stderr;
    } catch (err) {
      stderr = (err as { stderr?: string }).stderr ?? "";
    }

    const times = [...stderr.matchAll(/pts_time:([0-9.]+)/g)].map((m) => Number(m[1]));
    const added: FrameRecord[] = [];
    for (let i = 0; i < times.length; i++) {
      const file = path.join(this.opts.framesDir, `scene_${stamp}_${String(i + 1).padStart(4, "0")}.jpg`);
      if (!existsSync(file)) continue;
      const rec = await this.keepOrDrop(file, times[i], "scene", `scene>${threshold.toFixed(2)}`);
      if (rec) added.push(rec);
    }
    this.persist();
    log.info(`scene pass: ${times.length} candidates → ${added.length} kept`);
    return added;
  }

  /**
   * The adaptive primitive: densely sample a sub-window (optionally zoomed via
   * crop) and keep only new frames. Used by the correlation heuristic and the
   * describer's "I need a closer look" tool.
   */
  async extractWindow(req: WindowRequest): Promise<FrameRecord[]> {
    const fps = req.fps ?? 6;
    const startSec = this.offsetForEpoch(req.startMs);
    const endSec = Math.max(startSec, this.offsetForEpoch(req.endMs));
    const cap = req.maxFrames ?? 24;
    const stamp = Date.now();
    const pattern = path.join(this.opts.framesDir, `probe_${stamp}_%04d.jpg`);

    const vf = [`fps=${fps}`];
    if (req.crop) vf.push(`crop=${req.crop.w}:${req.crop.h}:${req.crop.x}:${req.crop.y}`);

    try {
      await execFileAsync(
        ffmpegPath,
        [
          "-hide_banner",
          "-ss", startSec.toFixed(3),
          "-to", endSec.toFixed(3),
          "-i", this.opts.videoPath,
          "-vf", vf.join(","),
          "-vsync", "vfr",
          "-frames:v", String(cap),
          "-q:v", "3",
          pattern,
        ],
        { maxBuffer: 32 * 1024 * 1024 },
      );
    } catch (err) {
      log.warn("probe window failed:", err instanceof Error ? err.message : err);
      return [];
    }

    const added: FrameRecord[] = [];
    for (let i = 1; i <= cap; i++) {
      const file = path.join(this.opts.framesDir, `probe_${stamp}_${String(i).padStart(4, "0")}.jpg`);
      if (!existsSync(file)) break;
      const offsetSec = startSec + (i - 1) / fps;
      const rec = await this.keepOrDrop(file, offsetSec, "probe", req.reason ?? "probe:window");
      if (rec) added.push(rec);
    }
    this.persist();
    log.info(`probe [${startSec.toFixed(1)}–${endSec.toFixed(1)}s @${fps}fps]: ${added.length} new frames`);
    return added;
  }

  private async extractSingle(
    offsetSec: number,
    source: FrameSource,
    reason?: string,
  ): Promise<FrameRecord | null> {
    const file = path.join(this.opts.framesDir, `${source}_${Math.round(offsetSec * 1000)}.jpg`);
    try {
      // Output-seek (decode from start) is reliable on non-seekable MediaRecorder webm.
      await execFileAsync(
        ffmpegPath,
        ["-hide_banner", "-i", this.opts.videoPath, "-ss", offsetSec.toFixed(3), "-frames:v", "1", "-q:v", "3", "-y", file],
        { maxBuffer: 16 * 1024 * 1024 },
      );
    } catch (err) {
      log.warn(`frame at ${offsetSec.toFixed(2)}s failed:`, err instanceof Error ? err.message : err);
      return null;
    }
    if (!existsSync(file)) return null;
    return this.keepOrDrop(file, offsetSec, source, reason);
  }

  /** Compute the hash, drop near-duplicates and over-budget frames, else record. */
  private async keepOrDrop(
    file: string,
    offsetSec: number,
    source: FrameSource,
    reason?: string,
  ): Promise<FrameRecord | null> {
    if (this.frames.length >= this.opts.maxFrames) {
      await unlink(file).catch(() => undefined);
      return null;
    }
    const phash = await dhash(file);
    if (phash) {
      for (const existing of this.frames) {
        if (hamming(existing.phash, phash) <= this.opts.dedupeThreshold) {
          await unlink(file).catch(() => undefined);
          return null;
        }
      }
    }
    const rec: FrameRecord = {
      file: path.basename(file),
      tMs: this.epochForOffset(offsetSec),
      offsetSec: Number(offsetSec.toFixed(3)),
      source,
      phash: phash ?? "",
      ...(reason ? { reason } : {}),
    };
    this.frames.push(rec);
    return rec;
  }

  private persist(): void {
    try {
      writeFileSync(this.manifestPath, JSON.stringify(this.manifest, null, 2));
    } catch (err) {
      log.warn("failed to persist frames.json:", err instanceof Error ? err.message : err);
    }
  }
}

/** 64-bit difference hash (dHash) as 16 hex chars; "" when sharp is unavailable. */
async function dhash(file: string): Promise<string> {
  const s = sharp();
  if (!s) return "";
  try {
    const w = 9;
    const h = 8;
    const buf = await s(file).grayscale().resize(w, h, { fit: "fill" }).raw().toBuffer();
    let bits = "";
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w - 1; col++) {
        bits += buf[row * w + col] < buf[row * w + col + 1] ? "1" : "0";
      }
    }
    let hex = "";
    for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    return hex;
  } catch {
    return "";
  }
}

function hamming(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return Number.MAX_SAFE_INTEGER;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}
