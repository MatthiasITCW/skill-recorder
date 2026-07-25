import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { AnalysisSchema, type Analysis } from "../common/analysis";
import type { SessionSummary } from "../common/ipc";
import type { SessionMeta } from "../common/types";
import { isValidSessionId, sessionsRoot } from "./recorder/session-store";

/** True when `file` exists (non-throwing `fs.access`). */
async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/** Load and validate a session's persisted analysis without blocking the main thread. */
async function loadAnalysis(dir: string): Promise<Analysis | null> {
  try {
    const raw = JSON.parse(await readFile(path.join(dir, "analysis.json"), "utf8"));
    const parsed = AnalysisSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Build the library summary for a single session dir, or null if it isn't one. */
async function summarize(root: string, name: string): Promise<SessionSummary | null> {
  const dir = path.join(root, name);
  try {
    if (!(await stat(dir)).isDirectory()) return null;
  } catch {
    return null;
  }

  let meta: SessionMeta | null = null;
  try {
    meta = JSON.parse(await readFile(path.join(dir, "session.json"), "utf8")) as SessionMeta;
  } catch {
    return null; // not a valid session dir
  }
  if (!meta?.id) return null;

  const [analysis, processed, hasVideo] = await Promise.all([
    loadAnalysis(dir),
    exists(path.join(dir, "bundle.json")),
    exists(path.join(dir, "video.json")),
  ]);

  return {
    id: meta.id,
    startedAt: meta.startedAt ?? null,
    stoppedAt: meta.stoppedAt ?? null,
    durationMs: meta.startedAt && meta.stoppedAt ? meta.stoppedAt - meta.startedAt : null,
    processed,
    hasVideo,
    analysis: analysis
      ? {
          revision: analysis.revision,
          title: analysis.title ?? "",
          intent: analysis.intent,
          intentConfidence: analysis.intentConfidence,
          stepCount: analysis.steps.length,
          approved: analysis.approved ?? false,
        }
      : null,
  };
}

/** Enumerate saved recordings for the sessions library, newest first. */
export async function listSessions(): Promise<SessionSummary[]> {
  const root = sessionsRoot();
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return []; // no sessions dir yet
  }

  const summaries = await Promise.all(
    names.filter((name) => isValidSessionId(name)).map((name) => summarize(root, name)),
  );
  const out = summaries.filter((s): s is SessionSummary => s !== null);
  out.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  return out;
}
