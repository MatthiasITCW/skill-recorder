import { Menu, Tray, nativeImage } from "electron";

import type { RecorderController } from "./recorder/controller";

/** Build a 16x16 tray glyph in code so we don't depend on an icon asset yet. */
function trayIcon(): Electron.NativeImage {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  const r = size / 2 - 1;
  for (let i = 0; i < size * size; i++) {
    const o = i * 4;
    const x = i % size;
    const y = Math.floor(i / size);
    const inside = (x - c) ** 2 + (y - c) ** 2 <= r * r;
    buf[o] = 70; // B
    buf[o + 1] = 70; // G
    buf[o + 2] = 225; // R
    buf[o + 3] = inside ? 255 : 0; // A
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

export function createTray(
  recorder: RecorderController,
  startRecording: () => Promise<unknown>,
  showRecorderWindow: () => void,
  showRecordingControls: () => void,
): Tray {
  const tray = new Tray(trayIcon());
  tray.setToolTip("Skill Recorder");

  const rebuild = () => {
    const recording = recorder.state === "recording";
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: recording ? "Stop recording" : "Start recording",
          click: () => void (recording ? recorder.stop() : startRecording()),
        },
        { type: "separator" },
        {
          label: recording ? "Show recording controls" : "Show window",
          click: () => {
            if (recording) {
              showRecordingControls();
              return;
            }
            showRecorderWindow();
          },
        },
        { label: "Quit", role: "quit" },
      ]),
    );
  };

  rebuild();
  recorder.onStatusChanged(rebuild);
  return tray;
}
