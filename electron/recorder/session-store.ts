import { createWriteStream, mkdirSync, writeFileSync, type WriteStream } from "node:fs";
import path from "node:path";

import { app } from "electron";

import type { RecEvent, SessionMeta } from "../../common/types";

/** Root folder that holds one sub-directory per recorded session. */
export function sessionsRoot(): string {
  return path.join(app.getPath("userData"), "sessions");
}

/**
 * Owns the on-disk artifacts for a single recording session:
 *   <sessionsRoot>/<id>/session.json      session metadata
 *   <sessionsRoot>/<id>/events.jsonl      append-only event stream
 *   <sessionsRoot>/<id>/frames/           extracted keyframes (later milestones)
 */
export class SessionStore {
  readonly meta: SessionMeta;
  readonly dir: string;
  private readonly eventsStream: WriteStream;
  private readonly startMonotonic: number;
  private readonly closed: Promise<void>;
  private count = 0;

  constructor(meta: SessionMeta) {
    this.meta = meta;
    this.dir = path.join(sessionsRoot(), meta.id);
    mkdirSync(path.join(this.dir, "frames"), { recursive: true });
    this.eventsStream = createWriteStream(path.join(this.dir, "events.jsonl"), { flags: "a" });
    this.closed = new Promise<void>((resolve) => {
      this.eventsStream.once("close", () => resolve());
    });
    this.startMonotonic = performance.now();
    this.writeMeta();
  }

  get eventCount(): number {
    return this.count;
  }

  /** Resolves once the events stream has fully flushed to disk (after finalize). */
  whenClosed(): Promise<void> {
    return this.closed;
  }

  private writeMeta(): void {
    writeFileSync(path.join(this.dir, "session.json"), JSON.stringify(this.meta, null, 2));
  }

  append(type: string, source: string, payload: Record<string, unknown> = {}): RecEvent {
    const ev: RecEvent = {
      seq: this.count,
      t: performance.now() - this.startMonotonic,
      epoch: Date.now(),
      type,
      source,
      payload,
    };
    this.eventsStream.write(JSON.stringify(ev) + "\n");
    this.count++;
    return ev;
  }

  finalize(stoppedAt: number): void {
    this.meta.stoppedAt = stoppedAt;
    this.writeMeta();
    this.eventsStream.end();
  }
}
