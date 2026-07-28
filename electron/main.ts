import { app, BrowserWindow, globalShortcut, ipcMain, Menu } from "electron";

import { FULL_CAPTURE } from "../common/config";
import { IPC } from "../common/ipc";
import { createCollectors } from "./collectors";
import { Describer } from "./describer/describer";
import { processSession } from "./pipeline";
import { registerIpc } from "./ipc";
import { createLogger } from "./logger";
import { NarrationManager } from "./narration/manager";
import { RecorderController } from "./recorder/controller";
import { SkillBuilder } from "./skillbuilder/builder";
import { AutomationBuilder } from "./automationbuilder/builder";
import { createTray } from "./tray";
import { AudioRecorder } from "./audio/recorder";
import { VideoRecorder } from "./video/recorder";
import { createLibraryWindow, createRecorderWindow, redockLibrary } from "./window";

const log = createLogger("Main");

let recorderWindow: BrowserWindow | null = null;
let libraryWindow: BrowserWindow | null = null;
let recorderHome: Electron.Rectangle | null = null;
const narration = new NarrationManager((status) =>
  broadcast(IPC.narrationStatusChanged, status),
);
const recorder = new RecorderController({
  resolveConfig: () => ({ ...FULL_CAPTURE }),
  buildCollectors: createCollectors,
  createVideoRecorder: () => new VideoRecorder(),
  createAudioRecorder: () => new AudioRecorder(),
  postProcess: async (dir) => {
    await processSession(dir);
    void narration.transcribeIfCached(dir).catch((err) =>
      log.warn("Cached narration processing failed:", err),
    );
  },
});

/** Send an event to every live window (recorder HUD + library, if open). */
function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

const describer = new Describer((progress) => broadcast(IPC.analyzeProgress, progress));
const builder = new SkillBuilder((progress) => broadcast(IPC.skillProgress, progress));
const automationBuilder = new AutomationBuilder((progress) =>
  broadcast(IPC.automationProgress, progress),
);

/** Open, focus, and re-dock the Sessions library window (creating it lazily). */
function openLibrary(): void {
  if (!recorderWindow || recorderWindow.isDestroyed()) return;
  if (libraryWindow && !libraryWindow.isDestroyed()) {
    redockLibrary(recorderWindow, libraryWindow);
    libraryWindow.show();
    libraryWindow.focus();
    return;
  }
  recorderHome = recorderWindow.getBounds();
  libraryWindow = createLibraryWindow(recorderWindow);
  libraryWindow.on("closed", () => {
    libraryWindow = null;
    // Return the recorder to where it sat before it made room for the library.
    if (recorderWindow && !recorderWindow.isDestroyed() && recorderHome) {
      recorderWindow.setBounds(recorderHome);
    }
    recorderHome = null;
    // Drop idle agent conversations now that the library is gone.
    void describer.evictIdle();
    void builder.evictIdle();
    void automationBuilder.evictIdle();
  });
}

app.whenReady().then(() => {
  if (process.platform === "win32") Menu.setApplicationMenu(null);

  narration.initialize();
  registerIpc(recorder, describer, builder, automationBuilder, narration);
  log.info("Capture: recording all sources");

  ipcMain.handle(IPC.openLibrary, () => openLibrary());
  ipcMain.handle(IPC.closeLibrary, () => {
    if (libraryWindow && !libraryWindow.isDestroyed()) libraryWindow.close();
  });

  recorder.onStatusChanged((status) => broadcast(IPC.statusChanged, status));

  recorderWindow = createRecorderWindow();

  try {
    createTray(recorder, recorderWindow);
  } catch (err) {
    log.warn("Tray unavailable:", err);
  }

  const toggle = () => {
    void (recorder.state === "recording" ? recorder.stop() : recorder.start());
  };
  if (!globalShortcut.register("CommandOrControl+Shift+R", toggle)) {
    log.warn("Global shortcut registration failed");
  }

  app.on("activate", () => {
    if (!recorderWindow || recorderWindow.isDestroyed()) {
      recorderWindow = createRecorderWindow();
    } else {
      recorderWindow.show();
      recorderWindow.focus();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  if (recorder.state === "recording") void recorder.stop();
  void describer.dispose();
  void builder.dispose();
  void automationBuilder.dispose();
});
