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

function cleanup() {
  try {
    if (stream) for (const track of stream.getTracks()) track.stop();
  } catch {
    // ignore
  }
  stream = null;
  recorder = null;
}

ipcRenderer.on("video:start", async (_event, opts) => {
  const { sourceId, fps, bitsPerSecond, maxWidth, maxHeight } = opts;
  try {
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

    recorder.ondataavailable = (e) => {
      if (!e.data || e.data.size === 0) return;
      // Preserve order and completion; Uint8Array survives IPC structured clone.
      sendChain = sendChain.then(async () => {
        const buf = await e.data.arrayBuffer();
        ipcRenderer.send("video:chunk", new Uint8Array(buf));
      });
    };
    recorder.onstart = () => ipcRenderer.send("video:started", Date.now());
    recorder.onstop = () => {
      // Wait for every queued chunk (including the final one) to be sent.
      sendChain.then(() => {
        cleanup();
        ipcRenderer.send("video:stopped");
      });
    };
    recorder.onerror = (e) => {
      ipcRenderer.send("video:error", String((e && e.error) || e));
    };

    // Emit a chunk every second so long sessions stream to disk incrementally.
    recorder.start(1000);
  } catch (err) {
    cleanup();
    ipcRenderer.send("video:error", err instanceof Error ? err.message : String(err));
  }
});

ipcRenderer.on("video:stop", () => {
  try {
    if (recorder && recorder.state !== "inactive") {
      recorder.requestData();
      recorder.stop();
    } else {
      ipcRenderer.send("video:stopped");
    }
  } catch (err) {
    ipcRenderer.send("video:error", err instanceof Error ? err.message : String(err));
    ipcRenderer.send("video:stopped");
  }
});
