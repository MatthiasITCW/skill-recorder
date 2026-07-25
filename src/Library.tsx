import { useCallback, useEffect, useRef, useState } from "react";

import type { Analysis } from "../common/analysis";
import type { AnalyzeProgress, SessionSummary } from "../common/ipc";
import { formatDur, formatMs, formatWhen } from "./format";

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
                  {s.analysis?.approved ? (
                    <span className="tag ok">approved</span>
                  ) : s.analysis ? (
                    <span className="tag an">analyzed</span>
                  ) : !s.processed ? (
                    <span className="tag warn">processing</span>
                  ) : null}
                </div>
                <div className="sess-intent">
                  {s.analysis?.title?.trim() || s.analysis?.intent || "Not analyzed yet"}
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

  const approve = useCallback(async () => {
    const res = await window.skillRecorder.approveAnalysis(sessionId);
    if (res.ok && res.analysis) setAnalysis(res.analysis);
    else setError(res.error ?? "Could not save");
    void onChanged();
  }, [sessionId, onChanged]);

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

  const approved = analysis?.approved ?? false;

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
                  <h2 className="summary-text">{analysis.title?.trim() || analysis.intent}</h2>
                  {analysis.title?.trim() && (
                    <p className="summary-goal">{analysis.intent}</p>
                  )}
                  {analysis.intentRationale && (
                    <p className="summary-why">{analysis.intentRationale}</p>
                  )}
                  {approved && <span className="tag ok">approved</span>}
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
          <span className="foot-status">{approved ? "Saved" : ""}</span>
          <div className="ws-foot-actions">
            {hasFeedback && (
              <button className="secondary" onClick={sendFeedback}>
                Send feedback &amp; re-analyze
              </button>
            )}
            {approved ? (
              <button className="record-cta" disabled title="Skill generation is the next milestone">
                Create skill →
              </button>
            ) : (
              <button
                className="record-cta"
                onClick={approve}
                disabled={hasFeedback}
                title={hasFeedback ? "Send or clear your feedback first" : "Save as correct"}
              >
                Looks good, save
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
