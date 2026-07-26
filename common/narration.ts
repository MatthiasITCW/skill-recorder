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
  segments: NarrationSegment[];
}

/** Filename of the transcript within a session folder. */
export const NARRATION_FILE = "narration.json";
