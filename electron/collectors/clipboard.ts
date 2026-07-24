import { createHash } from "node:crypto";

import { clipboard } from "electron";

import type { Collector, CollectorContext } from "../recorder/collector";

const POLL_MS = 700;
const PREVIEW_MAX = 120;

function sha1(input: string | Buffer): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 16);
}

/** One-line, length-capped preview with newlines collapsed (privacy milestone tightens this). */
function preview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_MAX ? flat.slice(0, PREVIEW_MAX) + "…" : flat;
}

/**
 * Detects clipboard changes by polling (Electron exposes no change event) and
 * emits `clipboard.change` with the available formats, content length, a stable
 * short hash, and a truncated text preview. The clipboard contents present at
 * session start are used only as a baseline and are never emitted, so we capture
 * copies made *during* the recording, not unrelated pre-session data.
 *
 * Cross-platform: Electron's clipboard API is uniform on macOS and Windows.
 */
export class ClipboardCollector implements Collector {
  readonly name = "clipboard";
  private timer: NodeJS.Timeout | null = null;
  private ctx: CollectorContext | null = null;
  private lastSig = "";

  start(ctx: CollectorContext): void {
    this.ctx = ctx;
    this.lastSig = this.signature().sig; // baseline; do not emit pre-session content
    this.timer = setInterval(() => this.poll(), POLL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.ctx = null;
  }

  /** Reads the clipboard once and derives a change signature + descriptor. */
  private signature(): {
    sig: string;
    formats: string[];
    length: number;
    hash: string;
    textPreview?: string;
  } {
    const formats = clipboard.availableFormats();
    const text = clipboard.readText();

    let length = text.length;
    let hashInput: string | Buffer = text;
    let textPreview: string | undefined = text ? preview(text) : undefined;

    if (!text && formats.some((f) => f.startsWith("image/"))) {
      const img = clipboard.readImage();
      if (!img.isEmpty()) {
        const png = img.toPNG();
        length = png.byteLength;
        hashInput = png;
        const { width, height } = img.getSize();
        textPreview = `[image ${width}x${height}]`;
      }
    }

    const hash = sha1(hashInput);
    return { sig: `${formats.join(",")}|${length}|${hash}`, formats, length, hash, textPreview };
  }

  private poll(): void {
    if (!this.ctx) return;
    try {
      const s = this.signature();
      if (s.sig === this.lastSig) return;
      this.lastSig = s.sig;
      if (s.formats.length === 0) return; // cleared clipboard — nothing to describe
      this.ctx.publish("clipboard.change", {
        formats: s.formats,
        length: s.length,
        hash: s.hash,
        ...(s.textPreview ? { textPreview: s.textPreview } : {}),
      });
    } catch (err) {
      this.ctx.log.warn("clipboard read failed:", err instanceof Error ? err.message : err);
    }
  }
}
