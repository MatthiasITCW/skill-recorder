// Video capture preload — CommonJS, runs in the hidden capture window's isolated
// world. It has both Web APIs (navigator.mediaDevices, MediaRecorder) and
// ipcRenderer, so it does the whole capture here and streams webm chunks back
// to the main process, which writes them to disk. Channel names mirror
// electron/video/recorder.ts.
const { ipcRenderer } = require("electron");

/** @type {MediaRecorder | null} */
let recorder = null;
/** @type {MediaStream | null} */
let stream = null;
// Serialises chunk sends so the final blob (dispatched just before `stop`) is
// fully forwarded before we tell main the recording stopped — otherwise the
// last cluster is lost and the webm ends prematurely.
let sendChain = Promise.resolve();
/** @type {ReadableStreamDefaultReader | null} */
let frameReader = null;
/** @type {Promise<void> | null} */
let framePump = null;
/** @type {Promise<void> | null} */
let frameEncoding = null;
/** @type {ReturnType<typeof setInterval> | null} */
let frameTimer = null;
/** @type {OffscreenCanvas | HTMLCanvasElement | null} */
let frameCanvas = null;
/** @type {OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null} */
let frameContext = null;
/** @type {OffscreenCanvas | HTMLCanvasElement | null} */
let hashCanvas = null;
/** @type {OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null} */
let hashContext = null;
/** @type {HTMLVideoElement | null} */
let previewVideo = null;
let capturingFrames = false;
let frameReady = false;
let recordingStarted = false;
let startEpoch = 0;
let startMonotonic = 0;
let requestedStopEpoch = 0;
/** @type {number | null} */
let firstFrameTimestampUs = null;
let firstFrameEpoch = 0;
let lastFrameHash = "";
let lastFrameEmitAt = 0;
let frameErrorReported = false;

const FRAME_HEARTBEAT_MS = 5000;
const FRAME_START_TIMEOUT_MS = 5000;
const FRAME_DEDUPE_DISTANCE = 8;
const FRAME_JPEG_QUALITY = 0.78;

function reportFrameError(error) {
  if (frameErrorReported) return;
  frameErrorReported = true;
  ipcRenderer.send(
    "video:frame-error",
    error instanceof Error ? error.message : String(error),
  );
}

function currentEpoch() {
  return recordingStarted
    ? startEpoch + (performance.now() - startMonotonic)
    : Date.now();
}

function epochNow() {
  return performance.timeOrigin + performance.now();
}

function createCanvas(width, height) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function ensureCanvases(width, height) {
  if (!frameCanvas || frameCanvas.width !== width || frameCanvas.height !== height) {
    frameCanvas = createCanvas(width, height);
    frameContext = frameCanvas.getContext("2d", { alpha: false });
  }
  if (!hashCanvas) {
    hashCanvas = createCanvas(9, 8);
    hashContext = hashCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
  }
  if (!frameContext || !hashContext) throw new Error("Could not create frame capture canvases.");
}

function dhash() {
  if (!frameCanvas || !hashContext) return "";
  hashContext.drawImage(frameCanvas, 0, 0, 9, 8);
  const pixels = hashContext.getImageData(0, 0, 9, 8).data;
  let bits = "";
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const left = (row * 9 + col) * 4;
      const right = left + 4;
      const leftLuma = pixels[left] * 0.299 + pixels[left + 1] * 0.587 + pixels[left + 2] * 0.114;
      const rightLuma = pixels[right] * 0.299 + pixels[right + 1] * 0.587 + pixels[right + 2] * 0.114;
      bits += leftLuma < rightLuma ? "1" : "0";
    }
  }
  let hex = "";
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

function hamming(a, b) {
  if (!a || !b || a.length !== b.length) return Number.MAX_SAFE_INTEGER;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    let value = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (value) {
      distance += value & 1;
      value >>= 1;
    }
  }
  return distance;
}

function canvasToJpeg(canvas) {
  if ("convertToBlob" in canvas) {
    return canvas.convertToBlob({ type: "image/jpeg", quality: FRAME_JPEG_QUALITY });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("JPEG encoding returned no data.")),
      "image/jpeg",
      FRAME_JPEG_QUALITY,
    );
  });
}

async function maybeEmitFrame(tMs, force = false) {
  if (!recordingStarted || !frameReady || !frameCanvas || frameEncoding) return;
  const hash = dhash();
  const heartbeatDue = performance.now() - lastFrameEmitAt >= FRAME_HEARTBEAT_MS;
  if (!force && !heartbeatDue && hamming(hash, lastFrameHash) <= FRAME_DEDUPE_DISTANCE) return;

  frameEncoding = (async () => {
    const blob = await canvasToJpeg(frameCanvas);
    const data = new Uint8Array(await blob.arrayBuffer());
    const roundedEpoch = Math.round(tMs);
    ipcRenderer.send("video:frame", {
      data,
      tMs: roundedEpoch,
      offsetMs: Math.max(0, Math.round(roundedEpoch - startEpoch)),
      width: frameCanvas.width,
      height: frameCanvas.height,
    });
    lastFrameHash = hash;
    lastFrameEmitAt = performance.now();
  })();
  try {
    await frameEncoding;
  } finally {
    frameEncoding = null;
  }
}

async function drawFrame(source, width, height, timestampUs) {
  if (!capturingFrames || width <= 0 || height <= 0) return;
  ensureCanvases(width, height);
  frameContext.drawImage(source, 0, 0, width, height);
  frameReady = true;
  if (!recordingStarted) return;

  let tMs = currentEpoch();
  if (Number.isFinite(timestampUs)) {
    if (firstFrameTimestampUs == null) {
      firstFrameTimestampUs = timestampUs;
      firstFrameEpoch = tMs;
    }
    tMs = firstFrameEpoch + (timestampUs - firstFrameTimestampUs) / 1000;
  }
  await maybeEmitFrame(tMs);
}

async function pumpTrack(track) {
  const Processor = globalThis.MediaStreamTrackProcessor;
  if (typeof Processor !== "function" || typeof OffscreenCanvas === "undefined") return false;

  const processor = new Processor({ track });
  frameReader = processor.readable.getReader();
  framePump = (async () => {
    while (capturingFrames && frameReader) {
      const { done, value: frame } = await frameReader.read();
      if (done || !frame) break;
      try {
        await drawFrame(
          frame,
          frame.displayWidth || frame.codedWidth,
          frame.displayHeight || frame.codedHeight,
          frame.timestamp,
        );
      } finally {
        frame.close();
      }
    }
  })();
  framePump.catch((err) => {
    if (capturingFrames) reportFrameError(err);
  });
  return true;
}

async function startTimerFallback(track) {
  const video = document.createElement("video");
  previewVideo = video;
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([track]);
  await withTimeout(
    video.play(),
    FRAME_START_TIMEOUT_MS,
    "Timed out starting fallback snapshot capture.",
  );
  if (!capturingFrames || previewVideo !== video) {
    video.pause();
    video.srcObject = null;
    return;
  }
  frameTimer = setInterval(() => {
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    void drawFrame(video, video.videoWidth, video.videoHeight, null)
      .catch(reportFrameError);
  }, 1000);
}

async function startFrameCapture(track) {
  capturingFrames = true;
  frameTimer = setInterval(() => {
    if (frameReady) void maybeEmitFrame(currentEpoch(), true).catch(reportFrameError);
  }, FRAME_HEARTBEAT_MS);
  if (!(await pumpTrack(track))) {
    clearInterval(frameTimer);
    frameTimer = null;
    await startTimerFallback(track);
  }
}

async function stopFrameCapture() {
  capturingFrames = false;
  if (frameTimer) clearInterval(frameTimer);
  frameTimer = null;
  const reader = frameReader;
  frameReader = null;
  if (reader) await reader.cancel().catch(() => undefined);
  if (framePump) await framePump.catch(() => undefined);
  framePump = null;
  if (frameReady) await maybeEmitFrame(currentEpoch(), true).catch(reportFrameError);
  if (frameEncoding) await frameEncoding.catch(reportFrameError);
  if (previewVideo) {
    previewVideo.pause();
    previewVideo.srcObject = null;
  }
  previewVideo = null;
}

function cleanup() {
  try {
    if (stream) for (const track of stream.getTracks()) track.stop();
  } catch {
    // ignore
  }
  stream = null;
  recorder = null;
  frameCanvas = null;
  frameContext = null;
  hashCanvas = null;
  hashContext = null;
  frameReady = false;
  capturingFrames = false;
  recordingStarted = false;
  requestedStopEpoch = 0;
  firstFrameTimestampUs = null;
  lastFrameHash = "";
  lastFrameEmitAt = 0;
  frameErrorReported = false;
}

ipcRenderer.on("video:start", async (_event, opts) => {
  const { sourceId, fps, bitsPerSecond, maxWidth, maxHeight } = opts;
  try {
    sendChain = Promise.resolve();
    // Electron desktop capture uses the legacy mandatory-constraints form.
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: sourceId,
          maxFrameRate: fps,
          maxWidth,
          maxHeight,
        },
      },
    });

    // VP8 encodes with noticeably less CPU than VP9 and, at 1 fps, the file-size
    // difference is negligible — we favour keeping the machine responsive.
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
      ? "video/webm;codecs=vp8"
      : "video/webm;codecs=vp9";
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitsPerSecond });
    const [track] = stream.getVideoTracks();
    if (!track) throw new Error("Desktop capture returned no video track.");
    recorder.ondataavailable = (e) => {
      if (!e.data || e.data.size === 0) return;
      // Preserve order and completion; Uint8Array survives IPC structured clone.
      sendChain = sendChain.then(async () => {
        const buf = await e.data.arrayBuffer();
        ipcRenderer.send("video:chunk", new Uint8Array(buf));
      });
    };
    recorder.onstart = () => {
      startEpoch = epochNow();
      startMonotonic = performance.now();
      recordingStarted = true;
      ipcRenderer.send("video:started", startEpoch);
    };
    recorder.onstop = () => {
      // Wait for every queued chunk and snapshot before acknowledging stop.
      Promise.all([sendChain, stopFrameCapture()]).then(() => {
        const stopEpoch = requestedStopEpoch || currentEpoch();
        cleanup();
        ipcRenderer.send("video:stopped", stopEpoch);
      }).catch((err) => {
        const stopEpoch = requestedStopEpoch || currentEpoch();
        cleanup();
        ipcRenderer.send("video:error", err instanceof Error ? err.message : String(err));
        ipcRenderer.send("video:stopped", stopEpoch);
      });
    };
    recorder.onerror = (e) => {
      ipcRenderer.send("video:error", String((e && e.error) || e));
    };

    // Emit a chunk every second so long sessions stream to disk incrementally.
    recorder.start(1000);
    void startFrameCapture(track).catch((err) => {
      reportFrameError(err);
      void stopFrameCapture().catch(reportFrameError);
    });
  } catch (err) {
    await stopFrameCapture();
    cleanup();
    ipcRenderer.send("video:error", err instanceof Error ? err.message : String(err));
  }
});

function withTimeout(promise, timeoutMs, message) {
  let timeout;
  const expired = new Promise((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timeout));
}

ipcRenderer.on("video:stop", async () => {
  try {
    if (recorder && recorder.state !== "inactive") {
      requestedStopEpoch = currentEpoch();
      recorder.requestData();
      recorder.stop();
    } else {
      await stopFrameCapture();
      ipcRenderer.send("video:stopped", requestedStopEpoch || currentEpoch());
    }
  } catch (err) {
    const stopEpoch = requestedStopEpoch || currentEpoch();
    await stopFrameCapture().catch(() => undefined);
    ipcRenderer.send("video:error", err instanceof Error ? err.message : String(err));
    ipcRenderer.send("video:stopped", stopEpoch);
  }
});
