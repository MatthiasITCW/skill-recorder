import { useCallback, useEffect, useState } from "react";

import { CAPTURE_LEVEL_INFO, type CaptureLevel } from "../common/config";
import type { CaptureState, DoctorReport, RecorderStatus } from "../common/ipc";

export function App() {
  const [status, setStatus] = useState<RecorderStatus | null>(null);
  const [doctor, setDoctor] = useState<DoctorReport | null>(null);
  const [capture, setCapture] = useState<CaptureState | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    void window.skillRecorder.status().then(setStatus);
    void window.skillRecorder.doctor().then(setDoctor);
    void window.skillRecorder.getCapture().then(setCapture);
    return window.skillRecorder.onStatusChanged(setStatus);
  }, []);

  const recording = status?.state === "recording";
  const startedAt = status?.startedAt ?? null;

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
    // Active-source list depends on the level, so refresh the doctor report too.
    setDoctor(await window.skillRecorder.doctor());
  }, []);

  return (
    <div className="app">
      <header>
        <h1>Skill Recorder</h1>
        <div className={`status ${recording ? "rec" : "idle"}`}>
          <span className="dot" />
          {recording ? "Recording" : "Idle"}
          {recording && <span className="timer">{formatMs(elapsed)}</span>}
        </div>
      </header>

      <button className={`primary ${recording ? "stop" : "start"}`} onClick={toggle}>
        {recording ? "Stop" : "Start"}
      </button>
      <button className="secondary" onClick={addMarker} disabled={!recording}>
        Add marker
      </button>

      <p className="meta">
        {status?.sessionId
          ? `${status.sessionId} · ${status.eventCount} events`
          : "No active session"}
      </p>

      {capture && (
        <CapturePicker
          level={capture.level}
          disabled={recording}
          onChoose={chooseLevel}
        />
      )}

      {doctor && (
        <div className="doctor">
          <Row label="ffmpeg" ok={doctor.ffmpeg.ok} note={doctor.ffmpeg.ok ? doctor.ffmpeg.source : "missing"} />
          <Row label="copilot CLI" ok={doctor.copilotCli.ok} note={doctor.copilotCli.ok ? "found" : "missing"} />
        </div>
      )}

      <p className="hint">Global toggle: ⌘/Ctrl + Shift + R</p>
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
        <span className="capture-title">Capture level</span>
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
      <p className="capture-blurb">
        {active?.blurb ?? "A custom mix of sources is active."}
      </p>
      {disabled && <p className="capture-note">Stop recording to change the level.</p>}
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

function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
