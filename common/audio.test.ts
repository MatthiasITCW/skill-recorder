import assert from "node:assert/strict";
import test from "node:test";

import {
  AUDIO_MANIFEST_VERSION,
  alignAudioSegmentsToVideo,
  isAudioManifestV2,
  readAudioSources,
  type AudioSegment,
} from "./audio";

test("segmented audio manifests are distinguished from legacy metadata", () => {
  assert.equal(
    isAudioManifestV2({
      version: AUDIO_MANIFEST_VERSION,
      segments: [],
    }),
    true,
  );
  assert.equal(
    isAudioManifestV2({
      file: "audio.webm",
      startEpoch: 100,
      stopEpoch: 200,
      durationMs: 100,
      bytes: 12,
    }),
    false,
  );
});

test("audio segments retain signed offsets against the real video start", () => {
  const segment: AudioSegment = {
    file: "audio/segment-0001.webm",
    startEpoch: 950.4,
    stopEpoch: 1_250.6,
    durationMs: 300.2,
    sessionStartMs: 150,
    sessionEndMs: 450,
    videoStartMs: null,
    videoEndMs: null,
    bytes: 40,
  };
  const [aligned] = alignAudioSegmentsToVideo([segment], 1_000.2);
  assert.equal(aligned.videoStartMs, -50);
  assert.equal(aligned.videoEndMs, 250);
  assert.equal(aligned.sessionStartMs, segment.sessionStartMs);
});

test("legacy and segmented metadata normalize to timestamped transcription sources", () => {
  assert.deepEqual(
    readAudioSources({
      file: "audio.webm",
      startEpoch: 1_100,
      stopEpoch: 1_500,
      durationMs: 400,
      bytes: 12,
    }),
    [{ file: "audio.webm", startEpoch: 1_100, durationMs: 400 }],
  );

  const first = {
    file: "audio/segment-0001.webm",
    startEpoch: 1_200,
    stopEpoch: 1_400,
    durationMs: 200,
    sessionStartMs: 200,
    sessionEndMs: 400,
    videoStartMs: 100,
    videoEndMs: 300,
    bytes: 20,
  };
  const second = { ...first, file: "audio/segment-0002.webm", startEpoch: 1_800 };
  assert.deepEqual(
    readAudioSources({ version: AUDIO_MANIFEST_VERSION, segments: [first, second] }),
    [
      { file: first.file, startEpoch: first.startEpoch, durationMs: first.durationMs },
      { file: second.file, startEpoch: second.startEpoch, durationMs: second.durationMs },
    ],
  );
  assert.throws(() => readAudioSources({ version: AUDIO_MANIFEST_VERSION, segments: [{}] }));
});
