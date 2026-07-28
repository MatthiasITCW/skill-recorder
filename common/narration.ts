export const NARRATION_LANGUAGE_CODES = ["en", "it", "fr", "es"] as const;
export type NarrationLanguage = (typeof NARRATION_LANGUAGE_CODES)[number];

export const DEFAULT_NARRATION_LANGUAGE: NarrationLanguage = "en";
export const NARRATION_LANGUAGE_LABELS = {
  en: "English",
  it: "Italian",
  fr: "French",
  es: "Spanish",
} satisfies Record<NarrationLanguage, string>;

/** Current q8 model files total 251,875,316 bytes at the publisher. */
export const NARRATION_MODEL_DOWNLOAD_LABEL = "~252 MB";

export function isNarrationLanguage(value: unknown): value is NarrationLanguage {
  return (
    typeof value === "string" &&
    (NARRATION_LANGUAGE_CODES as readonly string[]).includes(value)
  );
}

export function narrationLanguageLabel(language: NarrationLanguage): string {
  return NARRATION_LANGUAGE_LABELS[language];
}

/**
 * The offline voice-narration transcript. This is the spoken form of the typed
 * marker: the user's own stated intent while recording. It is produced after
 * Stop by the narration stage (Whisper via transformers.js) and written to
 * `narration.json`. It is NEVER appended to the finalized `events.jsonl`; the
 * describer reads it through the `get_narration` tool, and it only leaves the
 * machine on Analyze, exactly like screenshots.
 */
export interface NarrationSegment {
  /** Segment start, in ms since the session started (same clock as step offsets). */
  atMs: number;
  /** Segment end, in ms since the session started. */
  endMs: number;
  /** The spoken text for this segment. */
  text: string;
}

export interface NarrationTranscript {
  /** The Whisper model id that produced this transcript. */
  model: string;
  /** The explicitly selected source language, preserved rather than translated. */
  language: NarrationLanguage;
  segments: NarrationSegment[];
}

/** Filename of the transcript within a session folder. */
export const NARRATION_FILE = "narration.json";
