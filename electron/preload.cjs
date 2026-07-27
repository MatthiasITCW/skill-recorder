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
  narrationStatus: "narration:status",
  narrationDownload: "narration:download",
  narrationTranscribe: "narration:transcribe",
  narrationStatusChanged: "narration:status-changed",
  analyze: "analyze:start",
  analyzeFeedback: "analyze:feedback",
  getAnalysis: "analyze:get",
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
  buildAutomation: "automation:build",
  createAutomation: "automation:create",
  getAutomation: "automation:get",
  cancelAutomation: "automation:cancel",
  revealAutomation: "automation:reveal",
  automationProgress: "automation:progress",
  openLibrary: "ui:open-library",
  closeLibrary: "ui:close-library",
};

contextBridge.exposeInMainWorld("skillRecorder", {
  start: (options) => ipcRenderer.invoke(IPC.start, options),
  stop: () => ipcRenderer.invoke(IPC.stop),
  status: () => ipcRenderer.invoke(IPC.status),
  marker: (note) => ipcRenderer.invoke(IPC.marker, note),
  doctor: () => ipcRenderer.invoke(IPC.doctor),
  onStatusChanged: (cb) => {
    const listener = (_event, status) => cb(status);
    ipcRenderer.on(IPC.statusChanged, listener);
    return () => ipcRenderer.removeListener(IPC.statusChanged, listener);
  },
  narrationStatus: () => ipcRenderer.invoke(IPC.narrationStatus),
  downloadNarrationModel: () => ipcRenderer.invoke(IPC.narrationDownload),
  transcribeNarration: (sessionId) => ipcRenderer.invoke(IPC.narrationTranscribe, sessionId),
  onNarrationStatusChanged: (cb) => {
    const listener = (_event, status) => cb(status);
    ipcRenderer.on(IPC.narrationStatusChanged, listener);
    return () => ipcRenderer.removeListener(IPC.narrationStatusChanged, listener);
  },
  analyze: (sessionId) => ipcRenderer.invoke(IPC.analyze, sessionId),
  analyzeFeedback: (input) => ipcRenderer.invoke(IPC.analyzeFeedback, input),
  getAnalysis: (sessionId) => ipcRenderer.invoke(IPC.getAnalysis, sessionId),
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
  createSkill: (sessionId, plan) => ipcRenderer.invoke(IPC.createSkill, sessionId, plan),
  getSkill: (sessionId) => ipcRenderer.invoke(IPC.getSkill, sessionId),
  cancelSkill: (sessionId) => ipcRenderer.invoke(IPC.cancelSkill, sessionId),
  revealSkill: (sessionId) => ipcRenderer.invoke(IPC.revealSkill, sessionId),
  onSkillProgress: (cb) => {
    const listener = (_event, progress) => cb(progress);
    ipcRenderer.on(IPC.skillProgress, listener);
    return () => ipcRenderer.removeListener(IPC.skillProgress, listener);
  },
  buildAutomation: (input) => ipcRenderer.invoke(IPC.buildAutomation, input),
  createAutomation: (sessionId, plan) => ipcRenderer.invoke(IPC.createAutomation, sessionId, plan),
  getAutomation: (sessionId) => ipcRenderer.invoke(IPC.getAutomation, sessionId),
  cancelAutomation: (sessionId) => ipcRenderer.invoke(IPC.cancelAutomation, sessionId),
  revealAutomation: (sessionId) => ipcRenderer.invoke(IPC.revealAutomation, sessionId),
  onAutomationProgress: (cb) => {
    const listener = (_event, progress) => cb(progress);
    ipcRenderer.on(IPC.automationProgress, listener);
    return () => ipcRenderer.removeListener(IPC.automationProgress, listener);
  },
  openLibrary: () => ipcRenderer.invoke(IPC.openLibrary),
  closeLibrary: () => ipcRenderer.invoke(IPC.closeLibrary),
});
