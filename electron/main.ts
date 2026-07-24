import { app, globalShortcut, type BrowserWindow } from "electron";

import { IPC } from "../common/ipc";
import { createCollectors } from "./collectors";
import { processSession } from "./pipeline";
import { registerIpc } from "./ipc";
import { createLogger } from "./logger";
import { RecorderController } from "./recorder/controller";
import { SettingsStore } from "./settings";
import { createTray } from "./tray";
import { VideoRecorder } from "./video/recorder";
import { createMainWindow } from "./window";

const log = createLogger("Main");

let mainWindow: BrowserWindow | null = null;
let settings: SettingsStore | null = null;
const recorder = new RecorderController({
  resolveConfig: () => (settings as SettingsStore).resolve(),
  buildCollectors: createCollectors,
  createVideoRecorder: () => new VideoRecorder(),
  postProcess: processSession,
});

app.whenReady().then(() => {
  settings = new SettingsStore();
  registerIpc(recorder, settings);
  log.info("Capture level:", settings.level);

  recorder.onStatusChanged((status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.statusChanged, status);
    }
  });

  mainWindow = createMainWindow();

  try {
    createTray(recorder, mainWindow);
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
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = createMainWindow();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  if (recorder.state === "recording") void recorder.stop();
});



