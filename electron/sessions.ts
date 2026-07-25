import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import type { SessionSummary } from "../common/ipc";
import type { SessionMeta } from "../common/types";
import { loadPersistedAnalysis } from "./describer/describer";
import { createLogger } from "./logger";
import { sessionsRoot } from "./recorder/session-store";

const log = createLogger("Sessions");

/** Enumerate saved recordings for the sessions library, newest first. */
export function listSessions(): SessionSummary[] {
  const root = sessionsRoot();
  if (!existsSync(root)) return [];

  const out: SessionSummary[] = [];
  let names: string[];
  try {
    names = readdirSync(root);
  } catch (err) {
    log.warn("failed to read sessions dir:", err instanceof Error ? err.message : err);
    return [];
  }

  for (const name of names) {
    const dir = path.join(root, name);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    let meta: SessionMeta | null = null;
    try {
      meta = JSON.parse(readFileSync(path.join(dir, "session.json"), "utf8")) as SessionMeta;
    } catch {
      continue; // not a valid session dir
    }
    if (!meta?.id) continue;

    const analysis = loadPersistedAnalysis(name);
    out.push({
      id: meta.id,
      startedAt: meta.startedAt ?? null,
      stoppedAt: meta.stoppedAt ?? null,
      durationMs: meta.startedAt && meta.stoppedAt ? meta.stoppedAt - meta.startedAt : null,
      processed: existsSync(path.join(dir, "bundle.json")),
      hasVideo: existsSync(path.join(dir, "video.json")),
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
    });
  }

  out.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  return out;
}
