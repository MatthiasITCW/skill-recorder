export interface SilenceSpan {
  start: number;
  end: number;
}

const DEFAULT_SAMPLE_RATE = 16_000;
const DEFAULT_THRESHOLD_DB = -35;
const DEFAULT_MIN_SILENCE_SEC = 0.6;
const DEFAULT_WINDOW_SEC = 0.02;

/** Find sustained low-RMS spans in decoded mono audio. */
export function detectSilence(
  samples: Float32Array,
  sampleRate = DEFAULT_SAMPLE_RATE,
  thresholdDb = DEFAULT_THRESHOLD_DB,
  minSilenceSec = DEFAULT_MIN_SILENCE_SEC,
): SilenceSpan[] {
  const threshold = 10 ** (thresholdDb / 20);
  const minSamples = Math.round(minSilenceSec * sampleRate);
  const windowSamples = Math.max(1, Math.round(DEFAULT_WINDOW_SEC * sampleRate));
  const spans: SilenceSpan[] = [];
  let pendingStart = -1;

  for (let offset = 0; offset < samples.length; offset += windowSamples) {
    const end = Math.min(samples.length, offset + windowSamples);
    let energy = 0;
    for (let index = offset; index < end; index++) energy += samples[index] ** 2;
    const rms = Math.sqrt(energy / Math.max(1, end - offset));
    if (rms < threshold) {
      if (pendingStart < 0) pendingStart = offset;
    } else if (pendingStart >= 0) {
      if (offset - pendingStart >= minSamples) {
        spans.push({ start: pendingStart / sampleRate, end: offset / sampleRate });
      }
      pendingStart = -1;
    }
  }
  if (pendingStart >= 0 && samples.length - pendingStart >= minSamples) {
    spans.push({ start: pendingStart / sampleRate, end: samples.length / sampleRate });
  }
  return spans;
}
