import path from "node:path";
import { fileURLToPath } from "node:url";

import { BrowserWindow } from "electron";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 420,
    height: 580,
    title: "Skill Recorder",
    backgroundColor: "#16181d",
    webPreferences: {
      preload: path.join(dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(path.join(dirname, "..", "dist", "index.html"));
  }
  return win;
}
