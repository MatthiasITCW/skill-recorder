import { open, stat } from "node:fs/promises";

import type { Collector, CollectorContext } from "../recorder/collector";
import { parseShellRecord, SHELL_LOG_PATH } from "./terminal-hooks";

const POLL_MS = 500;

/**
 * Tails the shell activity log (see terminal-hooks.ts) and emits a
 * `terminal.command` event per command run *during* the recording. On start it
 * seeks to the current end of the file, so pre-session history is ignored. If
 * the shell hooks are not installed the log simply never grows and this
 * collector stays silent — it never fails a recording.
 *
 * Cross-platform: the same tab-delimited, base64-encoded record format is
 * produced by the zsh, bash, and PowerShell hooks.
 */
export class TerminalCollector implements Collector {
  readonly name = "terminal";
  private timer: NodeJS.Timeout | null = null;
  private ctx: CollectorContext | null = null;
  private offset = 0;
  private remainder = "";
  private reading = false;

  async start(ctx: CollectorContext): Promise<void> {
    this.ctx = ctx;
    this.remainder = "";
    try {
      const s = await stat(SHELL_LOG_PATH);
      this.offset = s.size; // begin tailing from the end — ignore prior commands
    } catch {
      this.offset = 0; // log doesn't exist yet; we'll pick it up when it appears
    }
    this.timer = setInterval(() => void this.poll(), POLL_MS);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.poll(); // final flush of any trailing records
    this.ctx = null;
  }

  private async poll(): Promise<void> {
    if (this.reading || !this.ctx) return;
    this.reading = true;
    try {
      let size: number;
      try {
        size = (await stat(SHELL_LOG_PATH)).size;
      } catch {
        return; // no log file yet
      }
      if (size < this.offset) {
        // File was truncated or rotated between sessions — restart from the top.
        this.offset = 0;
        this.remainder = "";
      }
      if (size === this.offset) return;

      const handle = await open(SHELL_LOG_PATH, "r");
      try {
        const length = size - this.offset;
        const buf = Buffer.alloc(length);
        await handle.read(buf, 0, length, this.offset);
        this.offset = size;
        this.consume(buf.toString("utf8"));
      } finally {
        await handle.close();
      }
    } catch (err) {
      this.ctx?.log.warn("terminal tail failed:", err instanceof Error ? err.message : err);
    } finally {
      this.reading = false;
    }
  }

  /** Split appended text into complete lines, parse, and emit; keep any partial tail. */
  private consume(chunk: string): void {
    const text = this.remainder + chunk;
    const lines = text.split("\n");
    this.remainder = lines.pop() ?? ""; // last element is an incomplete line (or "")
    for (const line of lines) {
      const rec = parseShellRecord(line);
      if (!rec || !this.ctx) continue;
      this.ctx.publish("terminal.command", {
        command: rec.command,
        cwd: rec.cwd,
        shell: rec.shell,
        exitCode: rec.exitCode,
        durationMs: rec.durationMs,
      });
    }
  }
}
