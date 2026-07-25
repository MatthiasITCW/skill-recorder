/** Timecode counter — mm:ss, for the live recorder readout. */
export function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Compact duration, e.g. "9s" or "1m 12s". */
export function formatDur(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/**
 * Compact one-line label derived from a full intent sentence. Used as the
 * sessions-list name when an analysis has no short `title` (older analyses saved
 * before the describer produced one). Trims to a word boundary near 44 chars so
 * the list stays scannable instead of wrapping the whole goal sentence.
 */
export function shortLabel(intent: string): string {
  const clean = intent.trim().replace(/\s+/g, " ").replace(/[.\s]+$/, "");
  if (clean.length <= 44) return clean;
  const cut = clean.slice(0, 44);
  const sp = cut.lastIndexOf(" ");
  return (sp > 24 ? cut.slice(0, sp) : cut).replace(/[,;:]+$/, "") + "…";
}

/** Human timestamp for a saved session, e.g. "Jul 25, 1:05 AM". */
export function formatWhen(ms: number | null): string {
  if (ms == null) return "—";
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
