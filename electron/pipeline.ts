import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { buildBundle } from "../common/bundle";
import { MEANINGFUL_EVENT_TYPES } from "../common/correlation";
import type { CorrelationResult } from "../common/correlation";
import { renderDescription } from "../common/describe";
import { NARRATION_FILE } from "../common/narration";
import type { SessionMeta } from "../common/types";
import type { AudioResult } from "./audio/recorder";
import { CorrelationEngine, readEvents } from "./frames/correlate";
import { FrameExtractor } from "./frames/extractor";
import { createLogger } from "./logger";
import { transcribeNarration } from "./narration/transcribe";
import type { VideoResult } from "./video/recorder";

const log = createLogger("Pipeline");

function readMeta(sessionDir: string): SessionMeta | null {
  const p = path.join(sessionDir, "session.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as SessionMeta;
  } catch (err) {
    log.warn("unreadable session.json:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Opportunistic video stage: if a video was recorded, grab one frame at each
 * meaningful non-video event and correlate. We deliberately DO NOT scan the whole
 * video — events are the primary signal; anything they miss is surfaced as probe
 * *suggestions* and harvested later, only where confidence is low. Best-effort:
 * returns null when there's no usable video.
 */
async function runFrameStage(sessionDir: string): Promise<CorrelationResult | null> {
  const videoJsonPath = path.join(sessionDir, "video.json");
  if (!existsSync(videoJsonPath)) return null;

  let video: VideoResult;
  try {
    video = JSON.parse(readFileSync(videoJsonPath, "utf8")) as VideoResult;
  } catch (err) {
    log.warn("unreadable video.json; skipping frame stage:", err instanceof Error ? err.message : err);
    return null;
  }

  const videoPath = path.join(sessionDir, video.file);
  if (!existsSync(videoPath)) {
    log.warn("video file missing; skipping frame stage");
    return null;
  }

  const extractor = new FrameExtractor({
    videoPath,
    framesDir: path.join(sessionDir, "frames"),
    anchorEpochMs: video.startEpoch,
    durationSec: video.durationMs > 0 ? video.durationMs / 1000 : undefined,
  });

  const anchors = readEvents(path.join(sessionDir, "events.jsonl"))
    .filter((e) => MEANINGFUL_EVENT_TYPES.has(e.type))
    .map((e) => ({ tMs: e.epoch, reason: e.type }));

  try {
    await extractor.extractAtEpochs(anchors);
  } catch (err) {
    log.warn("frame extraction failed:", err instanceof Error ? err.message : err);
  }

  try {
    return await new CorrelationEngine(extractor, sessionDir).run();
  } catch (err) {
    log.warn("correlation failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Optional narration stage: if the user opted into voice for this session, an
 * `audio.webm` + `audio.json` pair exists. Transcribe it offline (Whisper via
 * transformers.js) into session-clock segments and write `narration.json`. The
 * transcript is the user's own stated intent; it is never merged into
 * `events.jsonl` and is read only through the describer's `get_narration` tool.
 * Best-effort: a missing model, engine, or mic degrades to no narration.
 */
async function runNarrationStage(sessionDir: string, meta: SessionMeta): Promise<void> {
  const audioJsonPath = path.join(sessionDir, "audio.json");
  if (!existsSync(audioJsonPath)) return;

  let audio: AudioResult;
  try {
    audio = JSON.parse(readFileSync(audioJsonPath, "utf8")) as AudioResult;
  } catch (err) {
    log.warn("unreadable audio.json; skipping narration:", err instanceof Error ? err.message : err);
    return;
  }

  const audioPath = path.join(sessionDir, audio.file);
  if (!existsSync(audioPath)) {
    log.warn("narration audio missing; skipping narration stage");
    return;
  }

  try {
    const transcript = await transcribeNarration(
      audioPath,
      audio.startEpoch - meta.startedAt,
      audio.durationMs,
    );
    if (!transcript || transcript.segments.length === 0) {
      log.info("no usable narration produced");
      return;
    }
    writeFileSync(path.join(sessionDir, NARRATION_FILE), JSON.stringify(transcript, null, 2));
    log.info(`narration: ${transcript.segments.length} segments → ${NARRATION_FILE}`);
  } catch (err) {
    log.warn("narration stage failed:", err instanceof Error ? err.message : err);
  }
}

/**
 * Post-stop processing for a completed session. Always produces `bundle.json`
 * (segmented steps) and `description.md` (baseline narrative) from the primary
 * event stream; enriches them with correlated frames when a video is present.
 * Strictly best-effort — never throws into the recorder.
 */
export async function processSession(sessionDir: string): Promise<void> {
  const meta = readMeta(sessionDir);
  if (!meta) {
    log.warn("no session.json; skipping processing for", path.basename(sessionDir));
    return;
  }

  const events = readEvents(path.join(sessionDir, "events.jsonl"));
  // Frame correlation (ffmpeg) and narration transcription (Whisper) are
  // independent; run them together so a first-run model download overlaps with
  // frame extraction instead of adding to it.
  const [correlation] = await Promise.all([
    runFrameStage(sessionDir),
    runNarrationStage(sessionDir, meta),
  ]);

  try {
    const bundle = buildBundle({ meta, events, correlation });
    writeFileSync(path.join(sessionDir, "bundle.json"), JSON.stringify(bundle, null, 2));
    writeFileSync(path.join(sessionDir, "description.md"), renderDescription(bundle));
    log.info(
      `bundle: ${bundle.stats.stepCount} steps, ${bundle.stats.meaningfulEventCount} events` +
        `${bundle.stats.frameCount ? `, ${bundle.stats.frameCount} frames` : ""} → description.md`,
    );
  } catch (err) {
    log.warn("bundle/describe failed:", err instanceof Error ? err.message : err);
  }
}
