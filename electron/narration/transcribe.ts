import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";

import type { NarrationSegment } from "../../common/narration";
import { createLogger } from "../logger";
import { getAsrPipeline, narrationModelId } from "./whisper";

const log = createLogger("Narration/transcribe");
const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);

const ffmpegPath = require("ffmpeg-static") as string;

// Whisper is trained on 16 kHz mono audio.
const SAMPLE_RATE = 16_000;
// f32le at 16 kHz mono is 64 KB per second; 1 GB covers ~4.5 h of narration.
const MAX_PCM_BUFFER = 1024 * 1024 * 1024;

/** A silence interval in the decoded audio's own clock (seconds). */
interface SilenceSpan {
  start: number;
  end: number;
}

/**
 * Transcribe one session's narration webm into session-clock segments.
 *
 * @param audioPath  absolute path to `audio.webm`
 * @param anchorDeltaMs  `audio.startEpoch - session.startedAt` — added to every
 *   audio-local timestamp so segments land on the same clock as step offsets.
 * @param durationMs  recorded narration duration, used to close the final chunk.
 */
export async function transcribeNarration(
  audioPath: string,
  anchorDeltaMs: number,
  durationMs: number,
): Promise<{ model: string; segments: NarrationSegment[] } | null> {
  const pipe = await getAsrPipeline();
  if (!pipe) return null;

  let samples: Float32Array;
  try {
    samples = await decodePcm(audioPath);
  } catch (err) {
    log.warn("failed to decode narration audio:", err instanceof Error ? err.message : err);
    return null;
  }
  if (samples.length === 0) {
    log.warn("narration audio decoded to zero samples");
    return null;
  }

  // Silence detection runs on the same file and only reads the audio, so its
  // intervals line up with the decoded samples and never shift timestamps.
  const silences = await detectSilence(audioPath);

  let result: { text: string; chunks?: Array<{ timestamp: [number, number | null]; text: string }> };
  try {
    result = await pipe(samples, {
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
    });
  } catch (err) {
    log.warn("whisper transcription failed:", err instanceof Error ? err.message : err);
    return null;
  }

  const durationSec = durationMs > 0 ? durationMs / 1000 : samples.length / SAMPLE_RATE;
  const raw = result.chunks?.length
    ? result.chunks
    : [{ timestamp: [0, durationSec] as [number, number | null], text: result.text ?? "" }];

  const segments: NarrationSegment[] = [];
  for (const chunk of raw) {
    const text = (chunk.text ?? "").trim();
    if (!isMeaningful(text)) continue;

    const startSec = chunk.timestamp?.[0] ?? 0;
    const endSec = chunk.timestamp?.[1] ?? Math.min(durationSec, startSec + 2);
    if (isMostlySilent(startSec, endSec, silences)) continue;

    segments.push({
      atMs: Math.max(0, Math.round(startSec * 1000 + anchorDeltaMs)),
      endMs: Math.max(0, Math.round(endSec * 1000 + anchorDeltaMs)),
      text,
    });
  }

  segments.sort((a, b) => a.atMs - b.atMs);
  log.info(`transcribed ${raw.length} chunks -> ${segments.length} narration segments`);
  return { model: narrationModelId(), segments };
}

/** Decode any container into raw 16 kHz mono float samples (no WAV/dep needed). */
async function decodePcm(audioPath: string): Promise<Float32Array> {
  const { stdout } = await execFileAsync(
    ffmpegPath,
    [
      "-hide_banner",
      "-loglevel", "error",
      "-i", audioPath,
      "-ac", "1",
      "-ar", String(SAMPLE_RATE),
      "-f", "f32le",
      "pipe:1",
    ],
    { encoding: "buffer", maxBuffer: MAX_PCM_BUFFER },
  );

  const buf = stdout as unknown as Buffer;
  // Copy into a fresh, 4-byte-aligned ArrayBuffer before viewing as Float32:
  // execFile's Buffer offset is not guaranteed aligned.
  const usableBytes = buf.byteLength - (buf.byteLength % 4);
  const ab = new ArrayBuffer(usableBytes);
  new Uint8Array(ab).set(buf.subarray(0, usableBytes));
  return new Float32Array(ab);
}

/** Run ffmpeg's silencedetect and parse the intervals it logs to stderr. */
async function detectSilence(audioPath: string): Promise<SilenceSpan[]> {
  let stderr = "";
  try {
    const res = await execFileAsync(
      ffmpegPath,
      [
        "-hide_banner",
        "-i", audioPath,
        "-af", "silencedetect=noise=-35dB:d=0.6",
        "-f", "null",
        "-",
      ],
      { maxBuffer: 8 * 1024 * 1024 },
    );
    stderr = res.stderr;
  } catch (err) {
    // silencedetect over the null muxer normally exits 0; treat any failure as
    // "no silence info" rather than aborting transcription.
    stderr = (err as { stderr?: string }).stderr ?? "";
  }

  const spans: SilenceSpan[] = [];
  let pendingStart: number | null = null;
  for (const m of stderr.matchAll(/silence_(start|end):\s*(-?[0-9.]+)/g)) {
    const kind = m[1];
    const value = Number(m[2]);
    if (kind === "start") {
      pendingStart = value;
    } else if (pendingStart != null) {
      spans.push({ start: pendingStart, end: value });
      pendingStart = null;
    }
  }
  return spans;
}

/** A chunk is dropped when its midpoint sits inside a detected silence span. */
function isMostlySilent(startSec: number, endSec: number, silences: SilenceSpan[]): boolean {
  const mid = (startSec + endSec) / 2;
  return silences.some((s) => mid >= s.start && mid <= s.end);
}

// Whisper hallucinates stock phrases over silence/noise; drop the usual suspects
// (and anything that carries no letters) so they never reach the analysis.
const BOILERPLATE = new Set([
  "you",
  "thank you",
  "thanks",
  "thank you.",
  "thanks for watching",
  "thanks for watching!",
  "please subscribe",
  "subtitles by the amara.org community",
  "bye",
  "bye.",
  ".",
]);

function isMeaningful(text: string): boolean {
  if (text.length < 2) return false;
  if (!/[a-z]/i.test(text)) return false;
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  return !BOILERPLATE.has(normalized);
}
