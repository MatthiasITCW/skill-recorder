import path from "node:path";

import { app } from "electron";

import { createLogger } from "../logger";

const log = createLogger("Narration/whisper");

// Whisper small.en: English-only, int8 (q8) ONNX weights (~250 MB). Downloaded
// once into the user-data models cache, then used fully offline. base.en is the
// lighter fallback if this ever proves too heavy on low-end machines.
const MODEL_ID = "Xenova/whisper-small.en";
const DTYPE = "q8";

/**
 * The subset of the transformers.js ASR pipeline we actually call. Typing it as a
 * plain callable avoids fighting the library's large pipeline union while keeping
 * the return shape we depend on explicit.
 */
export type AsrPipeline = (
  audio: Float32Array,
  options?: Record<string, unknown>,
) => Promise<{
  text: string;
  chunks?: Array<{ timestamp: [number, number | null]; text: string }>;
}>;

let pipePromise: Promise<AsrPipeline | null> | null = null;

/** The model id transcripts are tagged with. */
export function narrationModelId(): string {
  return MODEL_ID;
}

async function build(): Promise<AsrPipeline | null> {
  let tf: typeof import("@huggingface/transformers");
  try {
    // Dynamic import: transformers.js + onnxruntime-node are heavy native deps we
    // only ever touch when a session actually has narration to transcribe.
    tf = await import("@huggingface/transformers");
  } catch (err) {
    log.warn("transformers.js unavailable; narration disabled:", err instanceof Error ? err.message : err);
    return null;
  }

  // Keep every downloaded model under the app's user-data dir so it survives
  // upgrades and is trivial to locate or clear. First run needs the network once;
  // every run after is offline from this cache. Nothing is bundled with the app.
  tf.env.cacheDir = path.join(app.getPath("userData"), "models");
  tf.env.allowLocalModels = false;

  try {
    const pipe = await tf.pipeline("automatic-speech-recognition", MODEL_ID, {
      dtype: DTYPE,
      // onnxruntime-node's CPU memory arena SIGTRAPs (hard native crash) under
      // Electron's runtime, in both the main and utility processes. Disabling the
      // arena is the single option that avoids it; unlike throttling threads or
      // graph optimization it keeps multithreading and fusions on, so transcription
      // stays near-native speed (~12s for 77s of audio) with no change in output.
      // If this ever needs more isolation, move inference to a forked utility
      // process (it still needs this flag) so a future native fault can't take the
      // app down with it.
      session_options: { enableCpuMemArena: false },
    });
    return pipe as unknown as AsrPipeline;
  } catch (err) {
    log.warn("failed to load whisper model (offline + not yet cached?):", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Lazily builds and caches the ASR pipeline for the process. Returns null when
 * the engine or model can't be loaded, so callers degrade cleanly to "no
 * narration" instead of failing the analysis.
 */
export function getAsrPipeline(): Promise<AsrPipeline | null> {
  if (!pipePromise) pipePromise = build();
  return pipePromise;
}
