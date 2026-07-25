import { ipcMain } from "electron";
import path from "node:path";

import { type CaptureConfig, type CaptureLevel, levelForConfig } from "../common/config";
import type { AnalysisEditInput, AnalysisFeedbackInput, AnalyzeResult, CaptureState } from "../common/ipc";
import { IPC } from "../common/ipc";
import { Describer, loadPersistedAnalysis } from "./describer/describer";
import { runDoctor } from "./doctor";
import { createLogger } from "./logger";
import type { RecorderController } from "./recorder/controller";
import { listSessions } from "./sessions";
import type { SettingsStore } from "./settings";

const log = createLogger("IPC");

/** Wire the renderer-facing invoke channels to the recorder, describer, doctor + settings. */
export function registerIpc(
  recorder: RecorderController,
  settings: SettingsStore,
  describer: Describer,
): void {
  const captureState = (): CaptureState => {
    const config = settings.resolve();
    return { level: levelForConfig(config), config };
  };

  ipcMain.handle(IPC.start, () => recorder.start());
  ipcMain.handle(IPC.stop, () => recorder.stop());
  ipcMain.handle(IPC.status, () => recorder.status());
  ipcMain.handle(IPC.marker, (_event, note: string) => recorder.marker(note));
  ipcMain.handle(IPC.doctor, () => runDoctor(settings));
  ipcMain.handle(IPC.getCapture, () => captureState());
  ipcMain.handle(IPC.setLevel, (_event, level: Exclude<CaptureLevel, "custom">) => {
    settings.setLevel(level);
    return captureState();
  });
  ipcMain.handle(IPC.setConfig, (_event, config: CaptureConfig) => {
    settings.setConfig(config);
    return captureState();
  });

  const resolveSessionId = (sessionId?: string): string | null => {
    if (sessionId) return sessionId;
    const dir = recorder.lastSessionDir();
    return dir ? path.basename(dir) : null;
  };

  ipcMain.handle(IPC.analyze, async (_event, sessionId?: string): Promise<AnalyzeResult> => {
    const id = resolveSessionId(sessionId);
    if (!id) return { ok: false, error: "No completed session to analyze yet." };
    try {
      const analysis = await describer.analyze(id);
      return { ok: true, analysis };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.warn("analyze failed:", error);
      return { ok: false, error };
    }
  });

  ipcMain.handle(
    IPC.analyzeFeedback,
    async (_event, input: AnalysisFeedbackInput): Promise<AnalyzeResult> => {
      if (!input?.sessionId) return { ok: false, error: "Missing sessionId." };
      try {
        const analysis = await describer.feedback(input.sessionId, {
          overall: input.overall,
          steps: input.steps ?? [],
        });
        return { ok: true, analysis };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        log.warn("feedback failed:", error);
        return { ok: false, error };
      }
    },
  );

  ipcMain.handle(IPC.getAnalysis, (_event, sessionId: string) =>
    sessionId ? loadPersistedAnalysis(sessionId) : null,
  );

  ipcMain.handle(IPC.approveAnalysis, async (_event, sessionId: string): Promise<AnalyzeResult> => {
    if (!sessionId) return { ok: false, error: "Missing sessionId." };
    try {
      const analysis = await describer.approve(sessionId);
      return { ok: true, analysis };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.warn("approve failed:", error);
      return { ok: false, error };
    }
  });

  ipcMain.handle(IPC.updateAnalysis, async (_event, input: AnalysisEditInput): Promise<AnalyzeResult> => {
    if (!input?.sessionId) return { ok: false, error: "Missing sessionId." };
    try {
      const analysis = await describer.edit(input.sessionId, {
        title: input.title,
        intent: input.intent,
      });
      return { ok: true, analysis };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.warn("update failed:", error);
      return { ok: false, error };
    }
  });

  ipcMain.handle(IPC.cancelAnalysis, async (_event, sessionId: string) => {
    if (sessionId) await describer.cancel(sessionId);
    return { ok: true };
  });

  ipcMain.handle(IPC.listSessions, () => listSessions());
}

