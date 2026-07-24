import { ipcMain } from "electron";

import { type CaptureConfig, type CaptureLevel, levelForConfig } from "../common/config";
import type { CaptureState } from "../common/ipc";
import { IPC } from "../common/ipc";
import { runDoctor } from "./doctor";
import type { RecorderController } from "./recorder/controller";
import type { SettingsStore } from "./settings";

/** Wire the renderer-facing invoke channels to the recorder, doctor + settings. */
export function registerIpc(recorder: RecorderController, settings: SettingsStore): void {
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
}
