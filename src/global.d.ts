import type { SkillRecorderApi } from "../common/ipc";

declare global {
  interface Window {
    skillRecorder: SkillRecorderApi;
  }
}

export {};
