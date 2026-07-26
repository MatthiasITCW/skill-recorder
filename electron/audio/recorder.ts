import { createWriteStream, existsSync, type WriteStream } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BrowserWindow, ipcMain, type IpcMainEvent } from "electron";

import { createLogger } from "../logger";

const log = createLogger("Narration/audio");
const dirname = path.dirname(fileURLToPath(import.meta.url));

/** Result metadata written alongside the webm as `audio.json`. */
export interface AudioResult {
  file: string;
  /** Wall-clock epoch (ms) when MediaRecorder actually started — the anchor that
   *  maps a transcript segment's offset back onto the session clock. */
  startEpoch: number;
  stopEpoch: number;
  durationMs: number;
  bytes: number;
}

// Opus at 24 kbps mono is transparent for speech and keeps narration files tiny.
const BITS_PER_SECOND = 24_000;
const STOP_TIMEOUT_MS = 4000;

/**
 * Captures the user's microphone narration for a session, mirroring the video
 * sidecar: the heavy lifting (getUserMedia + MediaRecorder) happens in a hidden
 * renderer window (electron/audio/capture.html + capture-preload.cjs); this class
 * orchestrates it from the main process and writes the webm + `audio.json` to the
 * session folder. Capture is strictly opt-in (started only when the user enabled
 * narration for the session) and best-effort: if there is no microphone or the
 * permission is denied, it logs and the session proceeds without narration.
 */
export class AudioRecorder {
  private win: BrowserWindow | null = null;
  private stream: WriteStream | null = null;
  private file = "";
  private dir = "";
  private bytes = 0;
  private startEpoch: number | null = null;
  private stoppedResolve: (() => void) | null = null;
  private failed = false;

  private readonly onChunk = (e: IpcMainEvent, chunk: Uint8Array) => {
    if (e.sender !== this.win?.webContents || !this.stream) return;
    const buf = Buffer.from(chunk);
    this.bytes += buf.byteLength;
    this.stream.write(buf);
  };

  private readonly onStarted = (e: IpcMainEvent, epoch: number) => {
    if (e.sender !== this.win?.webContents) return;
    this.startEpoch = epoch;
    log.info("narration started; anchor epoch", epoch);
  };

  private readonly onStopped = (e: IpcMainEvent) => {
    if (e.sender !== this.win?.webContents) return;
    this.stoppedResolve?.();
  };

  private readonly onError = (e: IpcMainEvent, message: string) => {
    if (e.sender !== this.win?.webContents) return;
    this.failed = true;
    log.warn("microphone unavailable:", message);
    // Unblock a pending stop() if the recorder never really started.
    this.stoppedResolve?.();
  };

  /** Begin capturing into `<sessionDir>/audio.webm`. Never throws. */
  async start(sessionDir: string): Promise<void> {
    try {
      this.dir = sessionDir;
      this.file = path.join(sessionDir, "audio.webm");
      this.bytes = 0;
      this.startEpoch = null;
      this.failed = false;
      this.stream = createWriteStream(this.file);

      ipcMain.on("audio:chunk", this.onChunk);
      ipcMain.on("audio:started", this.onStarted);
      ipcMain.on("audio:stopped", this.onStopped);
      ipcMain.on("audio:error", this.onError);

      this.win = new BrowserWindow({
        show: false,
        webPreferences: {
          preload: path.join(dirname, "audio", "capture-preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
        },
      });
      await this.win.loadFile(path.join(dirname, "audio", "capture.html"));

      this.win.webContents.send("audio:start", { bitsPerSecond: BITS_PER_SECOND });
      log.info("narration capture requested ->", this.file);
    } catch (err) {
      log.warn("failed to start narration:", err instanceof Error ? err.message : err);
      await this.teardown();
    }
  }

  /** Stop capturing and return the result, or null if no usable audio was produced. */
  async stop(): Promise<AudioResult | null> {
    if (!this.win || !this.stream) {
      await this.teardown();
      return null;
    }

    const stopped = new Promise<void>((resolve) => {
      this.stoppedResolve = resolve;
      this.win?.webContents.send("audio:stop");
    });
    await Promise.race([stopped, delay(STOP_TIMEOUT_MS)]);

    const stopEpoch = Date.now();
    await this.closeStream();

    const bytes = this.bytes;
    const startEpoch = this.startEpoch;
    const file = this.file;
    const failed = this.failed;
    await this.teardown();

    if (failed || bytes === 0 || startEpoch == null) {
      // Remove a useless/empty file so the session folder stays clean.
      if (existsSync(file)) await unlink(file).catch(() => undefined);
      log.warn("no usable narration captured");
      return null;
    }

    const result: AudioResult = {
      file: path.basename(file),
      startEpoch,
      stopEpoch,
      durationMs: stopEpoch - startEpoch,
      bytes,
    };
    await writeFile(
      path.join(this.dirFor(file), "audio.json"),
      JSON.stringify(result, null, 2),
    ).catch((err) => log.warn("failed to write audio.json:", err instanceof Error ? err.message : err));
    log.info(`narration saved: ${result.file} (${(bytes / 1000).toFixed(0)} KB, ${result.durationMs} ms)`);
    return result;
  }

  private dirFor(file: string): string {
    return this.dir || path.dirname(file);
  }

  private closeStream(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.stream) return resolve();
      this.stream.end(() => resolve());
    });
  }

  private async teardown(): Promise<void> {
    ipcMain.removeListener("audio:chunk", this.onChunk);
    ipcMain.removeListener("audio:started", this.onStarted);
    ipcMain.removeListener("audio:stopped", this.onStopped);
    ipcMain.removeListener("audio:error", this.onError);
    this.stoppedResolve = null;
    await this.closeStream();
    this.stream = null;
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
