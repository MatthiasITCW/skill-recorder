import { createWriteStream, existsSync, type WriteStream } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BrowserWindow, desktopCapturer, ipcMain, type IpcMainEvent } from "electron";

import { createLogger } from "../logger";

const log = createLogger("Video");
const dirname = path.dirname(fileURLToPath(import.meta.url));

/** Result metadata written alongside the webm as `video.json`. */
export interface VideoResult {
  file: string;
  /** Wall-clock epoch (ms) when MediaRecorder actually started — the anchor that
   *  maps `event_t → video offset` for frame extraction. */
  startEpoch: number;
  stopEpoch: number;
  durationMs: number;
  bytes: number;
  fps: number;
}

// Screen capture's real cost is WindowServer (the OS compositor) grabbing the
// framebuffer at the capture rate — not our encoder. So we keep the rate and
// resolution deliberately low: this is opportunistic enrichment anchored to
// events, never something anyone watches. 1 fps @ 720p is plenty to recover a
// keyframe near each event while keeping the compositor (and the mouse) smooth.
const FPS = 1;
const BITS_PER_SECOND = 500_000;
const MAX_WIDTH = 1280;
const MAX_HEIGHT = 720;
const STOP_TIMEOUT_MS = 4000;

/**
 * Captures a low-fps screen recording for a session. The heavy lifting
 * (getUserMedia + MediaRecorder) happens in a hidden renderer window
 * (electron/video/capture.html + capture-preload.cjs); this class orchestrates
 * it from the main process and writes the webm + `video.json` to the session
 * folder. Capture is strictly best-effort: if there is no screen source or the
 * Screen Recording permission is absent, it logs and the session proceeds
 * without video.
 */
export class VideoRecorder {
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
    log.info("recording started; anchor epoch", epoch);
  };

  private readonly onStopped = (e: IpcMainEvent) => {
    if (e.sender !== this.win?.webContents) return;
    this.stoppedResolve?.();
  };

  private readonly onError = (e: IpcMainEvent, message: string) => {
    if (e.sender !== this.win?.webContents) return;
    this.failed = true;
    log.warn("capture unavailable:", message);
    // Unblock a pending stop() if the recorder never really started.
    this.stoppedResolve?.();
  };

  /** Begin capturing into `<sessionDir>/video.webm`. Never throws. */
  async start(sessionDir: string): Promise<void> {
    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 0, height: 0 },
      });
      if (sources.length === 0) {
        log.warn("no screen source available; skipping video");
        return;
      }
      const source = sources[0];

      this.dir = sessionDir;
      this.file = path.join(sessionDir, "video.webm");
      this.bytes = 0;
      this.startEpoch = null;
      this.failed = false;
      this.stream = createWriteStream(this.file);

      ipcMain.on("video:chunk", this.onChunk);
      ipcMain.on("video:started", this.onStarted);
      ipcMain.on("video:stopped", this.onStopped);
      ipcMain.on("video:error", this.onError);

      this.win = new BrowserWindow({
        show: false,
        webPreferences: {
          preload: path.join(dirname, "video", "capture-preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
        },
      });
      await this.win.loadFile(path.join(dirname, "video", "capture.html"));

      this.win.webContents.send("video:start", {
        sourceId: source.id,
        fps: FPS,
        bitsPerSecond: BITS_PER_SECOND,
        maxWidth: MAX_WIDTH,
        maxHeight: MAX_HEIGHT,
      });
      log.info("capture requested for screen source", source.id, "->", this.file);
    } catch (err) {
      log.warn("failed to start video:", err instanceof Error ? err.message : err);
      await this.teardown();
    }
  }

  /** Stop capturing and return the result, or null if no usable video was produced. */
  async stop(): Promise<VideoResult | null> {
    if (!this.win || !this.stream) {
      await this.teardown();
      return null;
    }

    const stopped = new Promise<void>((resolve) => {
      this.stoppedResolve = resolve;
      this.win?.webContents.send("video:stop");
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
      log.warn("no usable video captured");
      return null;
    }

    const result: VideoResult = {
      file: path.basename(file),
      startEpoch,
      stopEpoch,
      durationMs: stopEpoch - startEpoch,
      bytes,
      fps: FPS,
    };
    await writeFile(path.join(this.dirFor(file), "video.json"), JSON.stringify(result, null, 2)).catch(
      (err) => log.warn("failed to write video.json:", err instanceof Error ? err.message : err),
    );
    log.info(`video saved: ${result.file} (${(bytes / 1_000_000).toFixed(1)} MB, ${result.durationMs} ms)`);
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
    ipcMain.removeListener("video:chunk", this.onChunk);
    ipcMain.removeListener("video:started", this.onStarted);
    ipcMain.removeListener("video:stopped", this.onStopped);
    ipcMain.removeListener("video:error", this.onError);
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
