import assert from "node:assert/strict";
import test from "node:test";

import { shouldTranscribeBeforeAnalyze } from "./analyze-gate";

test("analyze transcribes first only when audio exists without a transcript", () => {
  // Voice was recorded but not yet transcribed → transcribe first so the analysis
  // includes the user's spoken intent instead of silently dropping it.
  assert.equal(shouldTranscribeBeforeAnalyze(true, false), true);
  // Already transcribed → analyze straight away, no wasteful re-transcription.
  assert.equal(shouldTranscribeBeforeAnalyze(true, true), false);
  // No audio at all → nothing to transcribe; behave exactly as a plain analyze.
  assert.equal(shouldTranscribeBeforeAnalyze(false, false), false);
  // Defensive: no audio but a stray transcript → still nothing to do.
  assert.equal(shouldTranscribeBeforeAnalyze(false, true), false);
});
