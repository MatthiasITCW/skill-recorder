import { useCallback, useEffect, useRef, useState } from "react";

import type { Analysis } from "../common/analysis";
import type {
  AnalyzeProgress,
  AutomationBuildProgress,
  SessionSummary,
  SkillBuildProgress,
} from "../common/ipc";
import type {
  BuildTarget,
  BuiltSkill,
  SkillArchitecture,
  SkillPlan,
} from "../common/skill";
import { ARCHITECTURES, TARGETS } from "../common/skill";
import type { AutomationPlan, BuiltAutomation } from "../common/automation";
import { describeSchedule } from "../common/automation";
import { formatDur, formatMs, formatWhen, shortLabel } from "./format";

export function Library() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    const list = await window.skillRecorder.listSessions();
    setSessions(list);
    setLoaded(true);
    setSelectedId((prev) => prev ?? list[0]?.id ?? null);
  }, []);

  useEffect(() => {
    void loadSessions();
    return window.skillRecorder.onStatusChanged((s) => {
      if (s.state !== "recording") void loadSessions();
    });
  }, [loadSessions]);

  const deleteSession = useCallback(async (id: string) => {
    setNotice(null);
    const res = await window.skillRecorder.deleteSession(id);
    if (!res.ok) {
      setNotice(res.error ?? "Could not delete this recording.");
      return;
    }
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      const next = prev.filter((s) => s.id !== id);
      setSelectedId((cur) => {
        if (cur !== id) return cur;
        if (next.length === 0) return null;
        return (next[idx] ?? next[next.length - 1]).id;
      });
      return next;
    });
  }, []);

  const selected = sessions.find((s) => s.id === selectedId) ?? null;

  return (
    <div className="lib">
      <aside className="lib-list">
        <div className="lib-list-head">
          <span className="eyebrow">Sessions</span>
          <span className="pill">{sessions.length}</span>
        </div>
        {notice && (
          <button className="sess-notice" onClick={() => setNotice(null)} title="Dismiss">
            {notice}
          </button>
        )}
        <div className="lib-list-scroll">
          <SessionsList
            sessions={sessions}
            loaded={loaded}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onDelete={deleteSession}
          />
        </div>
      </aside>
      <main className="lib-detail">
        {selected ? (
          <AnalysisWorkspace key={selected.id} summary={selected} onChanged={loadSessions} />
        ) : (
          <div className="detail-empty">
            <span className="eyebrow">No session selected</span>
            <p>Pick a recording on the left to review its reconstructed intent and steps.</p>
          </div>
        )}
      </main>
    </div>
  );
}

/* --- Sessions list -------------------------------------------------------- */

function SessionsList({
  sessions,
  loaded,
  selectedId,
  onSelect,
  onDelete,
}: {
  sessions: SessionSummary[];
  loaded: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void | Promise<void>;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null);

  if (sessions.length === 0) {
    return <p className="sessions-empty">{loaded ? "No recordings yet." : "Loading…"}</p>;
  }
  return (
    <ul className="sess-list">
      {sessions.map((s) =>
        confirmId === s.id ? (
          <li key={s.id}>
            <div className="sess-confirm" role="alertdialog" aria-label="Confirm delete">
              <div className="sess-confirm-text">
                <span className="sess-confirm-title">Delete this recording?</span>
                <span className="sess-confirm-sub">This cannot be undone.</span>
              </div>
              <div className="sess-confirm-actions">
                <button className="linky" onClick={() => setConfirmId(null)}>
                  Cancel
                </button>
                <button
                  className="danger"
                  onClick={() => {
                    setConfirmId(null);
                    void onDelete(s.id);
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          </li>
        ) : (
          <li key={s.id}>
            <div className="sess-row">
              <button
                className={`sess ${s.id === selectedId ? "on" : ""}`}
                onClick={() => onSelect(s.id)}
              >
                <div className="sess-top">
                  <span className="sess-when">{formatWhen(s.startedAt)}</span>
                  <span className="sess-tags">
                    {s.hasSkill && <span className="tag ok">skill</span>}
                    {s.hasAutomation && <span className="tag auto">automation</span>}
                    {!s.hasSkill && !s.hasAutomation && s.analysis && (
                      <span className="tag an">analyzed</span>
                    )}
                    {!s.hasSkill && !s.hasAutomation && !s.analysis && !s.processed && (
                      <span className="tag warn">processing</span>
                    )}
                    {!s.hasSkill && !s.hasAutomation && !s.analysis && s.processed && (
                      <span className="tag recorded">recorded</span>
                    )}
                  </span>
                </div>
                <div className="sess-intent">
                  {s.analysis
                    ? s.analysis.title?.trim() || shortLabel(s.analysis.intent)
                    : "Not analyzed yet"}
                </div>
                <div className="sess-sub">
                  {s.durationMs != null && <span>{formatDur(s.durationMs)}</span>}
                  {s.analysis && <span>{s.analysis.stepCount} steps</span>}
                  {s.hasVideo && <span>video</span>}
                </div>
              </button>
              <button
                className="sess-del"
                aria-label={`Delete recording from ${formatWhen(s.startedAt)}`}
                title="Delete recording"
                onClick={() => setConfirmId(s.id)}
              >
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path
                    d="M3 4.5h10M6.4 4.5V3.3c0-.44.36-.8.8-.8h1.6c.44 0 .8.36.8.8v1.2M4.7 4.5l.5 8.2c.02.42.37.75.8.75h4c.42 0 .77-.33.8-.75l.5-8.2"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </li>
        ),
      )}
    </ul>
  );
}

/* --- Analysis workspace --------------------------------------------------- */

const STEP_CHIPS = ["Not accurate", "Not needed"] as const;
const CHIP_NOTE: Record<(typeof STEP_CHIPS)[number], string> = {
  "Not accurate": "This isn't accurate.",
  "Not needed": "This step isn't needed.",
};

function AnalysisWorkspace({
  summary,
  onChanged,
}: {
  summary: SessionSummary;
  onChanged: () => void | Promise<void>;
}) {
  const sessionId = summary.id;

  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [statusLine, setStatusLine] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [overall, setOverall] = useState("");
  const [overallOpen, setOverallOpen] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftIntent, setDraftIntent] = useState("");
  // The final stage: pick a target, then build a skill or an automation. A recording
  // that is already exactly one kind opens straight to it; otherwise it opens to the
  // analysis, where "Create…" starts the target picker.
  const initialLaunch: LaunchTarget =
    summary.hasSkill && !summary.hasAutomation
      ? "skill"
      : summary.hasAutomation && !summary.hasSkill
        ? "automation"
        : "none";
  const [launch, setLaunch] = useState<LaunchTarget>(initialLaunch);
  const [chosenArch, setChosenArch] = useState<SkillArchitecture>("scout");
  // Set while the user is deliberately canceling, so the aborted run's rejection
  // doesn't surface as an error toast.
  const canceled = useRef(false);

  useEffect(() => {
    let live = true;
    void window.skillRecorder.getAnalysis(sessionId).then((a) => {
      if (live) setAnalysis(a);
    });
    return () => {
      live = false;
    };
  }, [sessionId]);

  // Single latest status line (no growing log).
  useEffect(() => {
    return window.skillRecorder.onAnalyzeProgress((p: AnalyzeProgress) => {
      if (p.sessionId !== sessionId) return;
      setStatusLine(p.message);
      if (p.phase === "done" || p.phase === "error") setAnalyzing(false);
    });
  }, [sessionId]);

  const run = useCallback(async () => {
    canceled.current = false;
    setAnalyzing(true);
    setError(null);
    setStatusLine("Starting…");
    const res = await window.skillRecorder.analyze(sessionId);
    if (res.ok && res.analysis) setAnalysis(res.analysis);
    else if (!canceled.current) setError(res.error ?? "Analysis failed");
    setAnalyzing(false);
    void onChanged();
  }, [sessionId, onChanged]);

  const cancel = useCallback(async () => {
    canceled.current = true;
    setStatusLine("Stopping…");
    await window.skillRecorder.cancelAnalysis(sessionId);
    setAnalyzing(false);
  }, [sessionId]);

  const hasFeedback =
    overall.trim().length > 0 || Object.values(notes).some((n) => n.trim().length > 0);

  const sendFeedback = useCallback(async () => {
    const steps = Object.entries(notes)
      .filter(([, note]) => note.trim())
      .map(([stepId, note]) => ({ stepId, note: note.trim() }));
    if (!overall.trim() && steps.length === 0) return;
    canceled.current = false;
    setAnalyzing(true);
    setError(null);
    setStatusLine("Re-analyzing with your feedback…");
    const res = await window.skillRecorder.analyzeFeedback({
      sessionId,
      overall: overall.trim() || undefined,
      steps,
    });
    if (res.ok && res.analysis) {
      setAnalysis(res.analysis);
      setOverall("");
      setOverallOpen(false);
      setNotes({});
    } else if (!canceled.current) {
      setError(res.error ?? "Re-analysis failed");
    }
    setAnalyzing(false);
    void onChanged();
  }, [notes, overall, sessionId, onChanged]);

  const startEdit = useCallback(() => {
    if (!analysis) return;
    setDraftTitle(analysis.title ?? "");
    setDraftIntent(analysis.intent);
    setError(null);
    setEditing(true);
  }, [analysis]);

  const saveEdit = useCallback(async () => {
    const res = await window.skillRecorder.updateAnalysis({
      sessionId,
      title: draftTitle.trim(),
      intent: draftIntent.trim() || undefined,
    });
    if (res.ok && res.analysis) {
      setAnalysis(res.analysis);
      setEditing(false);
    } else {
      setError(res.error ?? "Could not save your changes");
    }
    void onChanged();
  }, [sessionId, draftTitle, draftIntent, onChanged]);

  const setNote = useCallback((stepId: string, note: string) => {
    setNotes((prev) => ({ ...prev, [stepId]: note }));
  }, []);

  if (launch === "picker") {
    return (
      <TargetPicker
        startedAt={summary.startedAt}
        onPick={(t) => {
          setChosenArch(t.architecture);
          setLaunch(t.kind);
        }}
        onClose={() => setLaunch("none")}
      />
    );
  }

  if (launch === "skill") {
    return (
      <SkillBuilderView
        sessionId={sessionId}
        architecture={chosenArch}
        startedAt={summary.startedAt}
        hasSkill={summary.hasSkill}
        onClose={() => {
          setLaunch("none");
          void onChanged();
        }}
      />
    );
  }

  if (launch === "automation") {
    return (
      <AutomationBuilderView
        sessionId={sessionId}
        architecture={chosenArch}
        startedAt={summary.startedAt}
        hasAutomation={summary.hasAutomation}
        onClose={() => {
          setLaunch("none");
          void onChanged();
        }}
      />
    );
  }

  return (
    <section className="ws">
      <div className="ws-head">
        <div className="ws-titles">
          <span className="eyebrow">Analysis</span>
          <span className="ws-when">{formatWhen(summary.startedAt)}</span>
        </div>
        {analysis && !analyzing && (
          <button className="ghost" onClick={run} title="Analyze this recording again from scratch">
            Start over
          </button>
        )}
      </div>

      <div className="ws-body">
        {!summary.processed && (
          <p className="ws-note">Still processing this recording… try again in a moment.</p>
        )}

        {summary.processed && !analysis && !analyzing && (
          <div className="ws-empty">
            <p>See what you did in this recording, step by step.</p>
            <button className="record-cta" onClick={run}>
              Analyze recording
            </button>
          </div>
        )}

        {analyzing && (
          <div className="status-line">
            <span className="spinner" />
            <span className="status-text">{statusLine || "Working…"}</span>
            <button className="linky status-cancel" onClick={cancel}>
              Cancel
            </button>
          </div>
        )}

        {error && <div className="analysis-error">{error}</div>}

        {analysis && !analyzing && (
          <div className="ws-read">
            <div className="summary">
              <div className="summary-head">
                <span className="eyebrow">What you did</span>
                {!editing && (
                  <button className="linky" onClick={startEdit}>
                    Edit
                  </button>
                )}
              </div>

              {editing ? (
                <div className="summary-edit">
                  <label className="edit-field">
                    <span className="edit-label">Name</span>
                    <input
                      className="edit-title"
                      value={draftTitle}
                      placeholder="Short name, e.g. Research habit articles"
                      autoFocus
                      onChange={(e) => setDraftTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void saveEdit();
                        } else if (e.key === "Escape") setEditing(false);
                      }}
                    />
                    <span className="edit-hint">Appears in your sessions list</span>
                  </label>
                  <label className="edit-field">
                    <span className="edit-label">Goal</span>
                    <textarea
                      className="edit-intent"
                      value={draftIntent}
                      placeholder="One sentence: what were you trying to do?"
                      onChange={(e) => setDraftIntent(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setEditing(false);
                      }}
                    />
                  </label>
                  <div className="edit-actions">
                    <button className="linky" onClick={() => setEditing(false)}>
                      Cancel
                    </button>
                    <button className="secondary" onClick={() => void saveEdit()}>
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <h2 className="summary-text">{analysis.intent}</h2>
                  {analysis.intentRationale && (
                    <p className="summary-why">{analysis.intentRationale}</p>
                  )}
                </>
              )}
            </div>

            <ol className="story">
              {analysis.steps.map((s, i) => (
                <StepCard
                  key={s.id}
                  index={i}
                  step={s}
                  note={notes[s.id] ?? ""}
                  onNote={(v) => setNote(s.id, v)}
                />
              ))}
            </ol>

            <div className="overall-zone">
              {overallOpen || overall.trim() ? (
                <textarea
                  className="overall-fb"
                  placeholder="Tell us what's off, or describe a step we missed…"
                  value={overall}
                  onChange={(e) => setOverall(e.target.value)}
                />
              ) : (
                <button className="linky" onClick={() => setOverallOpen(true)}>
                  Something off, or did we miss a step?
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {analysis && !analyzing && (
        <div className="ws-foot">
          <span className="foot-status">{launchFootStatus(summary)}</span>
          <div className="ws-foot-actions">
            {hasFeedback && (
              <button className="secondary" onClick={sendFeedback}>
                Send feedback &amp; re-analyze
              </button>
            )}
            {summary.hasSkill && (
              <button className="secondary" onClick={() => setLaunch("skill")} title="Open the skill built from this recording">
                Open skill →
              </button>
            )}
            {summary.hasAutomation && (
              <button
                className="secondary"
                onClick={() => setLaunch("automation")}
                title="Open the automation built from this recording"
              >
                Open automation →
              </button>
            )}
            <button
              className="record-cta"
              onClick={() => setLaunch("picker")}
              disabled={hasFeedback}
              title={
                hasFeedback
                  ? "Send or clear your feedback first"
                  : "Turn this recording into a skill or an automation"
              }
            >
              {summary.hasSkill || summary.hasAutomation ? "Create another →" : "Create…"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/* --- Final stage: target picker + builders -------------------------------- */

/** Which final-stage surface the analysis workspace is showing. */
type LaunchTarget = "none" | "picker" | "skill" | "automation";

function launchFootStatus(summary: SessionSummary): string {
  if (summary.hasSkill && summary.hasAutomation) return "Skill & automation created";
  if (summary.hasSkill) return "Skill created";
  if (summary.hasAutomation) return "Automation created";
  return "";
}

/** "What do you want to build?" — picks both kind and architecture up front. */
function TargetPicker({
  startedAt,
  onPick,
  onClose,
}: {
  startedAt: number | null;
  onPick: (target: BuildTarget) => void;
  onClose: () => void;
}) {
  return (
    <section className="ws">
      <div className="ws-head">
        <div className="ws-titles">
          <span className="eyebrow">Create</span>
          <span className="ws-when">{formatWhen(startedAt)}</span>
        </div>
        <button className="ghost" onClick={onClose} title="Back to the analysis">
          Close
        </button>
      </div>
      <div className="ws-body">
        <div className="sb-arch">
          <p className="sb-lead">What do you want to build from this recording?</p>
          <div className="arch-grid">
            {TARGETS.map((t) => (
              <button
                key={`${t.kind}:${t.architecture}`}
                className="arch-card"
                disabled={!t.enabled}
                onClick={() => t.enabled && onPick(t)}
              >
                <span className="arch-name">{t.label}</span>
                <span className="arch-note">{t.enabled ? t.note : "Coming soon"}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* --- Skill builder ------------------------------------------------------- */

type BuildPhase = "loading" | "ready" | "planning" | "plan" | "creating" | "done";

const SOURCE_LABEL: Record<SkillPlan["inputs"][number]["source"], string> = {
  ask: "You provide it",
  discover: "Found on this device",
  constant: "Fixed value",
};

function SkillBuilderView({
  sessionId,
  architecture: initialArch,
  startedAt,
  hasSkill,
  onClose,
}: {
  sessionId: string;
  architecture: SkillArchitecture;
  startedAt: number | null;
  hasSkill: boolean;
  onClose: () => void;
}) {
  // If this recording is already a skill, hold on a spinner until we've loaded it,
  // so we never flash the planning state before jumping to the skill.
  const [phase, setPhase] = useState<BuildPhase>(hasSkill ? "loading" : "ready");
  const [architecture, setArchitecture] = useState<SkillArchitecture>(initialArch);
  const [plan, setPlan] = useState<SkillPlan | null>(null);
  const [statusLine, setStatusLine] = useState("");
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [exportedPath, setExportedPath] = useState("");
  const [builtName, setBuiltName] = useState("");
  const canceled = useRef(false);
  const inFlight = useRef(false);

  // Leaving the builder (session switch or Close) discards an in-progress plan —
  // we don't save drafts — so stop any run that's still going in the background.
  useEffect(() => {
    return () => {
      if (inFlight.current) void window.skillRecorder.cancelSkill(sessionId);
    };
  }, [sessionId]);

  // Reopen straight to the exported state if this recording already has a skill.
  useEffect(() => {
    let live = true;
    void window.skillRecorder.getSkill(sessionId).then((s: BuiltSkill | null) => {
      if (!live) return;
      if (s?.exportedPath) {
        setBuiltName(s.name);
        setExportedPath(s.exportedPath);
        setArchitecture(s.architecture);
        if (s.plan) setPlan(s.plan);
        setPhase("done");
      } else if (hasSkill) {
        // We expected a skill but couldn't load it; fall back to the ready screen.
        setPhase("ready");
      }
    });
    return () => {
      live = false;
    };
  }, [sessionId, hasSkill]);

  useEffect(() => {
    return window.skillRecorder.onSkillProgress((p: SkillBuildProgress) => {
      if (p.sessionId === sessionId) setStatusLine(p.message);
    });
  }, [sessionId]);

  const runPlan = useCallback(
    async (note?: string) => {
      canceled.current = false;
      inFlight.current = true;
      setError(null);
      setStatusLine(note ? "Refining the plan…" : "Planning the skill…");
      setPhase("planning");
      const res = await window.skillRecorder.buildSkill({ sessionId, architecture, feedback: note });
      inFlight.current = false;
      if (res.ok && res.plan) {
        setPlan(res.plan);
        setFeedback("");
        setPhase("plan");
      } else if (!canceled.current) {
        setError(res.error ?? "Planning failed");
        setPhase(note ? "plan" : "ready");
      }
    },
    [sessionId, architecture],
  );

  const create = useCallback(async () => {
    canceled.current = false;
    inFlight.current = true;
    setError(null);
    setStatusLine("Writing the skill…");
    setPhase("creating");
    const res = await window.skillRecorder.createSkill(sessionId);
    inFlight.current = false;
    if (res.ok && res.skill) {
      setBuiltName(res.skill.name);
      setExportedPath(res.path ?? res.skill.exportedPath ?? "");
      setPhase("done");
    } else if (!canceled.current) {
      setError(res.error ?? "Could not create the skill");
      setPhase("plan");
    }
  }, [sessionId]);

  const cancelRun = useCallback(async () => {
    canceled.current = true;
    inFlight.current = false;
    setStatusLine("Stopping…");
    await window.skillRecorder.cancelSkill(sessionId);
    setPhase(plan ? "plan" : "ready");
  }, [sessionId, plan]);

  const busy = phase === "planning" || phase === "creating";

  return (
    <section className="ws">
      <div className="ws-head">
        <div className="ws-titles">
          <span className="eyebrow">{phase === "done" ? "Skill" : "Create skill"}</span>
          <span className="ws-when">{formatWhen(startedAt)}</span>
        </div>
        <button
          className="ghost"
          onClick={onClose}
          disabled={busy}
          title={phase === "done" ? "View this recording's analysis" : "Back to the analysis"}
        >
          {phase === "done" ? "Analysis" : "Close"}
        </button>
      </div>

      <div className="ws-body">
        {error && <div className="analysis-error">{error}</div>}

        {phase === "loading" && (
          <div className="status-line">
            <span className="spinner" />
            <span className="status-text">Opening the skill…</span>
          </div>
        )}

        {phase === "ready" && (
          <div className="sb-arch">
            <p className="sb-lead">Build a {archLabel(architecture)} skill from this recording.</p>
            <button className="record-cta" onClick={() => void runPlan()}>
              Plan the skill →
            </button>
          </div>
        )}

        {busy && (
          <div className="status-line">
            <span className="spinner" />
            <span className="status-text">{statusLine || "Working…"}</span>
            <button className="linky status-cancel" onClick={cancelRun}>
              Cancel
            </button>
          </div>
        )}

        {phase === "plan" && plan && (
          <div className="sb-plan">
            <div className="sb-planhead">
              <h2 className="sb-title">{plan.title}</h2>
              <code className="sb-slug">{plan.name}</code>
            </div>
            <p className="sb-desc">{plan.description}</p>

            {(plan.summary || plan.generalization) && (
              <div className="sb-sec">
                <span className="eyebrow">How it generalizes</span>
                {plan.summary && <p>{plan.summary}</p>}
                {plan.generalization && <p className="sb-muted">{plan.generalization}</p>}
              </div>
            )}

            {plan.inputs.length > 0 && (
              <div className="sb-sec">
                <span className="eyebrow">Inputs</span>
                <ul className="sb-inputs">
                  {plan.inputs.map((inp, i) => (
                    <li key={i} className="input-row">
                      <div className="input-main">
                        <span className="input-name">{inp.name}</span>
                        <span className={`src-badge src-${inp.source}`}>{SOURCE_LABEL[inp.source]}</span>
                      </div>
                      {(inp.detail || inp.description) && (
                        <span className="input-detail">{inp.detail || inp.description}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {plan.steps.length > 0 && (
              <div className="sb-sec">
                <span className="eyebrow">What the skill will do</span>
                <ol className="sb-steps">
                  {plan.steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              </div>
            )}

            {plan.toolMapping.length > 0 && (
              <div className="sb-sec">
                <span className="eyebrow">Native tools it will use</span>
                <ul className="sb-map">
                  {plan.toolMapping.map((m, i) => (
                    <li key={i} className="map-row">
                      <span className="map-action">{m.action}</span>
                      <span className="map-arrow" aria-hidden>
                        →
                      </span>
                      <code className="map-tool">{m.tool}</code>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="sb-sec sb-refine">
              <span className="eyebrow">Adjust the plan</span>
              <p className="sb-refine-hint">
                Describe any change in plain language, then Refine to re-plan before you export.
              </p>
              <textarea
                className="overall-fb"
                placeholder="e.g. 'read the spreadsheet from Downloads instead of asking', or 'also fill in the Phone field'…"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
              />
            </div>
          </div>
        )}

        {phase === "done" && (
          <div className="sb-done">
            <div className="sb-check" aria-hidden>
              ✓
            </div>
            <h2 className="sb-title">Skill ready</h2>
            <p>
              <code className="sb-slug">{builtName}</code> is built for {archLabel(architecture)}.
            </p>
            {exportedPath && <p className="sb-path">{exportedPath}</p>}
          </div>
        )}
      </div>

      {phase === "plan" && plan && (
        <div className="ws-foot">
          <span className="foot-status" />
          <div className="ws-foot-actions">
            <button
              className="secondary"
              onClick={() => void runPlan(feedback.trim())}
              disabled={!feedback.trim()}
              title={feedback.trim() ? "Apply your changes and re-plan" : "Type a change above to refine"}
            >
              Refine plan
            </button>
            <button
              className="record-cta"
              onClick={() => void create()}
              title="Create and export the skill"
            >
              Create &amp; export skill
            </button>
          </div>
        </div>
      )}

      {phase === "done" && (
        <div className="ws-foot">
          <span className="foot-status">Skill created</span>
          <div className="ws-foot-actions">
            {exportedPath && (
              <button className="record-cta" onClick={() => void window.skillRecorder.revealSkill(sessionId)}>
                Reveal file
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function archLabel(id: SkillArchitecture): string {
  return ARCHITECTURES.find((a) => a.id === id)?.label ?? id;
}

/* --- Automation builder --------------------------------------------------- */

function AutomationBuilderView({
  sessionId,
  architecture: initialArch,
  startedAt,
  hasAutomation,
  onClose,
}: {
  sessionId: string;
  architecture: SkillArchitecture;
  startedAt: number | null;
  hasAutomation: boolean;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<BuildPhase>(hasAutomation ? "loading" : "ready");
  const [architecture, setArchitecture] = useState<SkillArchitecture>(initialArch);
  const [plan, setPlan] = useState<AutomationPlan | null>(null);
  const [statusLine, setStatusLine] = useState("");
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [exportedPath, setExportedPath] = useState("");
  const [builtName, setBuiltName] = useState("");
  const canceled = useRef(false);
  const inFlight = useRef(false);

  useEffect(() => {
    return () => {
      if (inFlight.current) void window.skillRecorder.cancelAutomation(sessionId);
    };
  }, [sessionId]);

  // Reopen straight to the exported state if this recording already has one.
  useEffect(() => {
    let live = true;
    void window.skillRecorder.getAutomation(sessionId).then((a: BuiltAutomation | null) => {
      if (!live) return;
      if (a?.exportedPath) {
        setBuiltName(a.name);
        setExportedPath(a.exportedPath);
        setArchitecture(a.architecture);
        if (a.plan) setPlan(a.plan);
        setPhase("done");
      } else if (hasAutomation) {
        setPhase("ready");
      }
    });
    return () => {
      live = false;
    };
  }, [sessionId, hasAutomation]);

  useEffect(() => {
    return window.skillRecorder.onAutomationProgress((p: AutomationBuildProgress) => {
      if (p.sessionId === sessionId) setStatusLine(p.message);
    });
  }, [sessionId]);

  const runPlan = useCallback(
    async (note?: string) => {
      canceled.current = false;
      inFlight.current = true;
      setError(null);
      setStatusLine(note ? "Refining the plan…" : "Planning the automation…");
      setPhase("planning");
      const res = await window.skillRecorder.buildAutomation({ sessionId, architecture, feedback: note });
      inFlight.current = false;
      if (res.ok && res.plan) {
        setPlan(res.plan);
        setFeedback("");
        setPhase("plan");
      } else if (!canceled.current) {
        setError(res.error ?? "Planning failed");
        setPhase(note ? "plan" : "ready");
      }
    },
    [sessionId, architecture],
  );

  const create = useCallback(async () => {
    canceled.current = false;
    inFlight.current = true;
    setError(null);
    setStatusLine("Writing the automation…");
    setPhase("creating");
    const res = await window.skillRecorder.createAutomation(sessionId);
    inFlight.current = false;
    if (res.ok && res.automation) {
      setBuiltName(res.automation.name);
      setExportedPath(res.path ?? res.automation.exportedPath ?? "");
      setPhase("done");
    } else if (!canceled.current) {
      setError(res.error ?? "Could not create the automation");
      setPhase("plan");
    }
  }, [sessionId]);

  const cancelRun = useCallback(async () => {
    canceled.current = true;
    inFlight.current = false;
    setStatusLine("Stopping…");
    await window.skillRecorder.cancelAutomation(sessionId);
    setPhase(plan ? "plan" : "ready");
  }, [sessionId, plan]);

  const busy = phase === "planning" || phase === "creating";

  return (
    <section className="ws">
      <div className="ws-head">
        <div className="ws-titles">
          <span className="eyebrow">{phase === "done" ? "Automation" : "Create automation"}</span>
          <span className="ws-when">{formatWhen(startedAt)}</span>
        </div>
        <button
          className="ghost"
          onClick={onClose}
          disabled={busy}
          title={phase === "done" ? "View this recording's analysis" : "Back to the analysis"}
        >
          {phase === "done" ? "Analysis" : "Close"}
        </button>
      </div>

      <div className="ws-body">
        {error && <div className="analysis-error">{error}</div>}

        {phase === "loading" && (
          <div className="status-line">
            <span className="spinner" />
            <span className="status-text">Opening the automation…</span>
          </div>
        )}

        {phase === "ready" && (
          <div className="sb-arch">
            <p className="sb-lead">Build a {archLabel(architecture)} automation from this recording.</p>
            <button className="record-cta" onClick={() => void runPlan()}>
              Plan the automation →
            </button>
          </div>
        )}

        {busy && (
          <div className="status-line">
            <span className="spinner" />
            <span className="status-text">{statusLine || "Working…"}</span>
            <button className="linky status-cancel" onClick={cancelRun}>
              Cancel
            </button>
          </div>
        )}

        {phase === "plan" && plan && (
          <div className="sb-plan">
            <div className="sb-planhead">
              <h2 className="sb-title">{plan.title}</h2>
              <code className="sb-slug">{plan.name}</code>
            </div>
            <p className="sb-desc">{plan.description}</p>

            <div className="sb-sec">
              <span className="eyebrow">When it runs</span>
              <div className="sb-trigger">
                <span className="trigger-when">{describeSchedule(plan.trigger.schedule)}</span>
                {plan.trigger.type === "condition" && plan.trigger.condition && (
                  <span className="trigger-cond">Only when: {plan.trigger.condition}</span>
                )}
              </div>
              <p className="sb-refine-hint">
                A recording has no schedule of its own — this is a suggestion. Say e.g. “every
                weekday at 8am” below to change it.
              </p>
            </div>

            {(plan.summary || plan.generalization) && (
              <div className="sb-sec">
                <span className="eyebrow">How it generalizes</span>
                {plan.summary && <p>{plan.summary}</p>}
                {plan.generalization && <p className="sb-muted">{plan.generalization}</p>}
              </div>
            )}

            {plan.inputs.length > 0 && (
              <div className="sb-sec">
                <span className="eyebrow">Inputs</span>
                <ul className="sb-inputs">
                  {plan.inputs.map((inp, i) => (
                    <li key={i} className="input-row">
                      <div className="input-main">
                        <span className="input-name">{inp.name}</span>
                        <span className={`src-badge src-${inp.source}`}>{SOURCE_LABEL[inp.source]}</span>
                      </div>
                      {(inp.detail || inp.description) && (
                        <span className="input-detail">{inp.detail || inp.description}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {plan.steps.length > 0 && (
              <div className="sb-sec">
                <span className="eyebrow">What the automation will do</span>
                <ol className="sb-steps">
                  {plan.steps.map((s, i) => (
                    <li key={i}>
                      {s.label && <span className="sb-step-label">{s.label}</span>}
                      <span className="sb-step-prompt">{s.prompt}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            <div className="sb-sec sb-refine">
              <span className="eyebrow">Adjust the plan</span>
              <p className="sb-refine-hint">
                Describe any change in plain language — the schedule, the steps, anything — then
                Refine to re-plan before you export.
              </p>
              <textarea
                className="overall-fb"
                placeholder="e.g. 'run every weekday at 8am', or 'add a step that emails me the summary'…"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
              />
            </div>
          </div>
        )}

        {phase === "done" && (
          <div className="sb-done">
            <div className="sb-check" aria-hidden>
              ✓
            </div>
            <h2 className="sb-title">Automation ready</h2>
            <p>
              <code className="sb-slug">{builtName}</code> is built for {archLabel(architecture)}.
            </p>
            {exportedPath && <p className="sb-path">{exportedPath}</p>}
            <p className="sb-import-hint">
              Import it into Scout: open Scout → Automations → Import, and choose this bundle folder.
            </p>
          </div>
        )}
      </div>

      {phase === "plan" && plan && (
        <div className="ws-foot">
          <span className="foot-status" />
          <div className="ws-foot-actions">
            <button
              className="secondary"
              onClick={() => void runPlan(feedback.trim())}
              disabled={!feedback.trim()}
              title={feedback.trim() ? "Apply your changes and re-plan" : "Type a change above to refine"}
            >
              Refine plan
            </button>
            <button
              className="record-cta"
              onClick={() => void create()}
              title="Create and export the automation bundle"
            >
              Create &amp; export automation
            </button>
          </div>
        </div>
      )}

      {phase === "done" && (
        <div className="ws-foot">
          <span className="foot-status">Automation created</span>
          <div className="ws-foot-actions">
            {exportedPath && (
              <button
                className="record-cta"
                onClick={() => void window.skillRecorder.revealAutomation(sessionId)}
              >
                Reveal bundle
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/* --- One step, told as plain language ------------------------------------- */

function StepCard({
  index,
  step,
  note,
  onNote,
}: {
  index: number;
  step: Analysis["steps"][number];
  note: string;
  onNote: (value: string) => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const [commenting, setCommenting] = useState(false);
  const open = commenting || note.trim().length > 0;
  const hasMeta = step.apps.length > 0 || step.startMs != null || step.evidence.length > 0;

  return (
    <li className="story-step">
      <div className="sstep-num">{index + 1}</div>
      <div className="sstep-body">
        <div className="sstep-title">{step.title}</div>
        <p className="sstep-detail">{step.detail}</p>

        {step.confidence === "low" && (
          <div className="sstep-flag">We&apos;re not fully sure about this one. Worth a check.</div>
        )}

        <div className="sstep-tools">
          {hasMeta && (
            <button className="linky" onClick={() => setShowDetails((v) => !v)}>
              {showDetails ? "Hide details" : "Details"}
            </button>
          )}
          <button className="linky" onClick={() => setCommenting((v) => !v)}>
            {open ? "Done" : "Suggest a change"}
          </button>
        </div>

        {showDetails && hasMeta && (
          <div className="sstep-details">
            {step.apps.length > 0 && (
              <div className="drow">
                <span className="dkey">App</span>
                <span>{step.apps.join(", ")}</span>
              </div>
            )}
            {step.startMs != null && (
              <div className="drow">
                <span className="dkey">At</span>
                <span>{formatMs(step.startMs)}</span>
              </div>
            )}
            {step.evidence.length > 0 && (
              <div className="drow">
                <span className="dkey">Signals</span>
                <span className="dsignals">
                  {step.evidence.map((e, i) => (
                    <span className="sig" key={i}>
                      {e}
                    </span>
                  ))}
                </span>
              </div>
            )}
          </div>
        )}

        {open && (
          <div className="sstep-fb">
            <div className="fb-chips">
              {STEP_CHIPS.map((c) => (
                <button key={c} className="fb-chip" onClick={() => onNote(CHIP_NOTE[c])}>
                  {c}
                </button>
              ))}
            </div>
            <input
              className="fb-input"
              placeholder="What should this say instead?"
              value={note}
              onChange={(e) => onNote(e.target.value)}
            />
          </div>
        )}
      </div>
    </li>
  );
}
