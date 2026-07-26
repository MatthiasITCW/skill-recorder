// Narration capture preload — CommonJS, runs in the hidden capture window's
// isolated world. It has both Web APIs (navigator.mediaDevices, MediaRecorder)
// and ipcRenderer, so it does the whole microphone capture here and streams webm
// chunks back to the main process, which writes them to disk. Channel names
// mirror electron/audio/recorder.ts.
const { ipcRenderer } = require("electron");

/** @type {MediaRecorder | null} */
let recorder = null;
/** @type {MediaStream | null} */
let stream = null;
// Serialises chunk sends so the final blob (dispatched just before `stop`) is
// fully forwarded before we tell main the recording stopped — otherwise the last
// cluster is lost and the webm ends prematurely.
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

ipcRenderer.on("audio:start", async (_event, opts) => {
  const { bitsPerSecond } = opts || {};
  try {
    // A plain microphone request. Echo cancellation / noise suppression keep the
    // narration clean for the transcriber without us touching the samples.
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1,
      },
      video: false,
    });

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: bitsPerSecond });

    recorder.ondataavailable = (e) => {
      if (!e.data || e.data.size === 0) return;
      // Preserve order and completion; Uint8Array survives IPC structured clone.
      sendChain = sendChain.then(async () => {
        const buf = await e.data.arrayBuffer();
        ipcRenderer.send("audio:chunk", new Uint8Array(buf));
      });
    };
    recorder.onstart = () => ipcRenderer.send("audio:started", Date.now());
    recorder.onstop = () => {
      // Wait for every queued chunk (including the final one) to be sent.
      sendChain.then(() => {
        cleanup();
        ipcRenderer.send("audio:stopped");
      });
    };
    recorder.onerror = (e) => {
      ipcRenderer.send("audio:error", String((e && e.error) || e));
    };

    // Emit a chunk every second so long sessions stream to disk incrementally.
    recorder.start(1000);
  } catch (err) {
    cleanup();
    ipcRenderer.send("audio:error", err instanceof Error ? err.message : String(err));
  }
});

ipcRenderer.on("audio:stop", () => {
  try {
    if (recorder && recorder.state !== "inactive") {
      recorder.requestData();
      recorder.stop();
    } else {
      ipcRenderer.send("audio:stopped");
    }
  } catch (err) {
    ipcRenderer.send("audio:error", err instanceof Error ? err.message : String(err));
    ipcRenderer.send("audio:stopped");
  }
});
