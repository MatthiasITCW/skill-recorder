import { useCallback, useEffect, useState } from "react";

import type {
  DoctorReport,
  MicrophoneSettingsStatus,
  NarrationStatus,
  RecorderStatus,
} from "../common/ipc";
import { formatMs } from "./format";
import { WhatsRecorded } from "./WhatsRecorded";

const IS_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
/** Mirrors the main-process global shortcut "CommandOrControl+Shift+R", per OS. */
const TOGGLE_SHORTCUT = IS_MAC ? "⌘⇧R" : "Ctrl+Shift+R";

export function Recorder() {
  const [status, setStatus] = useState<RecorderStatus | null>(null);
  const [doctor, setDoctor] = useState<DoctorReport | null>(null);
  const [narrationStatus, setNarrationStatus] = useState<NarrationStatus | null>(null);
  const [microphoneSettings, setMicrophoneSettings] =
    useState<MicrophoneSettingsStatus | null>(null);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [microphonePending, setMicrophonePending] = useState(false);
  const [microphoneActionError, setMicrophoneActionError] = useState<string | null>(null);
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
    void window.skillRecorder.narrationStatus().then(setNarrationStatus);
    void window.skillRecorder.microphoneSettings().then(setMicrophoneSettings);
    void refreshCount();
    const offRecorder = window.skillRecorder.onStatusChanged(setStatus);
    const offNarration = window.skillRecorder.onNarrationStatusChanged(setNarrationStatus);
    const offMicrophones =
      window.skillRecorder.onMicrophoneSettingsChanged(setMicrophoneSettings);
    return () => {
      offRecorder();
      offNarration();
      offMicrophones();
    };
  }, [refreshCount]);

  // The analyze step happens in the library window, so re-check how many
  // recordings still need analysis whenever the recorder regains focus.
  useEffect(() => {
    const onFocus = () => void refreshCount();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshCount]);

  const recording = status?.state === "recording";
  const transitioning = status?.transition !== "none";
  const startedAt = status?.startedAt ?? null;
  const justSaved = !recording && status?.lastFinish?.outcome === "saved";
  const justDiscarded = !recording && status?.lastFinish?.outcome === "discarded";
  const narrate = microphoneSettings?.narrationEnabled ?? false;

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
    const res = recording
      ? await window.skillRecorder.stop()
      : await window.skillRecorder.start();
    if (!res.ok) window.alert(res.error ?? "Action failed");
    setStatus(await window.skillRecorder.status());
  }, [recording]);

  const toggleNarration = useCallback(async () => {
    if (!microphoneSettings) return;
    setMicrophonePending(true);
    setMicrophoneActionError(null);
    const result = await window.skillRecorder.setNarrationEnabled(
      !microphoneSettings.narrationEnabled,
    );
    setMicrophoneSettings(result.status);
    if (!result.ok) {
      setMicrophoneActionError(
        result.error ?? "Could not update the narration preference.",
      );
    }
    setMicrophonePending(false);
  }, [microphoneSettings]);

  const selectMicrophone = useCallback(async (deviceId: string) => {
    setMicrophonePending(true);
    setMicrophoneActionError(null);
    const result = await window.skillRecorder.selectMicrophone(deviceId);
    setMicrophoneSettings(result.status);
    if (!result.ok) {
      setMicrophoneActionError(
        result.error ?? "Could not select that microphone.",
      );
    }
    setMicrophonePending(false);
  }, []);

  const openLibrary = useCallback(() => {
    void window.skillRecorder.openLibrary();
  }, []);

  const downloadNarrationModel = useCallback(async () => {
    const res = await window.skillRecorder.downloadNarrationModel();
    if (!res.ok) window.alert(res.error ?? "Could not download the voice transcription model.");
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
          disabled={transitioning || microphonePending}
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
              : justDiscarded
                ? "Recording discarded"
              : "Ready to capture"}
        </div>
      </div>

      <section className={`narrate ${narrate ? "on" : ""}`}>
        <button
          className="narrate-toggle"
          role="switch"
          aria-checked={narrate}
          aria-busy={microphonePending}
          onClick={() => void toggleNarration()}
          disabled={
            !microphoneSettings ||
            microphonePending ||
            recording ||
            transitioning
          }
        >
          <span className="narrate-icon" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
              <rect
                x="7.5"
                y="2.5"
                width="5"
                height="9"
                rx="2.5"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <path
                d="M5 9.2a5 5 0 0 0 10 0"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
              <path
                d="M10 14.2v3"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <span className="narrate-text">
            <span className="narrate-label">Narrate</span>
            <span className="narrate-sub">
              {microphonePending
                ? "Requesting microphone access..."
                : microphoneActionError || microphoneSettings?.error
                  ? "Microphone needs attention"
                  : recording
                    ? narrate
                      ? "Listening to your voice"
                      : "Voice off for this recording"
                    : narrate
                      ? `Will use ${microphoneSettings?.selectedDeviceLabel ?? "System default"}`
                      : "Explain out loud (optional)"}
            </span>
          </span>
          <span className={`narrate-switch ${narrate ? "on" : ""}`} aria-hidden>
            <span className="narrate-knob" />
          </span>
        </button>

        {narrate && microphoneSettings && (
          <div className="narrate-device">
            <label htmlFor="narrate-microphone">Microphone</label>
            <div className="narrate-select-wrap">
              <select
                id="narrate-microphone"
                value={microphoneSettings.selectedDeviceId}
                disabled={microphonePending || recording || transitioning}
                onChange={(event) => void selectMicrophone(event.target.value)}
              >
                {microphoneSettings.devices.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.label}
                  </option>
                ))}
              </select>
              <span className="narrate-select-chevron" aria-hidden>
                ▾
              </span>
            </div>
            {(microphoneActionError ||
              microphoneSettings.error ||
              microphoneSettings.fallback) && (
              <p
                className={`narrate-device-note ${
                  microphoneActionError || microphoneSettings.error
                    ? "error"
                    : "warn"
                }`}
                role={
                  microphoneActionError || microphoneSettings.error
                    ? "alert"
                    : undefined
                }
              >
                {microphoneActionError ??
                  microphoneSettings.error ??
                  microphoneSettings.fallback}
              </p>
            )}
          </div>
        )}
      </section>

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
            status={doctor.activeWindow.ok ? "good" : "bad"}
            note={doctor.activeWindow.ok ? doctor.activeWindow.provider : "provider missing"}
          />
          {doctor.activeSources.some((s) => s.key === "browserUrls") && (
            <Row
              label="browser URLs"
              status={doctor.browserUrl.supported ? "good" : "bad"}
              note={doctor.browserUrl.supported ? doctor.browserUrl.kind : "not on this OS"}
            />
          )}
          <Row
            label="copilot CLI"
            status={doctor.copilotCli.ok ? "good" : "bad"}
            note={doctor.copilotCli.ok ? "found" : "missing"}
          />
          {narrationStatus && (
            <VoiceModelRow
              status={narrationStatus}
              recording={recording}
              onDownload={downloadNarrationModel}
            />
          )}
        </div>
      )}

      <p className="hint">{TOGGLE_SHORTCUT} toggles from anywhere</p>

      {showPrivacy && <WhatsRecorded onClose={() => setShowPrivacy(false)} />}
    </div>
  );
}

type RowStatus = "good" | "warn" | "bad";

function Row({
  label,
  status,
  note,
  action,
}: {
  label: string;
  status: RowStatus;
  note: string;
  action?: { label: string; disabled?: boolean; onClick: () => void };
}) {
  const symbol = status === "good" ? "✓" : status === "warn" ? "!" : "✕";
  return (
    <div className="row">
      <span className={`badge ${status}`}>{symbol}</span>
      <span className="row-label">{label}</span>
      <span className="row-note">{note}</span>
      {action && (
        <button className="row-action" disabled={action.disabled} onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}

function VoiceModelRow({
  status,
  recording,
  onDownload,
}: {
  status: NarrationStatus;
  recording: boolean;
  onDownload: () => void;
}) {
  if (status.phase === "downloading") {
    const progress = status.progress == null ? "downloading" : `${status.progress}%`;
    return <Row label="voice transcription" status="warn" note={progress} />;
  }
  if (status.phase === "loading") {
    return <Row label="voice transcription" status="warn" note="preparing" />;
  }
  if (status.model === "ready") {
    return <Row label="voice transcription" status="good" note="offline" />;
  }
  return (
    <Row
      label="voice transcription"
      status="warn"
      note={status.model === "error" ? "download failed" : "~250 MB"}
      action={{
        label: status.model === "error" ? "retry" : "download",
        disabled: recording,
        onClick: onDownload,
      }}
    />
  );
}
