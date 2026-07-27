import assert from "node:assert/strict";
import test from "node:test";

import { detectSilence } from "./audio-analysis";

const SAMPLE_RATE = 1000;

test("detectSilence keeps only spans that meet the minimum duration", () => {
  const samples = new Float32Array(2400);
  samples.fill(0.2, 0, 400);
  samples.fill(0, 400, 1200);
  samples.fill(0.2, 1200, 1600);
  samples.fill(0, 1600, 2000);
  samples.fill(0.2, 2000);

  assert.deepEqual(detectSilence(samples, SAMPLE_RATE), [{ start: 0.4, end: 1.2 }]);
});

test("detectSilence closes a trailing silent span", () => {
  const samples = new Float32Array(1500);
  samples.fill(0.2, 0, 500);
  assert.deepEqual(detectSilence(samples, SAMPLE_RATE), [{ start: 0.5, end: 1.5 }]);
});
