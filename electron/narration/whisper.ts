import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";

import { app } from "electron";

// Multilingual Whisper small, int8 (q8) ONNX weights (~252 MB). It has the same
// architecture and runtime profile as the previous English-only checkpoint.
export const NARRATION_MODEL_ID = "Xenova/whisper-small";
export const LEGACY_NARRATION_MODEL_ID = "Xenova/whisper-small.en";
const DTYPE = "q8";
export const NARRATION_MODEL_FILES = [
  "config.json",
  "generation_config.json",
  "preprocessor_config.json",
  "tokenizer_config.json",
  "tokenizer.json",
  path.join("onnx", "encoder_model_quantized.onnx"),
  path.join("onnx", "decoder_model_merged_quantized.onnx"),
] as const;

/**
 * The subset of the transformers.js ASR pipeline we actually call. Typing it as a
 * plain callable avoids fighting the library's large pipeline union while keeping
 * the return shape we depend on explicit.
 */
export type AsrPipeline = (
  audio: Float32Array,
  options?: {
    return_timestamps?: boolean | "word";
    chunk_length_s?: number;
    stride_length_s?: number;
    language?: string;
    task?: "transcribe" | "translate";
  },
) => Promise<{
  text: string;
  chunks?: Array<{ timestamp: [number, number | null]; text: string }>;
}>;

export interface ModelLoadProgress {
  status: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

export interface WhisperLoadOptions {
  allowDownload: boolean;
  onProgress?: (progress: ModelLoadProgress) => void;
}

let loadedPipe: AsrPipeline | null = null;
let pipePromise: Promise<AsrPipeline | null> | null = null;

/** The model id transcripts are tagged with. */
export function narrationModelId(): string {
  return NARRATION_MODEL_ID;
}

export function narrationModelCacheDir(): string {
  const override = process.env.SKILL_RECORDER_MODELS_DIR;
  if (override) return path.resolve(override);
  return path.join(app.getPath("userData"), "models");
}

export function isNarrationModelCachedAt(
  cacheDir: string,
  modelId = NARRATION_MODEL_ID,
): boolean {
  const root = path.join(cacheDir, ...modelId.split("/"));
  return NARRATION_MODEL_FILES.every((file) => existsSync(path.join(root, file)));
}

export function isNarrationModelCached(): boolean {
  return isNarrationModelCachedAt(narrationModelCacheDir());
}

/** Remove the superseded English-only weights only after the multilingual model is ready. */
export async function removeLegacyNarrationModelCache(
  cacheDir = narrationModelCacheDir(),
): Promise<void> {
  await rm(path.join(cacheDir, ...LEGACY_NARRATION_MODEL_ID.split("/")), {
    recursive: true,
    force: true,
  });
}

async function build(options: WhisperLoadOptions): Promise<AsrPipeline> {
  // Dynamic import: transformers.js + onnxruntime-node are heavy native deps we
  // only ever touch when a model download or transcription is requested.
  const tf = await import("@huggingface/transformers");

  // Keep every downloaded model under the app's user-data dir so it survives
  // upgrades and is trivial to locate or clear. First run needs the network once;
  // every run after is offline from this cache. Nothing is bundled with the app.
  tf.env.cacheDir = narrationModelCacheDir();

  const pipe = await tf.pipeline("automatic-speech-recognition", NARRATION_MODEL_ID, {
    dtype: DTYPE,
    local_files_only: !options.allowDownload,
    progress_callback: options.onProgress,
    // onnxruntime-node's CPU memory arena SIGTRAPs (hard native crash) under
    // Electron's runtime, in both the main and utility processes. Disabling the
    // arena is the single option that avoids it; unlike throttling threads or
    // graph optimization it keeps multithreading and fusions on, so transcription
    // stays near-native speed (~12s for 77s of audio) with no change in output.
    session_options: { enableCpuMemArena: false },
  });
  return pipe as unknown as AsrPipeline;
}

/**
 * Lazily builds and caches the ASR pipeline for the process. Failed loads are
 * deliberately not memoized so an offline attempt can be retried without an app
 * restart.
 */
export async function getAsrPipeline(options: WhisperLoadOptions): Promise<AsrPipeline> {
  if (loadedPipe) return loadedPipe;
  if (!pipePromise) pipePromise = build(options);
  try {
    const pipe = await pipePromise;
    if (!pipe) throw new Error("Whisper model did not load.");
    loadedPipe = pipe;
    return pipe;
  } finally {
    pipePromise = null;
  }
}
