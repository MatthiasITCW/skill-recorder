import assert from "node:assert/strict";
import test from "node:test";

import type { SilenceSpan } from "./audio-analysis";
import {
  isMeaningfulNarrationText,
  isMostlySilent,
  narrationTranscriptionOptions,
} from "./transcribe";

test("multilingual transcription preserves the explicitly selected source language", () => {
  assert.deepEqual(narrationTranscriptionOptions("fr"), {
    return_timestamps: true,
    chunk_length_s: 30,
    stride_length_s: 5,
    language: "fr",
    task: "transcribe",
  });
});

test("narration filtering accepts Unicode letters", () => {
  assert.equal(isMeaningfulNarrationText("È già pronto"), true);
  assert.equal(isMeaningfulNarrationText("日本語の説明"), true);
  assert.equal(isMeaningfulNarrationText("123 ..."), false);
});

test("narration filtering removes localized Whisper boilerplate", () => {
  assert.equal(isMeaningfulNarrationText("Merci d'avoir regardé !"), false);
  assert.equal(isMeaningfulNarrationText("Gracias por ver."), false);
  assert.equal(isMeaningfulNarrationText("Grazie per aver guardato"), false);
});

test("keeps a long real-speech chunk that is only ~44% silent", () => {
  // Regression: the old midpoint test dropped this 16.18s chunk purely because its
  // center (8.09s) landed inside the 7.14-9.44s mid-sentence pause. Natural pauses
  // add up to ~44% of the span, but the majority is speech, so it must be kept.
  const silences: SilenceSpan[] = [
    { start: 1.0, end: 2.4 },
    { start: 7.14, end: 9.44 },
    { start: 11.0, end: 12.5 },
    { start: 14.0, end: 16.0 },
  ];
  assert.equal(isMostlySilent(0, 16.18, silences), false);
});

test("drops a chunk whose span is essentially all silence", () => {
  // A silence span that fully covers (and overruns) the chunk: clipped coverage
  // is 100%, so it's a hallucination over silence and gets dropped.
  assert.equal(isMostlySilent(10, 20, [{ start: 9, end: 21 }]), true);
});

test("uses 0.85 as the drop threshold", () => {
  assert.equal(isMostlySilent(0, 10, [{ start: 0, end: 9 }]), true); // 0.90 -> drop
  assert.equal(isMostlySilent(0, 10, [{ start: 0, end: 8 }]), false); // 0.80 -> keep
});

test("degenerates to a point-in-silence test for a zero-length span", () => {
  assert.equal(isMostlySilent(5, 5, [{ start: 4, end: 6 }]), true);
  assert.equal(isMostlySilent(5, 5, [{ start: 10, end: 12 }]), false);
});

test("treats a negative span defensively via the start point", () => {
  assert.equal(isMostlySilent(8, 5, [{ start: 7, end: 9 }]), true);
  assert.equal(isMostlySilent(8, 5, [{ start: 1, end: 2 }]), false);
});

test("keeps a chunk with no overlapping silence", () => {
  assert.equal(isMostlySilent(0, 10, [{ start: 20, end: 25 }, { start: 30, end: 35 }]), false);
  assert.equal(isMostlySilent(0, 10, []), false);
});
