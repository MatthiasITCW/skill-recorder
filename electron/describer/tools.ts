import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Tool } from "@github/copilot-sdk";

import { AnalysisSubmissionSchema, type AnalysisSubmission } from "../../common/analysis";
import { MEANINGFUL_EVENT_TYPES } from "../../common/correlation";
import type { SessionBundle } from "../../common/bundle";
import type { RecEvent } from "../../common/types";
import { readEvents } from "../frames/correlate";
import type { FrameExtractor } from "../frames/extractor";
import { createLogger } from "../logger";

const log = createLogger("Describer/tools");

/** Everything a session's tools are bound to. */
export interface ToolContext {
  sessionDir: string;
  /** `session.json` startedAt (epoch ms) — origin of the agent's `atMs` clock. */
  startedAt: number;
  /** Frame service, or null when the session has no video. */
  extractor: FrameExtractor | null;
  /** Streamed to the UI as the agent works. */
  onProgress?: (message: string) => void;
  /** Called when the agent submits a (validated) analysis. */
  onSubmit: (submission: AnalysisSubmission) => void;
}

const MAX_IMAGES_PER_CALL = 6;
const MAX_STR = 2000;

const truncate = (v: unknown): unknown =>
  typeof v === "string" && v.length > MAX_STR ? v.slice(0, MAX_STR) + "…[truncated]" : v;

function readBundle(sessionDir: string): SessionBundle | null {
  const p = path.join(sessionDir, "bundle.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as SessionBundle;
  } catch {
    return null;
  }
}

/**
 * Build the custom in-process tools exposed to one Copilot session. Handlers run
 * in the Electron main process (dispatched over JSON-RPC by the SDK), read the
 * session's captured signals, and — for frames — return the JPEGs **inline** so
 * the model can see the screen without any `view`/`bash` tool. `submit_analysis`
 * captures guaranteed-structured output. The whole surface is sandboxed to the
 * one session dir.
 */
export function createDescriberTools(ctx: ToolContext): Tool[] {
  const { sessionDir, startedAt, extractor, onSubmit } = ctx;
  const progress = (m: string) => ctx.onProgress?.(m);
  const rel = (epoch: number) => Math.round(epoch - startedAt);
  const abs = (atMs: number) => startedAt + atMs;
  const sec = (atMs: number) => (atMs / 1000).toFixed(1);

  const getTimeline: Tool = {
    name: "get_timeline",
    description:
      "Return the segmented session timeline: ordered steps with their start time (atMs, ms since recording start), duration, app, urls, titles, commands, clipboard counts and markers. Call this first.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    handler: () => {
      progress("Reading the timeline…");
      const bundle = readBundle(sessionDir);
      if (!bundle) {
        return "No timeline is available yet (bundle.json missing). Use get_events to read the raw event stream instead.";
      }
      const view = {
        durationMs: bundle.session.durationMs,
        platform: bundle.session.platform,
        stats: bundle.stats,
        steps: bundle.steps.map((s) => ({
          index: s.index,
          atMs: rel(s.startMs),
          durationMs: s.durationMs,
          boundary: s.boundary,
          app: s.app,
          titles: s.titles,
          hosts: s.hosts,
          urls: s.urls,
          commands: s.commands,
          clipboardCount: s.clipboardCount,
          markers: s.markers,
          frameCount: s.frames.length,
          summary: s.summary,
        })),
      };
      return JSON.stringify(view, null, 2);
    },
  };

  const getEvents: Tool = {
    name: "get_events",
    description:
      "Return the raw event stream (with clipboard text, full titles, full URLs, commands). Optionally filter by `types` (e.g. [\"browser.url\",\"clipboard.change\"]) and/or a time window `fromMs`/`toMs` (atMs, ms since recording start). Defaults to the meaningful events across the whole session.",
    parameters: {
      type: "object",
      properties: {
        types: { type: "array", items: { type: "string" }, description: "Event types to include." },
        fromMs: { type: "number", description: "Window start (atMs)." },
        toMs: { type: "number", description: "Window end (atMs)." },
      },
      additionalProperties: false,
    },
    handler: (raw) => {
      const args = (raw ?? {}) as { types?: string[]; fromMs?: number; toMs?: number };
      const wanted = args.types && args.types.length ? new Set(args.types) : null;
      const from = typeof args.fromMs === "number" ? args.fromMs : -Infinity;
      const to = typeof args.toMs === "number" ? args.toMs : Infinity;
      progress(
        `Reading events ${args.fromMs != null ? sec(args.fromMs) + "s" : "start"}–${
          args.toMs != null ? sec(args.toMs) + "s" : "end"
        }…`,
      );
      let events: RecEvent[];
      try {
        events = readEvents(path.join(sessionDir, "events.jsonl"));
      } catch (err) {
        return `Could not read events: ${err instanceof Error ? err.message : String(err)}`;
      }
      const rows = events
        .filter((e) => (wanted ? wanted.has(e.type) : MEANINGFUL_EVENT_TYPES.has(e.type)))
        .map((e) => ({ e, atMs: rel(e.epoch) }))
        .filter(({ atMs }) => atMs >= from && atMs <= to)
        .map(({ e, atMs }) => {
          const payload: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(e.payload)) payload[k] = truncate(v);
          return { seq: e.seq, atMs, type: e.type, source: e.source, ...payload };
        });
      return JSON.stringify({ count: rows.length, events: rows }, null, 2);
    },
  };

  const listFrames: Tool = {
    name: "list_frames",
    description:
      "List the screen frames already available for this session (file, atMs, source, reason). Returns an empty list when no video was recorded. Use get_frames to actually view frames.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    handler: () => {
      progress("Listing available frames…");
      if (!extractor) return JSON.stringify({ hasVideo: false, frames: [] });
      const frames = extractor.manifest.map((f) => ({
        file: f.file,
        atMs: rel(f.tMs),
        source: f.source,
        reason: f.reason,
      }));
      return JSON.stringify({ hasVideo: true, frames }, null, 2);
    },
  };

  const getFrames: Tool = {
    name: "get_frames",
    description:
      "Sample and VIEW screen frames within a time window [fromMs, toMs] (atMs, ms since recording start). Densely re-samples the window if needed (optional `fps`, default 6) and returns the frames inline as images so you can see the screen. Optional `crop` {x,y,w,h} zooms a region. Use only where events are ambiguous.",
    parameters: {
      type: "object",
      properties: {
        fromMs: { type: "number", description: "Window start (atMs)." },
        toMs: { type: "number", description: "Window end (atMs)." },
        fps: { type: "number", description: "Sampling density (frames/sec). Default 6." },
        crop: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            w: { type: "number" },
            h: { type: "number" },
          },
          required: ["x", "y", "w", "h"],
          additionalProperties: false,
        },
        reason: { type: "string", description: "Why you need a closer look." },
      },
      required: ["fromMs", "toMs"],
      additionalProperties: false,
    },
    handler: async (raw) => {
      const args = (raw ?? {}) as {
        fromMs?: number;
        toMs?: number;
        fps?: number;
        crop?: { x: number; y: number; w: number; h: number };
        reason?: string;
      };
      if (!extractor) {
        return { textResultForLlm: "No video was recorded for this session; no frames are available.", resultType: "failure" };
      }
      const fromMs = typeof args.fromMs === "number" ? args.fromMs : 0;
      const toMs = typeof args.toMs === "number" ? Math.max(fromMs, args.toMs) : fromMs + 3000;
      progress(`Looking at ${sec(fromMs)}–${sec(toMs)}s…`);
      try {
        await extractor.extractWindow({
          startMs: abs(fromMs),
          endMs: abs(toMs),
          fps: args.fps,
          crop: args.crop,
          reason: args.reason ?? "describer:get_frames",
        });
      } catch (err) {
        log.warn("get_frames extract failed:", err instanceof Error ? err.message : err);
      }

      const inWindow = extractor.manifest.filter((f) => {
        const atMs = rel(f.tMs);
        return atMs >= fromMs && atMs <= toMs;
      });
      if (inWindow.length === 0) {
        return { textResultForLlm: `No frames could be extracted for ${sec(fromMs)}–${sec(toMs)}s.`, resultType: "success" };
      }
      // Evenly sample which frames to attach as images (bounded cost).
      const picks: typeof inWindow = [];
      if (inWindow.length <= MAX_IMAGES_PER_CALL) picks.push(...inWindow);
      else {
        const stride = (inWindow.length - 1) / (MAX_IMAGES_PER_CALL - 1);
        for (let i = 0; i < MAX_IMAGES_PER_CALL; i++) picks.push(inWindow[Math.round(i * stride)]);
      }

      const binaryResultsForLlm: { data: string; mimeType: string; type: "image"; description?: string }[] = [];
      for (const f of picks) {
        const file = path.join(sessionDir, "frames", f.file);
        if (!existsSync(file)) continue;
        try {
          binaryResultsForLlm.push({
            data: readFileSync(file).toString("base64"),
            mimeType: "image/jpeg",
            type: "image",
            description: `${sec(rel(f.tMs))}s (${f.source}) ${f.file}`,
          });
        } catch (err) {
          log.warn("frame read failed:", err instanceof Error ? err.message : err);
        }
      }
      const listing = inWindow.map((f) => `- ${sec(rel(f.tMs))}s ${f.file} (${f.source})`).join("\n");
      progress(`Attached ${binaryResultsForLlm.length} frame image(s) from ${sec(fromMs)}–${sec(toMs)}s.`);
      return {
        textResultForLlm:
          `Frames in ${sec(fromMs)}–${sec(toMs)}s (${inWindow.length} total, ${binaryResultsForLlm.length} shown as images):\n${listing}`,
        binaryResultsForLlm,
        resultType: "success",
      };
    },
  };

  const submitAnalysis: Tool = {
    name: "submit_analysis",
    description:
      "Submit your final structured analysis: the overall intent and the ordered list of steps. Call this exactly once when confident (and again on later turns after incorporating feedback).",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description:
            'A short 2–5 word label for this task in Title Case, no trailing period, e.g. "Research habit articles" or "Extract invoice data". Used as the session name in lists.',
        },
        intent: { type: "string", description: "One sentence naming the user's overall goal." },
        intentConfidence: { type: "string", enum: ["high", "medium", "low"] },
        intentRationale: { type: "string", description: "1–2 sentences of evidence for the intent." },
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Stable short id, e.g. \"s1\"." },
              title: { type: "string" },
              detail: { type: "string" },
              startMs: { type: "number", description: "Step start (atMs)." },
              endMs: { type: "number", description: "Step end (atMs)." },
              apps: { type: "array", items: { type: "string" } },
              evidence: { type: "array", items: { type: "string" } },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
            },
            required: ["id", "title", "detail"],
            additionalProperties: false,
          },
        },
      },
      required: ["title", "intent", "steps"],
      additionalProperties: false,
    },
    handler: (raw) => {
      const parsed = AnalysisSubmissionSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          textResultForLlm:
            "submit_analysis rejected — the payload did not match the schema. Fix these and call again:\n" +
            parsed.error.issues.map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n"),
          resultType: "failure",
        };
      }
      progress("Received analysis draft.");
      onSubmit(parsed.data);
      return "Analysis recorded. You may stop now.";
    },
  };

  return [getTimeline, getEvents, listFrames, getFrames, submitAnalysis];
}
