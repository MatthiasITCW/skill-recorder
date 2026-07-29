import { z } from "zod";

/**
 * A **value** is a named fixed literal (a URL, path, repo slug, or constant) that a
 * plan's steps reference by a `{{id}}` token. It replaces the old free-standing
 * "inputs" construct: the literal lives *inside* the step template and is substituted
 * deterministically at the final render boundary (`SKILL.md` / `automation.json`), so
 * what the user edits in the review UI is exactly what ships — no second agent turn
 * needed to honor an edit. In the review UI each token renders as an inline, editable
 * "pill" whose label is the value's `name` and whose text is the value's `value`.
 */
export const ValueSchema = z.object({
  /** Token key referenced in step/body text as `{{id}}`; normalized to `[a-z0-9_]`. */
  id: z.string().transform(slugifyValueId),
  /** Human label shown on the editable pill, e.g. "Blog Backlog v2 URL". */
  name: z.string().default(""),
  /** The fixed literal substituted in for the token (the URL / path / constant). */
  value: z.string().default(""),
});
export type Value = z.infer<typeof ValueSchema>;

/** Normalize arbitrary text into a safe token id (`[a-z0-9_]+`, ≤40 chars). */
export function slugifyValueId(raw: string): string {
  const id = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
    .replace(/_+$/g, "");
  return id || "value";
}

/** A parsed run of template text: either literal text or a `{{id}}` token reference. */
export type TextSegment = { kind: "text"; text: string } | { kind: "token"; id: string };

/** Matches `{{ id }}` (optional inner whitespace); id is `[a-z0-9_]+`, case-insensitive. */
const TOKEN_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

/** Split template text into literal + token segments (drives the pill renderer). */
export function tokenize(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: "text", text: text.slice(last, at) });
    out.push({ kind: "token", id: m[1].toLowerCase() });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

/** The distinct token ids referenced in text, in first-seen order. */
export function tokenIds(text: string): string[] {
  const ids: string[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const id = m[1].toLowerCase();
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Deterministically substitute `{{id}}` → the matching value's literal. Unknown tokens
 *  are left untouched (surfaced to the UI/validation via {@link unresolvedTokens}). */
export function renderValues(text: string, values: Value[]): string {
  if (!text) return text;
  const map = new Map(values.map((v) => [v.id, v.value]));
  return text.replace(TOKEN_RE, (whole, id: string) => {
    const hit = map.get(id.toLowerCase());
    return hit === undefined ? whole : hit;
  });
}

/** Token ids referenced in text that have no matching declared value (for validation/UI). */
export function unresolvedTokens(text: string, values: Value[]): string[] {
  const known = new Set(values.map((v) => v.id));
  return tokenIds(text).filter((id) => !known.has(id));
}

/**
 * Back-compat: older persisted plans carried an `inputs[]` construct with a `source`
 * (fixed / provided / locate, or the even older constant / ask / discover). Only the
 * genuinely *fixed* ones map cleanly onto values; the rest were runtime- or
 * agent-resolved and now live as plain prose in the steps, so they are dropped. Used by
 * the plan schemas' `preprocess` so old drafts keep loading.
 */
export function migrateLegacyInputsToValues(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as Record<string, unknown>;
  // New-shape plans already carry `values`; leave them untouched.
  if (Array.isArray(obj.values)) return raw;
  if (!Array.isArray(obj.inputs)) return raw;
  const values = (obj.inputs as unknown[])
    .map((i) => (i && typeof i === "object" ? (i as Record<string, unknown>) : null))
    .filter((i): i is Record<string, unknown> => {
      const src = i?.source;
      return typeof i?.name === "string" && (src === "fixed" || src === "constant");
    })
    .map((i) => ({
      id: slugifyValueId(String(i.name)),
      name: String(i.name),
      value: typeof i.detail === "string" ? i.detail : "",
    }));
  return { ...obj, values };
}
