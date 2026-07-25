import { useCallback, useEffect, useState } from "react";

import { CAPTURE_LEVEL_INFO, type CaptureLevel } from "../common/config";
import type { CaptureState, DoctorReport, RecorderStatus } from "../common/ipc";
import { formatMs } from "./format";

const IS_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
/** Mirrors the main-process global shortcut "CommandOrControl+Shift+R", per OS. */
const TOGGLE_SHORTCUT = IS_MAC ? "⌘⇧R" : "Ctrl+Shift+R";

export function Recorder() {
  const [status, setStatus] = useState<RecorderStatus | null>(null);
  const [doctor, setDoctor] = useState<DoctorReport | null>(null);
  const [capture, setCapture] = useState<CaptureState | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [sessionCount, setSessionCount] = useState(0);

  const refreshCount = useCallback(async () => {
    const list = await window.skillRecorder.listSessions();
    setSessionCount(list.length);
  }, []);

  useEffect(() => {
    void window.skillRecorder.status().then(setStatus);
    void window.skillRecorder.doctor().then(setDoctor);
    void window.skillRecorder.getCapture().then(setCapture);
    void refreshCount();
    return window.skillRecorder.onStatusChanged(setStatus);
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
    const note = window.prompt("Marker — what are you doing right now?");
    if (note) await window.skillRecorder.marker(note);
  }, []);

  const chooseLevel = useCallback(async (level: Exclude<CaptureLevel, "custom">) => {
    const next = await window.skillRecorder.setLevel(level);
    setCapture(next);
    setDoctor(await window.skillRecorder.doctor());
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
              ? "Capture saved — open Sessions to review"
              : "Ready to capture"}
        </div>
      </div>

      <button className="marker" onClick={addMarker} disabled={!recording}>
        Add marker
      </button>

      {capture && (
        <CapturePicker level={capture.level} disabled={recording} onChoose={chooseLevel} />
      )}

      <button className="sessions-open" onClick={openLibrary}>
        <span className="sessions-open-label">Sessions</span>
        <span className="sessions-open-right">
          <span className="pill">{sessionCount}</span>
          <span className="ext" aria-hidden>
            ↗
          </span>
        </span>
      </button>

      {doctor && (
        <div className="doctor">
          <Row
            label="ffmpeg"
            ok={doctor.ffmpeg.ok}
            note={doctor.ffmpeg.ok ? doctor.ffmpeg.source : "missing"}
          />
          <Row label="copilot CLI" ok={doctor.copilotCli.ok} note={doctor.copilotCli.ok ? "found" : "missing"} />
        </div>
      )}

      <p className="hint">{TOGGLE_SHORTCUT} toggles from anywhere</p>
    </div>
  );
}

function CapturePicker({
  level,
  disabled,
  onChoose,
}: {
  level: CaptureLevel;
  disabled: boolean;
  onChoose: (level: Exclude<CaptureLevel, "custom">) => void;
}) {
  const active = CAPTURE_LEVEL_INFO.find((l) => l.level === level);
  return (
    <div className="capture">
      <div className="capture-head">
        <span className="eyebrow">Capture</span>
        {level === "custom" && <span className="capture-custom">custom</span>}
      </div>
      <div className="segmented" role="group" aria-label="Capture level">
        {CAPTURE_LEVEL_INFO.map((info) => (
          <button
            key={info.level}
            className={`seg ${level === info.level ? "on" : ""}`}
            aria-pressed={level === info.level}
            disabled={disabled}
            onClick={() => onChoose(info.level)}
          >
            {info.label}
          </button>
        ))}
      </div>
      <p className="capture-blurb">{active?.blurb ?? "A custom mix of sources is active."}</p>
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
