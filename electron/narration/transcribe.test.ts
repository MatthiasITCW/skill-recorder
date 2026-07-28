import assert from "node:assert/strict";
import test from "node:test";

import {
  isMeaningfulNarrationText,
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
