import path from "node:path";
import { fileURLToPath } from "node:url";

import { BrowserWindow, screen } from "electron";

const dirname = path.dirname(fileURLToPath(import.meta.url));

/** Compact recording HUD — fixed footprint, never resizes. */
const RECORDER = { width: 400, height: 600 };
/** Library sizing bounds; actual width adapts to the space beside the recorder. */
const LIBRARY = { desiredWidth: 1140, minWidth: 720, floorWidth: 520, maxHeight: 820 };
const MARGIN = 12;
const GAP = 10;

type Bounds = { x: number; y: number; width: number; height: number };

function loadRoute(win: BrowserWindow, hash?: string): void {
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void win.loadURL(hash ? `${devUrl}#${hash}` : devUrl);
  } else {
    void win.loadFile(path.join(dirname, "..", "dist", "index.html"), hash ? { hash } : undefined);
  }
}

export function createRecorderWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: RECORDER.width,
    height: RECORDER.height,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: "Skill Recorder",
    backgroundColor: "#111318",
    webPreferences: {
      preload: path.join(dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  loadRoute(win);
  return win;
}

/**
 * Lay the recorder and library out as an attached pair that is always fully
 * visible. The recorder keeps its place and the library docks to its right
 * whenever there's room; only when the right side is too tight do we slide the
 * recorder left (and, on very small displays, shrink the library) so the two
 * never overlap.
 */
function computeDock(recorder: BrowserWindow): { recorder: { x: number; y: number }; library: Bounds } {
  const rb = recorder.getBounds();
  const { workArea: wa } = screen.getDisplayMatching(rb);
  const recW = rb.width;
  const recH = rb.height;

  const libH = Math.min(LIBRARY.maxHeight, wa.height - MARGIN * 2);
  const pairTop = Math.max(
    wa.y + MARGIN,
    Math.min(rb.y, wa.y + wa.height - MARGIN - Math.max(recH, libH)),
  );

  let recX = rb.x;
  let libX = recX + recW + GAP;
  const rightRoom = wa.x + wa.width - MARGIN - libX;

  let libW: number;
  if (rightRoom >= LIBRARY.minWidth) {
    libW = Math.min(rightRoom, LIBRARY.desiredWidth);
  } else {
    const maxPairLibW = wa.width - MARGIN * 2 - recW - GAP;
    libW = Math.max(LIBRARY.floorWidth, Math.min(LIBRARY.desiredWidth, maxPairLibW));
    const totalW = recW + GAP + libW;
    recX = Math.max(wa.x + MARGIN, wa.x + wa.width - MARGIN - totalW);
    libX = recX + recW + GAP;
  }

  return {
    recorder: { x: Math.round(recX), y: Math.round(pairTop) },
    library: { x: Math.round(libX), y: Math.round(pairTop), width: Math.round(libW), height: Math.round(libH) },
  };
}

export function createLibraryWindow(recorder: BrowserWindow): BrowserWindow {
  const layout = computeDock(recorder);
  const win = new BrowserWindow({
    ...layout.library,
    minWidth: LIBRARY.floorWidth,
    minHeight: 480,
    show: false,
    title: "Skill Recorder — Sessions",
    backgroundColor: "#111318",
    webPreferences: {
      preload: path.join(dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  // Move the recorder and reveal the library together so the pair appears docked.
  win.once("ready-to-show", () => {
    if (!recorder.isDestroyed()) recorder.setPosition(layout.recorder.x, layout.recorder.y, false);
    win.show();
  });
  loadRoute(win, "library");
  return win;
}

/** Re-dock an already-open library beside the recorder and bring it forward. */
export function redockLibrary(recorder: BrowserWindow, library: BrowserWindow): void {
  if (library.isDestroyed() || recorder.isDestroyed()) return;
  const layout = computeDock(recorder);
  recorder.setPosition(layout.recorder.x, layout.recorder.y, false);
  library.setBounds(layout.library, false);
}
