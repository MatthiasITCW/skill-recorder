import type { FrameRecord } from "./frames";
import type { RecEvent } from "./types";

/**
 * Event types that carry semantic meaning for correlation. Structural events
 * (session/video lifecycle, frame bookkeeping) are ignored — they neither
 * "explain" a visual change nor count as a moment that should have produced one.
 */
export const MEANINGFUL_EVENT_TYPES = new Set<string>([
  "app.activate",
  "app.title-change",
  "browser.url",
  "terminal.command",
  "clipboard.change",
  "marker",
]);

/** The active application/URL context at a given instant. */
export interface ActiveContext {
  app?: string;
  title?: string;
  url?: string;
  host?: string;
}

/** A frame enriched with its surrounding event context. */
export interface CorrelatedFrame extends FrameRecord {
  /** Active app/url at this frame's instant (from the last preceding event). */
  context: ActiveContext;
  /** Seqs of meaningful events within the correlation window, nearest first. */
  nearestEventSeqs: number[];
  /** ms to the single nearest meaningful event (Infinity if none in window). */
  nearestEventGapMs: number;
  /**
   * A visual change (`scene`/`probe`) with no meaningful event nearby — exactly
   * what the event stream misses. These are candidate micro-steps and the seeds
   * for the adaptive probe loop.
   */
  unexplained: boolean;
}

/** A meaningful event that produced no visually-distinct frame nearby. */
export interface SilentEvent {
  seq: number;
  type: string;
  tMs: number;
  /** ms to the nearest frame (Infinity if the video has none). */
  nearestFrameGapMs: number;
}

/** A window the heuristic wants sampled more densely (the optimization loop). */
export interface ProbeRequest {
  startMs: number;
  endMs: number;
  reason: string;
  /** Suggested sampling density (fps) for this window. */
  fps?: number;
  /** Suggested per-window frame cap. */
  maxFrames?: number;
}

export interface CorrelationResult {
  frames: CorrelatedFrame[];
  silentEvents: SilentEvent[];
  /** Windows to densify next (merged, de-duplicated). */
  probeRequests: ProbeRequest[];
  stats: {
    frameCount: number;
    unexplainedCount: number;
    silentEventCount: number;
    meaningfulEventCount: number;
  };
}

export interface CorrelationOptions {
  /** ± window (ms) for snapping frames to events and vice-versa. Default 1500. */
  windowMs?: number;
  /** Half-width (ms) of the probe window generated around an unexplained frame. */
  probePadMs?: number;
  /** A span between consecutive meaningful events longer than this (ms) is a
   *  candidate for opportunistic video probing. Default 10000. */
  gapProbeMs?: number;
  /** Max gap-probe suggestions emitted (largest gaps first). Default 8. */
  maxGapProbes?: number;
}

export const CORRELATION_DEFAULTS: Required<CorrelationOptions> = {
  windowMs: 1500,
  probePadMs: 1200,
  gapProbeMs: 10000,
  maxGapProbes: 8,
};

/** Sampling defaults for the two kinds of opportunistic probe. */
export const PROBE_DEFAULTS = {
  /** Unexplained-change probes: zoom in, sample densely. */
  padFps: 6,
  padMaxFrames: 24,
  /** Event-less gap probes: cheap low-fps sweep just to notice change. */
  gapFps: 1.5,
  gapMaxFrames: 12,
} as const;

export type { RecEvent, FrameRecord };

// --- Pure correlation core (no I/O, no runtime deps) -----------------------

function isMeaningful(ev: RecEvent): boolean {
  return MEANINGFUL_EVENT_TYPES.has(ev.type);
}

/** Fold an event's payload into the running active-app/url context. */
function applyContext(ctx: ActiveContext, ev: RecEvent): void {
  const p = ev.payload as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
  switch (ev.type) {
    case "app.activate":
      ctx.app = str(p.app) ?? ctx.app;
      ctx.title = str(p.title);
      ctx.url = str(p.url);
      ctx.host = str(p.host);
      break;
    case "app.title-change":
      ctx.app = str(p.app) ?? ctx.app;
      ctx.title = str(p.title);
      break;
    case "browser.url":
      ctx.app = str(p.app) ?? ctx.app;
      ctx.url = str(p.url);
      ctx.host = str(p.host);
      if (str(p.title)) ctx.title = str(p.title);
      break;
    default:
      break;
  }
}

/** Merge overlapping/adjacent probe windows (within `gapMs`) into fewer spans. */
function mergeWindows(reqs: ProbeRequest[], gapMs: number): ProbeRequest[] {
  if (reqs.length === 0) return [];
  const sorted = [...reqs].sort((a, b) => a.startMs - b.startMs);
  const out: ProbeRequest[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    if (sorted[i].startMs <= last.endMs + gapMs) {
      last.endMs = Math.max(last.endMs, sorted[i].endMs);
    } else {
      out.push({ ...sorted[i] });
    }
  }
  return out;
}

/**
 * Snap each frame to its surrounding events and active app/url context, flag
 * unexplained visual changes and silent events, and propose opportunistic probe
 * windows to densify. Pure and deterministic — trivially unit-testable.
 */
export function correlate(
  events: readonly RecEvent[],
  frames: readonly FrameRecord[],
  options: CorrelationOptions = {},
): CorrelationResult {
  const { windowMs, probePadMs, gapProbeMs, maxGapProbes } = { ...CORRELATION_DEFAULTS, ...options };

  const evs = [...events].sort((a, b) => a.epoch - b.epoch);
  const meaningful = evs.filter(isMeaningful);
  const sortedFrames = [...frames].sort((a, b) => a.tMs - b.tMs);

  const correlatedFrames: CorrelatedFrame[] = [];
  const explainedFrameTimes: number[] = []; // frame times, for silent-event check

  // Rolling context: advance a pointer through events as we walk frames forward.
  const ctx: ActiveContext = {};
  let ctxIdx = 0;

  for (const frame of sortedFrames) {
    while (ctxIdx < evs.length && evs[ctxIdx].epoch <= frame.tMs) {
      applyContext(ctx, evs[ctxIdx]);
      ctxIdx++;
    }

    // Meaningful events within the ± window, nearest first.
    const near = meaningful
      .map((e) => ({ seq: e.seq, gap: Math.abs(e.epoch - frame.tMs) }))
      .filter((e) => e.gap <= windowMs)
      .sort((a, b) => a.gap - b.gap);

    const nearestGap = near.length ? near[0].gap : Number.POSITIVE_INFINITY;
    const unexplained = frame.source !== "event" && near.length === 0;

    correlatedFrames.push({
      ...frame,
      context: { ...ctx },
      nearestEventSeqs: near.map((e) => e.seq),
      nearestEventGapMs: nearestGap,
      unexplained,
    });
    explainedFrameTimes.push(frame.tMs);
  }

  // Silent events: meaningful events with no visually-distinct frame nearby.
  const silentEvents: SilentEvent[] = [];
  for (const ev of meaningful) {
    let best = Number.POSITIVE_INFINITY;
    for (const t of explainedFrameTimes) {
      const gap = Math.abs(t - ev.epoch);
      if (gap < best) best = gap;
    }
    if (best > windowMs) {
      silentEvents.push({ seq: ev.seq, type: ev.type, tMs: ev.epoch, nearestFrameGapMs: best });
    }
  }

  // Two kinds of opportunistic-probe suggestion, embodying "video is secondary":
  //  1. unexplained visual changes → zoom/densify around them.
  //  2. long event-less gaps → cheap low-fps sweep to catch what our non-video
  //     events missed. These *self-scale*: the richer the non-video stream, the
  //     shorter the gaps, the fewer probes — exactly the intended bias.
  const padProbes = mergeWindows(
    correlatedFrames
      .filter((f) => f.unexplained)
      .map((f) => ({
        startMs: f.tMs - probePadMs,
        endMs: f.tMs + probePadMs,
        reason: "probe:unexplained",
        fps: PROBE_DEFAULTS.padFps,
        maxFrames: PROBE_DEFAULTS.padMaxFrames,
      })),
    windowMs,
  );

  const gapProbes: ProbeRequest[] = [];
  for (let i = 1; i < meaningful.length; i++) {
    const start = meaningful[i - 1].epoch;
    const end = meaningful[i].epoch;
    if (end - start > gapProbeMs) {
      gapProbes.push({
        startMs: start,
        endMs: end,
        reason: "probe:gap",
        fps: PROBE_DEFAULTS.gapFps,
        maxFrames: PROBE_DEFAULTS.gapMaxFrames,
      });
    }
  }
  gapProbes.sort((a, b) => b.endMs - b.startMs - (a.endMs - a.startMs));

  const probeRequests = [...padProbes, ...gapProbes.slice(0, maxGapProbes)];

  return {
    frames: correlatedFrames,
    silentEvents,
    probeRequests,
    stats: {
      frameCount: correlatedFrames.length,
      unexplainedCount: correlatedFrames.filter((f) => f.unexplained).length,
      silentEventCount: silentEvents.length,
      meaningfulEventCount: meaningful.length,
    },
  };
}
