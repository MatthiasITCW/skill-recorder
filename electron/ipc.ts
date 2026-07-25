import { ipcMain, shell } from "electron";
import path from "node:path";

import { type CaptureConfig, type CaptureLevel, levelForConfig } from "../common/config";
import type {
  AnalysisEditInput,
  AnalysisFeedbackInput,
  AnalyzeResult,
  CaptureState,
  DeleteSessionResult,
  SkillBuildInput,
  SkillCreateResult,
  SkillPlanResult,
} from "../common/ipc";
import { IPC } from "../common/ipc";
import { Describer, loadPersistedAnalysis } from "./describer/describer";
import { runDoctor } from "./doctor";
import { createLogger } from "./logger";
import type { RecorderController } from "./recorder/controller";
import { isValidSessionId } from "./recorder/session-store";
import { deleteSession, listSessions } from "./sessions";
import type { SettingsStore } from "./settings";
import { loadPersistedSkill, SkillBuilder } from "./skillbuilder/builder";

const log = createLogger("IPC");

/** Wire the renderer-facing invoke channels to the recorder, describer, builder, doctor + settings. */
export function registerIpc(
  recorder: RecorderController,
  settings: SettingsStore,
  describer: Describer,
  builder: SkillBuilder,
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
    if (!isValidSessionId(id)) return { ok: false, error: "Unknown session." };
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
      if (!isValidSessionId(input?.sessionId)) return { ok: false, error: "Unknown session." };
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
    isValidSessionId(sessionId) ? loadPersistedAnalysis(sessionId) : null,
  );

  ipcMain.handle(IPC.updateAnalysis, async (_event, input: AnalysisEditInput): Promise<AnalyzeResult> => {
    if (!isValidSessionId(input?.sessionId)) return { ok: false, error: "Unknown session." };
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
    if (isValidSessionId(sessionId)) await describer.cancel(sessionId);
    return { ok: true };
  });

  ipcMain.handle(IPC.listSessions, () => listSessions());

  ipcMain.handle(IPC.deleteSession, async (_event, sessionId: string): Promise<DeleteSessionResult> => {
    if (!isValidSessionId(sessionId)) return { ok: false, error: "Unknown session." };
    if (recorder.status().sessionId === sessionId) {
      return { ok: false, error: "You can't delete a recording while it's still in progress." };
    }
    if (describer.isAnalyzing(sessionId)) {
      return { ok: false, error: "This recording is being analyzed. Cancel that first, then delete." };
    }
    if (builder.isBuilding(sessionId)) {
      return { ok: false, error: "This recording is being turned into a skill. Cancel that first, then delete." };
    }
    try {
      await describer.forget(sessionId); // release any idle agent holding the folder
      await builder.forget(sessionId);
      await deleteSession(sessionId);
      recorder.forgetSession(sessionId); // clear the "last completed" pointer if it was this one
      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.warn("delete failed:", error);
      return { ok: false, error };
    }
  });

  ipcMain.handle(IPC.buildSkill, async (_event, input: SkillBuildInput): Promise<SkillPlanResult> => {
    if (!isValidSessionId(input?.sessionId)) return { ok: false, error: "Unknown session." };
    try {
      const plan = await builder.build(input);
      return { ok: true, plan };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.warn("build skill failed:", error);
      return { ok: false, error };
    }
  });

  ipcMain.handle(IPC.createSkill, async (_event, sessionId: string): Promise<SkillCreateResult> => {
    if (!isValidSessionId(sessionId)) return { ok: false, error: "Unknown session." };
    try {
      const { skill, path: file } = await builder.create(sessionId);
      return { ok: true, skill, path: file };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.warn("create skill failed:", error);
      return { ok: false, error };
    }
  });

  ipcMain.handle(IPC.getSkill, (_event, sessionId: string) =>
    isValidSessionId(sessionId) ? loadPersistedSkill(sessionId) : null,
  );

  ipcMain.handle(IPC.cancelSkill, async (_event, sessionId: string) => {
    if (isValidSessionId(sessionId)) await builder.cancel(sessionId);
    return { ok: true };
  });

  ipcMain.handle(IPC.revealSkill, (_event, file: string) => {
    if (typeof file === "string" && file) shell.showItemInFolder(file);
    return { ok: true };
  });
}

