import { createWriteStream, existsSync, type WriteStream } from "node:fs";
import { mkdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BrowserWindow, ipcMain, type IpcMainEvent } from "electron";

import {
  AUDIO_MANIFEST_VERSION,
  alignAudioSegmentsToVideo,
  type AudioManifestV2,
  type AudioSegment,
  type LegacyAudioMetadata,
} from "../../common/audio";
import type { NarrationLanguage } from "../../common/narration";
import { createLogger } from "../logger";
import type { AudioCaptureEnded } from "../recorder/controller";

const log = createLogger("Narration/audio");
const dirname = path.dirname(fileURLToPath(import.meta.url));

/** Kept as a source-compatible name for readers of legacy `audio.json` files. */
export type AudioResult = LegacyAudioMetadata;

// Opus at 24 kbps mono is transparent for speech and keeps narration files tiny.
const BITS_PER_SECOND = 24_000;
const START_TIMEOUT_MS = 10_000;
const STOP_TIMEOUT_MS = 4_000;
const AUDIO_DIR = "audio";

interface PendingSegment {
  id: string;
  file: string;
  relativeFile: string;
  stream: WriteStream;
  bytes: number;
  startEpoch: number | null;
  stopEpoch: number | null;
  failed: boolean;
  error: string | null;
  ended: boolean;
  stopRequested: boolean;
  startedResolve: (() => void) | null;
  startedReject: ((error: Error) => void) | null;
  stoppedResolve: (() => void) | null;
}

/**
 * Owns microphone capture for one recording session. The hidden renderer stays
 * alive for the session, but each microphone-on interval gets a fresh
 * MediaStream, MediaRecorder, and WebM file so off-periods remain real timeline
 * gaps and the OS microphone device is released between intervals.
 */
export class AudioRecorder {
  private win: BrowserWindow | null = null;
  private dir = "";
  private sessionStartedAt = 0;
  private narrationLanguage: NarrationLanguage = "en";
  private sequence = 0;
  private active: PendingSegment | null = null;
  private disableTask: Promise<AudioSegment | null> | null = null;
  private readonly segments: AudioSegment[] = [];

  constructor(
    private readonly onCaptureEnded: (event: AudioCaptureEnded) => void = () => undefined,
  ) {}

  private readonly onChunk = (event: IpcMainEvent, id: string, chunk: Uint8Array) => {
    const active = this.ownedSegment(event, id);
    if (!active || !(chunk instanceof Uint8Array) || chunk.byteLength === 0) return;
    const buffer = Buffer.from(chunk);
    active.bytes += buffer.byteLength;
    active.stream.write(buffer);
  };

  private readonly onStarted = (event: IpcMainEvent, id: string, epoch: number) => {
    const active = this.ownedSegment(event, id);
    if (!active || !Number.isFinite(epoch)) return;
    active.startEpoch = epoch;
    active.startedResolve?.();
    active.startedResolve = null;
    active.startedReject = null;
    log.info("microphone segment started; anchor epoch", epoch);
  };

  private readonly onStopped = (event: IpcMainEvent, id: string, epoch: number) => {
    const active = this.ownedSegment(event, id);
    if (!active) return;
    const unexpected = !active.stopRequested && active.startEpoch != null;
    active.stopEpoch = Number.isFinite(epoch) ? epoch : Date.now();
    active.ended = true;
    active.stoppedResolve?.();
    active.stoppedResolve = null;
    if (unexpected) {
      this.finishUnexpected(active, "The microphone stopped unexpectedly.", false);
    }
  };

  private readonly onError = (event: IpcMainEvent, id: string, error: string) => {
    const active = this.ownedSegment(event, id);
    if (!active) return;
    const reason = error || "Microphone capture failed.";
    active.error = reason;
    log.warn("microphone unavailable:", reason);
    if (active.startEpoch == null) {
      active.failed = true;
      active.startedReject?.(new Error(reason));
      active.startedResolve = null;
      active.startedReject = null;
      return;
    }
    this.finishUnexpected(active, reason, true);
  };

  /** Prepare the session's hidden audio utility window without touching the mic. */
  async start(
    sessionDir: string,
    sessionStartedAt: number,
    narrationLanguage: NarrationLanguage,
  ): Promise<void> {
    if (this.win) throw new Error("Microphone recorder is already initialized.");
    this.dir = sessionDir;
    this.sessionStartedAt = sessionStartedAt;
    this.narrationLanguage = narrationLanguage;
    this.sequence = 0;
    this.segments.length = 0;
    await mkdir(path.join(this.dir, AUDIO_DIR), { recursive: true });

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
        backgroundThrottling: false,
      },
    });
    this.win.once("closed", () => {
      const active = this.active;
      if (!active || active.ended) return;
      active.failed = true;
      active.error = "Microphone capture window closed unexpectedly.";
      active.startedReject?.(new Error(active.error));
      active.ended = true;
      active.stoppedResolve?.();
      this.finishUnexpected(active, active.error, true);
    });

    try {
      await this.win.loadFile(path.join(dirname, "audio", "capture.html"));
    } catch (error) {
      await this.teardown();
      throw error;
    }
  }

  /** Request microphone access and begin a new independently timestamped segment. */
  async enable(): Promise<void> {
    if (!this.win || this.win.isDestroyed()) {
      throw new Error("Microphone capture is not available for this recording.");
    }
    if (this.active) throw new Error("Microphone capture is already active.");

    const number = ++this.sequence;
    const id = `segment-${String(number).padStart(4, "0")}`;
    const name = `${id}.webm`;
    const file = path.join(this.dir, AUDIO_DIR, name);
    const stream = createWriteStream(file);
    const active: PendingSegment = {
      id,
      file,
      relativeFile: path.posix.join(AUDIO_DIR, name),
      stream,
      bytes: 0,
      startEpoch: null,
      stopEpoch: null,
      failed: false,
      error: null,
      ended: false,
      stopRequested: false,
      startedResolve: null,
      startedReject: null,
      stoppedResolve: null,
    };
    stream.once("error", (error) => {
      active.failed = true;
      active.error = error.message;
      active.startedReject?.(error);
      log.warn("microphone segment write failed:", error.message);
      if (active.startEpoch != null) this.finishUnexpected(active, error.message, true);
    });
    this.active = active;

    const started = new Promise<void>((resolve, reject) => {
      active.startedResolve = resolve;
      active.startedReject = reject;
    });
    this.win.webContents.send("audio:start", {
      id,
      bitsPerSecond: BITS_PER_SECOND,
    });

    try {
      await withTimeout(started, START_TIMEOUT_MS, "Timed out starting microphone capture.");
    } catch (error) {
      await this.disable();
      throw error;
    }
  }

  /** Flush and close the active segment, releasing the microphone device. */
  async disable(): Promise<AudioSegment | null> {
    if (this.disableTask) return this.disableTask;
    const task = this.disableInternal();
    this.disableTask = task;
    try {
      return await task;
    } finally {
      if (this.disableTask === task) this.disableTask = null;
    }
  }

  private async disableInternal(): Promise<AudioSegment | null> {
    const active = this.active;
    if (!active) return null;

    active.stopRequested = true;
    if (!active.ended) {
      const stopped = new Promise<void>((resolve) => {
        active.stoppedResolve = resolve;
      });
      if (this.win && !this.win.isDestroyed()) {
        this.win.webContents.send("audio:stop", { id: active.id });
      } else {
        active.failed = true;
        active.error ??= "Microphone capture window is unavailable.";
        active.ended = true;
        active.stoppedResolve?.();
      }

      try {
        await withTimeout(stopped, STOP_TIMEOUT_MS, "Timed out stopping microphone capture.");
      } catch (error) {
        log.warn(error instanceof Error ? error.message : String(error));
        active.stopEpoch ??= Date.now();
        if (this.win && !this.win.isDestroyed()) this.win.destroy();
      }
    }

    await closeStream(active.stream);
    this.active = null;

    if (
      active.failed ||
      active.bytes === 0 ||
      active.startEpoch == null ||
      active.stopEpoch == null
    ) {
      if (existsSync(active.file)) await unlink(active.file).catch(() => undefined);
      if (active.error) log.warn("discarded unusable microphone segment:", active.error);
      return null;
    }

    const startEpoch = active.startEpoch;
    const stopEpoch = Math.max(startEpoch, active.stopEpoch);
    const segment: AudioSegment = {
      file: active.relativeFile,
      startEpoch,
      stopEpoch,
      durationMs: stopEpoch - startEpoch,
      sessionStartMs: Math.round(startEpoch - this.sessionStartedAt),
      sessionEndMs: Math.round(stopEpoch - this.sessionStartedAt),
      videoStartMs: null,
      videoEndMs: null,
      bytes: active.bytes,
    };
    this.segments.push(segment);
    log.info(
      `microphone segment saved: ${segment.file} (${(segment.bytes / 1000).toFixed(0)} KB, ` +
        `${segment.durationMs} ms)`,
    );
    return segment;
  }

  /** Finish the session and atomically persist its segment manifest. */
  async finish(videoStartEpoch: number | null): Promise<AudioManifestV2 | null> {
    if (this.active) await this.disable();

    const segments = alignAudioSegmentsToVideo(this.segments, videoStartEpoch);
    const manifest: AudioManifestV2 | null =
      segments.length > 0
        ? {
            version: AUDIO_MANIFEST_VERSION,
            narrationLanguage: this.narrationLanguage,
            segments,
          }
        : null;

    try {
      if (manifest) {
        const file = path.join(this.dir, "audio.json");
        const temp = `${file}.tmp.${process.pid}.${Date.now()}`;
        try {
          await writeFile(temp, JSON.stringify(manifest, null, 2));
          await rename(temp, file);
        } finally {
          await rm(temp, { force: true });
        }
      } else {
        await rm(path.join(this.dir, "audio.json"), { force: true });
        await rm(path.join(this.dir, AUDIO_DIR), { recursive: true, force: true });
      }
      return manifest;
    } finally {
      await this.teardown();
    }
  }

  private ownedSegment(event: IpcMainEvent, id: string): PendingSegment | null {
    if (event.sender !== this.win?.webContents || this.active?.id !== id) return null;
    return this.active;
  }

  private finishUnexpected(
    active: PendingSegment,
    error: string,
    discardSegment: boolean,
  ): void {
    if (this.active !== active || active.stopRequested) return;
    if (discardSegment) active.failed = true;
    active.stopRequested = true;
    void this.disable()
      .catch((disableError) => {
        log.warn(
          "failed to release microphone after capture ended:",
          disableError instanceof Error ? disableError.message : disableError,
        );
      })
      .finally(() => this.onCaptureEnded({ error }));
  }

  private async teardown(): Promise<void> {
    ipcMain.removeListener("audio:chunk", this.onChunk);
    ipcMain.removeListener("audio:started", this.onStarted);
    ipcMain.removeListener("audio:stopped", this.onStopped);
    ipcMain.removeListener("audio:error", this.onError);
    if (this.active) {
      await closeStream(this.active.stream);
      this.active = null;
    }
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}

function closeStream(stream: WriteStream): Promise<void> {
  return new Promise((resolve) => {
    if (stream.closed || stream.destroyed) {
      resolve();
      return;
    }
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    stream.once("close", done);
    stream.end(done);
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, expired]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}
