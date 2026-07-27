import path from "node:path";

import koffi from "koffi";

import type { ActiveWindowResult } from "./window-info";

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const GW_CHILD = 5;
const GW_HWNDNEXT = 2;
const DWMWA_EXTENDED_FRAME_BOUNDS = 9;
const MAX_TEXT_CHARS = 32_768;
const MAX_UWP_CHILDREN = 256;

const user32 = koffi.load("user32.dll");
const kernel32 = koffi.load("kernel32.dll");
const dwmapi = koffi.load("dwmapi.dll");

const getForegroundWindow = user32.func("GetForegroundWindow", "void *", []);
const getWindow = user32.func("GetWindow", "void *", ["void *", "uint32"]);
const getWindowThreadProcessId = user32.func(
  "GetWindowThreadProcessId",
  "uint32",
  ["void *", "void *"],
);
const getWindowTextLength = user32.func("GetWindowTextLengthW", "int32", ["void *"]);
const getWindowText = user32.func(
  "GetWindowTextW",
  "int32",
  ["void *", "void *", "int32"],
);
const getWindowRect = user32.func("GetWindowRect", "int32", ["void *", "void *"]);
const dwmGetWindowAttribute = dwmapi.func(
  "DwmGetWindowAttribute",
  "int32",
  ["void *", "uint32", "void *", "uint32"],
);
const openProcess = kernel32.func(
  "OpenProcess",
  "void *",
  ["uint32", "int32", "uint32"],
);
const queryFullProcessImageName = kernel32.func(
  "QueryFullProcessImageNameW",
  "int32",
  ["void *", "uint32", "void *", "void *"],
);
const closeHandle = kernel32.func("CloseHandle", "int32", ["void *"]);

const DISPLAY_NAMES: Record<string, string> = {
  chrome: "Google Chrome",
  msedge: "Microsoft Edge",
  firefox: "Firefox",
  brave: "Brave",
  opera: "Opera",
  vivaldi: "Vivaldi",
  code: "Visual Studio Code",
  explorer: "File Explorer",
  applicationframehost: "Windows app",
};

/** Native Win32 foreground-window lookup with a prebuilt ARM64 N-API FFI. */
export function readWindowsActiveWindow(): ActiveWindowResult | undefined {
  let window = getForegroundWindow();
  if (!window) return undefined;

  let processId = processIdFor(window);
  let processPath = processPathFor(processId);
  if (path.win32.basename(processPath).toLowerCase() === "applicationframehost.exe") {
    const child = findUwpOwner(window, processId);
    if (child) {
      window = child;
      processId = processIdFor(child);
      processPath = processPathFor(processId);
    }
  }

  const executable = path.win32.basename(processPath, path.win32.extname(processPath));
  const normalized = executable.toLowerCase();
  const name = (DISPLAY_NAMES[normalized] ?? executable) || "unknown";
  return {
    title: windowTitle(window),
    id: Number(koffi.address(window)),
    bounds: windowBounds(window),
    owner: {
      name,
      processId,
      path: processPath,
    },
  };
}

function processIdFor(window: unknown): number {
  const output = Buffer.alloc(4);
  getWindowThreadProcessId(window, output);
  return output.readUInt32LE(0);
}

function processPathFor(processId: number): string {
  if (!processId) return "";
  const processHandle = openProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, processId);
  if (!processHandle) return "";
  try {
    const output = Buffer.alloc(MAX_TEXT_CHARS * 2);
    const size = Buffer.alloc(4);
    size.writeUInt32LE(MAX_TEXT_CHARS);
    if (!queryFullProcessImageName(processHandle, 0, output, size)) return "";
    return output.subarray(0, size.readUInt32LE(0) * 2).toString("utf16le");
  } finally {
    closeHandle(processHandle);
  }
}

function windowTitle(window: unknown): string {
  const length = Math.min(MAX_TEXT_CHARS - 1, Math.max(0, getWindowTextLength(window)));
  if (length === 0) return "";
  const output = Buffer.alloc((length + 1) * 2);
  const written = getWindowText(window, output, length + 1);
  return written > 0 ? output.subarray(0, written * 2).toString("utf16le") : "";
}

function windowBounds(window: unknown): ActiveWindowResult["bounds"] {
  const rect = Buffer.alloc(16);
  const dwmResult = dwmGetWindowAttribute(
    window,
    DWMWA_EXTENDED_FRAME_BOUNDS,
    rect,
    rect.byteLength,
  );
  if (dwmResult !== 0 && !getWindowRect(window, rect)) return undefined;
  const left = rect.readInt32LE(0);
  const top = rect.readInt32LE(4);
  const right = rect.readInt32LE(8);
  const bottom = rect.readInt32LE(12);
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

function findUwpOwner(root: unknown, frameHostProcessId: number): unknown | null {
  const queue: unknown[] = [root];
  let visited = 0;
  while (queue.length > 0 && visited < MAX_UWP_CHILDREN) {
    const parent = queue.shift();
    let child = getWindow(parent, GW_CHILD);
    while (child && visited++ < MAX_UWP_CHILDREN) {
      const childProcessId = processIdFor(child);
      if (childProcessId && childProcessId !== frameHostProcessId) return child;
      queue.push(child);
      child = getWindow(child, GW_HWNDNEXT);
    }
  }
  return null;
}
