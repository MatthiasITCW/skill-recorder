import { app, globalShortcut, ipcMain, BrowserWindow } from "electron";

import { IPC } from "../common/ipc";
import { createCollectors } from "./collectors";
import { Describer } from "./describer/describer";
import { processSession } from "./pipeline";
import { registerIpc } from "./ipc";
import { createLogger } from "./logger";
import { RecorderController } from "./recorder/controller";
import { SettingsStore } from "./settings";
import { createTray } from "./tray";
import { VideoRecorder } from "./video/recorder";
import { createLibraryWindow, createRecorderWindow, redockLibrary } from "./window";

const log = createLogger("Main");

let recorderWindow: BrowserWindow | null = null;
let libraryWindow: BrowserWindow | null = null;
let recorderHome: Electron.Rectangle | null = null;
let settings: SettingsStore | null = null;
const recorder = new RecorderController({
  resolveConfig: () => (settings as SettingsStore).resolve(),
  buildCollectors: createCollectors,
  createVideoRecorder: () => new VideoRecorder(),
  postProcess: processSession,
});

/** Send an event to every live window (recorder HUD + library, if open). */
function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

const describer = new Describer((progress) => broadcast(IPC.analyzeProgress, progress));

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
  });
}

app.whenReady().then(() => {
  settings = new SettingsStore();
  registerIpc(recorder, settings, describer);
  log.info("Capture level:", settings.level);

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
});



