import { randomUUID } from "node:crypto";

import { app } from "electron";

import type { CaptureConfig } from "../../common/config";
import { EventType } from "../../common/events";
import type { MarkerResult, RecorderStatus, StartResult, StopResult } from "../../common/ipc";
import type { RecorderState, SessionMeta } from "../../common/types";
import { createLogger } from "../logger";
import type { Collector } from "./collector";
import { CollectorHost } from "./collector";
import { EventBus } from "./event-bus";
import { SessionStore } from "./session-store";

const log = createLogger("Recorder");

function makeSessionId(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${stamp}-${randomUUID().slice(0, 8)}`;
}

/** A best-effort media sidecar (e.g. screen video) tied to a session's lifecycle. */
export interface SessionMediaRecorder {
  start(sessionDir: string): Promise<void>;
  stop(): Promise<unknown>;
}

export interface RecorderDeps {
  /** Resolves the capture config in effect for the next session. */
  resolveConfig: () => CaptureConfig;
  /** Builds the collectors enabled by a config. */
  buildCollectors: (config: CaptureConfig) => readonly Collector[];
  /** Optional factory for the video sidecar; only used when `config.video`. */
  createVideoRecorder?: () => SessionMediaRecorder;
  /** Optional best-effort post-processing (frames + correlation) after stop. */
  postProcess?: (sessionDir: string) => Promise<void>;
}

/**
 * The recorder state machine. It owns session lifecycle, the shared event bus,
 * and the collector host. Capture sources are resolved from the current config
 * at each `start()`, so the user can change the capture level between sessions
 * without restarting the app. When `config.video` is set, an optional video
 * sidecar is started and stopped alongside the collectors (best-effort).
 */
export class RecorderController {
  private store: SessionStore | null = null;
  private readonly listeners = new Set<(s: RecorderStatus) => void>();
  private readonly bus = new EventBus();
  private readonly host: CollectorHost;
  private activeCollectors: readonly Collector[] = [];
  private video: SessionMediaRecorder | null = null;
  private processing: Promise<void> | null = null;
  private lastCompleted: { id: string; dir: string } | null = null;
  private lastProcessed = false;

  constructor(private readonly deps: RecorderDeps) {
    this.host = new CollectorHost(this.bus);
    // Every persisted event refreshes live status (event count, etc.).
    this.bus.subscribe(() => this.emit());
  }

  get state(): RecorderState {
    return this.store ? "recording" : "idle";
  }

  /** The last completed session's directory, if any (for analysis). */
  lastSessionDir(): string | null {
    return this.lastCompleted?.dir ?? null;
  }

  status(): RecorderStatus {
    return {
      state: this.state,
      sessionId: this.store?.meta.id ?? null,
      startedAt: this.store?.meta.startedAt ?? null,
      eventCount: this.store?.eventCount ?? 0,
      lastSession: this.lastCompleted
        ? { id: this.lastCompleted.id, processed: this.lastProcessed }
        : null,
    };
  }

  onStatusChanged(cb: (s: RecorderStatus) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit(): void {
    const s = this.status();
    for (const cb of this.listeners) cb(s);
  }

  async start(): Promise<StartResult> {
    if (this.store) return { ok: false, error: "Already recording" };
    const meta: SessionMeta = {
      id: makeSessionId(),
      startedAt: Date.now(),
      stoppedAt: null,
      platform: process.platform,
      appVersion: app.getVersion(),
    };
    const store = new SessionStore(meta);
    this.store = store;
    this.bus.attach(store);
    this.bus.publish({
      type: EventType.SessionStart,
      source: "recorder",
      payload: { platform: meta.platform },
    });
    log.info("Recording started:", meta.id, "->", store.dir);
    this.emit();

    const config = this.deps.resolveConfig();
    this.activeCollectors = this.deps.buildCollectors(config);
    await this.host.startAll(this.activeCollectors, store.dir);

    // Video is a best-effort sidecar; never let it block or fail the session.
    if (config.video && this.deps.createVideoRecorder) {
      this.video = this.deps.createVideoRecorder();
      try {
        await this.video.start(store.dir);
      } catch (err) {
        log.warn("video start failed:", err instanceof Error ? err.message : err);
        this.video = null;
      }
    }
    return { ok: true, sessionId: meta.id };
  }

  marker(note: string): MarkerResult {
    if (!this.store) return { ok: false, error: "Not recording" };
    this.bus.publish({ type: EventType.Marker, source: "user", payload: { note } });
    return { ok: true };
  }

  async stop(): Promise<StopResult> {
    const store = this.store;
    if (!store) return { ok: false, error: "Not recording" };
    // Stop collectors first so nothing publishes after the stream is finalized.
    await this.host.stopAll();
    if (this.video) {
      try {
        await this.video.stop();
      } catch (err) {
        log.warn("video stop failed:", err instanceof Error ? err.message : err);
      }
      this.video = null;
    }
    this.bus.publish({ type: EventType.SessionStop, source: "recorder", payload: {} });
    this.bus.detach();
    this.store = null;
    store.finalize(Date.now());
    this.lastCompleted = { id: store.meta.id, dir: store.dir };
    this.lastProcessed = false;
    log.info("Recording stopped:", store.meta.id, `(${store.eventCount} events)`);
    this.emit();
    // Frames + correlation run in the background so the UI returns promptly.
    this.processing = this.runPostProcess(store.dir, store.whenClosed());
    return { ok: true, sessionId: store.meta.id, sessionDir: store.dir };
  }

  /** Resolves when the most recent session's post-processing finishes. */
  whenProcessed(): Promise<void> {
    return this.processing ?? Promise.resolve();
  }

  private async runPostProcess(dir: string, closed: Promise<void>): Promise<void> {
    if (!this.deps.postProcess) {
      if (this.lastCompleted?.dir === dir) this.lastProcessed = true;
      this.emit();
      return;
    }
    try {
      await closed; // ensure events.jsonl is fully flushed before reading it
      await this.deps.postProcess(dir);
    } catch (err) {
      log.warn("post-processing failed:", err instanceof Error ? err.message : err);
    } finally {
      if (this.lastCompleted?.dir === dir) this.lastProcessed = true;
      this.emit();
    }
  }
}
