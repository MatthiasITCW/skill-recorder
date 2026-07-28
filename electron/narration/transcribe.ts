import type { NarrationLanguage, NarrationSegment } from "../../common/narration";
import { decodeAudioFile } from "../audio/decode";
import { createLogger } from "../logger";
import { detectSilence, type SilenceSpan } from "./audio-analysis";
import { narrationModelId, type AsrPipeline } from "./whisper";

const log = createLogger("Narration/transcribe");

// Whisper is trained on 16 kHz mono audio.
const SAMPLE_RATE = 16_000;

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
  language: NarrationLanguage,
  pipe: AsrPipeline,
): Promise<{ model: string; segments: NarrationSegment[] }> {
  const samples = await decodeAudioFile(audioPath);
  if (samples.length === 0) {
    throw new Error("Narration audio decoded to zero samples.");
  }

  const silences = detectSilence(samples);

  const result = await pipe(samples, narrationTranscriptionOptions(language));

  const durationSec = durationMs > 0 ? durationMs / 1000 : samples.length / SAMPLE_RATE;
  const raw = result.chunks?.length
    ? result.chunks
    : [{ timestamp: [0, durationSec] as [number, number | null], text: result.text ?? "" }];

  const segments: NarrationSegment[] = [];
  for (const chunk of raw) {
    const text = (chunk.text ?? "").trim();
    if (!isMeaningfulNarrationText(text)) continue;

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
  "thanks for watching",
  "please subscribe",
  "subtitles by the amara org community",
  "bye",
  "grazie",
  "grazie per aver guardato",
  "iscriviti al canale",
  "ciao",
  "merci",
  "merci d avoir regardé",
  "abonnez vous",
  "au revoir",
  "gracias",
  "gracias por ver",
  "suscríbete",
  "adiós",
]);

export function narrationTranscriptionOptions(language: NarrationLanguage) {
  return {
    return_timestamps: true,
    chunk_length_s: 30,
    stride_length_s: 5,
    language,
    task: "transcribe",
  } as const;
}

export function isMeaningfulNarrationText(text: string): boolean {
  if (text.length < 2) return false;
  if (!/\p{L}/u.test(text)) return false;
  const normalized = text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return !BOILERPLATE.has(normalized);
}
