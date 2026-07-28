/** Version written by new recordings that can toggle the microphone mid-session. */
export const AUDIO_MANIFEST_VERSION = 2 as const;

/** One continuous interval in which the microphone was actively capturing. */
export interface AudioSegment {
  file: string;
  startEpoch: number;
  stopEpoch: number;
  durationMs: number;
  /** Segment bounds relative to `session.json.startedAt`. */
  sessionStartMs: number;
  sessionEndMs: number;
  /** Segment bounds relative to `video.json.startEpoch`, when video was available. */
  videoStartMs: number | null;
  videoEndMs: number | null;
  bytes: number;
}

export interface AudioManifestV2 {
  version: typeof AUDIO_MANIFEST_VERSION;
  segments: AudioSegment[];
}

/** Metadata written by recordings created before live microphone toggling existed. */
export interface LegacyAudioMetadata {
  file: string;
  startEpoch: number;
  stopEpoch: number;
  durationMs: number;
  bytes: number;
}

export type AudioMetadata = AudioManifestV2 | LegacyAudioMetadata;
export type AudioSource = Pick<LegacyAudioMetadata, "file" | "startEpoch" | "durationMs">;

export function isAudioManifestV2(value: unknown): value is AudioManifestV2 {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AudioManifestV2>;
  return candidate.version === AUDIO_MANIFEST_VERSION && Array.isArray(candidate.segments);
}

/** Normalize legacy and segmented metadata into the files the transcriber reads. */
export function readAudioSources(value: unknown): AudioSource[] {
  const sources = isAudioManifestV2(value) ? value.segments : [value];
  const normalized: AudioSource[] = [];
  for (const source of sources) {
    if (
      !source ||
      typeof source !== "object" ||
      !("file" in source) ||
      typeof source.file !== "string" ||
      !source.file ||
      !("startEpoch" in source) ||
      typeof source.startEpoch !== "number" ||
      !Number.isFinite(source.startEpoch) ||
      !("durationMs" in source) ||
      typeof source.durationMs !== "number" ||
      !Number.isFinite(source.durationMs) ||
      source.durationMs < 0
    ) {
      throw new Error("Narration metadata contains an invalid audio segment.");
    }
    normalized.push({
      file: source.file,
      startEpoch: source.startEpoch,
      durationMs: source.durationMs,
    });
  }
  return normalized;
}

/** Add video-relative offsets without altering the session-relative timeline. */
export function alignAudioSegmentsToVideo(
  segments: readonly AudioSegment[],
  videoStartEpoch: number | null,
): AudioSegment[] {
  return segments.map((segment) => ({
    ...segment,
    videoStartMs:
      videoStartEpoch == null ? null : Math.round(segment.startEpoch - videoStartEpoch),
    videoEndMs:
      videoStartEpoch == null ? null : Math.round(segment.stopEpoch - videoStartEpoch),
  }));
}
