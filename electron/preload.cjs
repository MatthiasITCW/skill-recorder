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
  analyze: "analyze:start",
  analyzeFeedback: "analyze:feedback",
  getAnalysis: "analyze:get",
  approveAnalysis: "analyze:approve",
  updateAnalysis: "analyze:update",
  cancelAnalysis: "analyze:cancel",
  analyzeProgress: "analyze:progress",
  listSessions: "sessions:list",
  deleteSession: "sessions:delete",
  buildSkill: "skill:build",
  createSkill: "skill:create",
  getSkill: "skill:get",
  cancelSkill: "skill:cancel",
  revealSkill: "skill:reveal",
  skillProgress: "skill:progress",
  openLibrary: "ui:open-library",
  closeLibrary: "ui:close-library",
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
  analyze: (sessionId) => ipcRenderer.invoke(IPC.analyze, sessionId),
  analyzeFeedback: (input) => ipcRenderer.invoke(IPC.analyzeFeedback, input),
  getAnalysis: (sessionId) => ipcRenderer.invoke(IPC.getAnalysis, sessionId),
  approveAnalysis: (sessionId) => ipcRenderer.invoke(IPC.approveAnalysis, sessionId),
  updateAnalysis: (input) => ipcRenderer.invoke(IPC.updateAnalysis, input),
  cancelAnalysis: (sessionId) => ipcRenderer.invoke(IPC.cancelAnalysis, sessionId),
  onAnalyzeProgress: (cb) => {
    const listener = (_event, progress) => cb(progress);
    ipcRenderer.on(IPC.analyzeProgress, listener);
    return () => ipcRenderer.removeListener(IPC.analyzeProgress, listener);
  },
  listSessions: () => ipcRenderer.invoke(IPC.listSessions),
  deleteSession: (sessionId) => ipcRenderer.invoke(IPC.deleteSession, sessionId),
  buildSkill: (input) => ipcRenderer.invoke(IPC.buildSkill, input),
  createSkill: (sessionId) => ipcRenderer.invoke(IPC.createSkill, sessionId),
  getSkill: (sessionId) => ipcRenderer.invoke(IPC.getSkill, sessionId),
  cancelSkill: (sessionId) => ipcRenderer.invoke(IPC.cancelSkill, sessionId),
  revealSkill: (path) => ipcRenderer.invoke(IPC.revealSkill, path),
  onSkillProgress: (cb) => {
    const listener = (_event, progress) => cb(progress);
    ipcRenderer.on(IPC.skillProgress, listener);
    return () => ipcRenderer.removeListener(IPC.skillProgress, listener);
  },
  openLibrary: () => ipcRenderer.invoke(IPC.openLibrary),
  closeLibrary: () => ipcRenderer.invoke(IPC.closeLibrary),
});
