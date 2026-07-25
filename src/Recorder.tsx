import { useCallback, useEffect, useState } from "react";

import type { DoctorReport, RecorderStatus } from "../common/ipc";
import { formatMs } from "./format";
import { WhatsRecorded } from "./WhatsRecorded";

const IS_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
/** Mirrors the main-process global shortcut "CommandOrControl+Shift+R", per OS. */
const TOGGLE_SHORTCUT = IS_MAC ? "⌘⇧R" : "Ctrl+Shift+R";

export function Recorder() {
  const [status, setStatus] = useState<RecorderStatus | null>(null);
  const [doctor, setDoctor] = useState<DoctorReport | null>(null);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [sessionCount, setSessionCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);

  const refreshCount = useCallback(async () => {
    const list = await window.skillRecorder.listSessions();
    setSessionCount(list.length);
    setPendingCount(list.filter((s) => !s.analysis).length);
  }, []);

  useEffect(() => {
    void window.skillRecorder.status().then(setStatus);
    void window.skillRecorder.doctor().then(setDoctor);
    void refreshCount();
    return window.skillRecorder.onStatusChanged(setStatus);
  }, [refreshCount]);

  // The analyze step happens in the library window, so re-check how many
  // recordings still need analysis whenever the recorder regains focus.
  useEffect(() => {
    const onFocus = () => void refreshCount();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshCount]);

  const recording = status?.state === "recording";
  const startedAt = status?.startedAt ?? null;
  const justSaved = !recording && status?.lastSession != null;

  // Refresh the library count whenever a recording finishes.
  useEffect(() => {
    if (!recording) void refreshCount();
  }, [recording, refreshCount]);

  useEffect(() => {
    if (!recording || startedAt == null) {
      setElapsed(0);
      return;
    }
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 500);
    return () => clearInterval(id);
  }, [recording, startedAt]);

  const toggle = useCallback(async () => {
    const res = recording ? await window.skillRecorder.stop() : await window.skillRecorder.start();
    if (!res.ok) window.alert(res.error ?? "Action failed");
    setStatus(await window.skillRecorder.status());
  }, [recording]);

  const addMarker = useCallback(async () => {
    const note = window.prompt("Marker: what are you doing right now?");
    if (note) await window.skillRecorder.marker(note);
  }, []);

  const openLibrary = useCallback(() => {
    void window.skillRecorder.openLibrary();
  }, []);

  return (
    <div className="hud">
      <header className="hud-head">
        <div className="wordmark">
          <span className="mark-lamp" />
          <span className="mark-text">Skill Recorder</span>
        </div>
        <span className={`rec-chip ${recording ? "rec" : "idle"}`}>
          <span className="lamp" />
          {recording ? "REC" : "READY"}
        </span>
      </header>

      <div className="transport">
        <button
          className={`record ${recording ? "on" : ""}`}
          onClick={toggle}
          aria-label={recording ? "Stop recording" : "Start recording"}
        >
          <span className="record-glyph" />
        </button>
        <div className={`timecode ${recording ? "live" : ""}`}>
          {recording ? formatMs(elapsed) : "00:00"}
        </div>
        <div className="transport-sub">
          {recording
            ? `${status?.eventCount ?? 0} events captured`
            : justSaved
              ? "Capture saved. Open Sessions to analyze"
              : "Ready to capture"}
        </div>
      </div>

      <button className="marker" onClick={addMarker} disabled={!recording}>
        Add marker
      </button>

      <button className="privacy-note" onClick={() => setShowPrivacy(true)}>
        <span className="privacy-note-icon" aria-hidden>
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
            <path
              d="M10 2.5 4 4.8v4.3c0 3.4 2.4 6.2 6 7.4 3.6-1.2 6-4 6-7.4V4.8L10 2.5Z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <path
              d="m7.4 9.8 1.9 1.9 3.4-3.6"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="privacy-note-text">
          <span className="privacy-note-title">Records your screen and activity</span>
          <span className="privacy-note-sub">See exactly what's captured</span>
        </span>
        <span className="privacy-note-chevron" aria-hidden>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M6 4l4 4-4 4"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      <button
        className={`sessions-open ${pendingCount > 0 ? "has-new" : ""}`}
        onClick={openLibrary}
        aria-label={
          pendingCount > 0
            ? `Review sessions, ${pendingCount} ready to analyze`
            : sessionCount === 0
              ? "Review sessions, nothing recorded yet"
              : `Review sessions, ${sessionCount} recorded`
        }
      >
        <span className="sessions-open-icon" aria-hidden>
          <svg width="19" height="19" viewBox="0 0 20 20" fill="none">
            <path
              d="M10 2.6 3.2 6 10 9.4 16.8 6 10 2.6Z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <path
              d="M3.4 10 10 13.3 16.6 10"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M3.4 13.6 10 16.9 16.6 13.6"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="sessions-open-text">
          <span className="sessions-open-label">
            Review sessions
            {pendingCount > 0 && <span className="sessions-open-flag">{pendingCount}</span>}
          </span>
          <span className={`sessions-open-sub ${pendingCount > 0 ? "is-new" : ""}`}>
            {pendingCount > 0
              ? `${pendingCount} ready to analyze`
              : sessionCount === 0
                ? "No recordings yet"
                : `${sessionCount} recording${sessionCount === 1 ? "" : "s"}`}
          </span>
        </span>
        <span className="sessions-open-chevron" aria-hidden>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M6 4l4 4-4 4"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      {doctor && (
        <div className="doctor">
          <Row
            label="window tracking"
            ok={doctor.activeWindow.ok}
            note={doctor.activeWindow.ok ? "native" : "addon missing"}
          />
          {doctor.activeSources.some((s) => s.key === "browserUrls") && (
            <Row
              label="browser URLs"
              ok={doctor.browserUrl.supported}
              note={doctor.browserUrl.supported ? doctor.browserUrl.kind : "not on this OS"}
            />
          )}
          <Row
            label="ffmpeg"
            ok={doctor.ffmpeg.ok}
            note={doctor.ffmpeg.ok ? doctor.ffmpeg.source : "missing"}
          />
          <Row label="copilot CLI" ok={doctor.copilotCli.ok} note={doctor.copilotCli.ok ? "found" : "missing"} />
        </div>
      )}

      <p className="hint">{TOGGLE_SHORTCUT} toggles from anywhere</p>

      {showPrivacy && <WhatsRecorded onClose={() => setShowPrivacy(false)} />}
    </div>
  );
}

function Row({ label, ok, note }: { label: string; ok: boolean; note: string }) {
  return (
    <div className="row">
      <span className={`badge ${ok ? "good" : "bad"}`}>{ok ? "✓" : "✕"}</span>
      <span className="row-label">{label}</span>
      <span className="row-note">{note}</span>
    </div>
  );
}
