// Preload bridge — CommonJS on purpose (runs in the renderer's isolated world).
// Keep channel strings in sync with common/ipc.ts.
const { contextBridge, ipcRenderer } = require("electron");

const IPC = {
  start: "recorder:start",
  stop: "recorder:stop",
  status: "recorder:status",
  marker: "recorder:marker",
  doctor: "doctor:check",
  statusChanged: "recorder:status-changed",
  getCapture: "capture:get",
  setLevel: "capture:set-level",
  setConfig: "capture:set-config",
};

contextBridge.exposeInMainWorld("skillRecorder", {
  start: () => ipcRenderer.invoke(IPC.start),
  stop: () => ipcRenderer.invoke(IPC.stop),
  status: () => ipcRenderer.invoke(IPC.status),
  marker: (note) => ipcRenderer.invoke(IPC.marker, note),
  doctor: () => ipcRenderer.invoke(IPC.doctor),
  getCapture: () => ipcRenderer.invoke(IPC.getCapture),
  setLevel: (level) => ipcRenderer.invoke(IPC.setLevel, level),
  setConfig: (config) => ipcRenderer.invoke(IPC.setConfig, config),
  onStatusChanged: (cb) => {
    const listener = (_event, status) => cb(status);
    ipcRenderer.on(IPC.statusChanged, listener);
    return () => ipcRenderer.removeListener(IPC.statusChanged, listener);
  },
});
