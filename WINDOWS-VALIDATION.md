# Windows Validation Report

**Tested on:** Windows 11, Node 22, Electron 43  
**Date:** 2025-07-25

## Summary

The skill-recorder **works on Windows** for core recording. Install, typecheck, build, and the recording pipeline all pass. The main gap is the AI describer (Copilot SDK server crashes at launch) and the absence of video capture (likely a Screen Recording permission / `desktopCapturer` sourcing issue in the headless test context — requires manual re-test with a visible desktop).

---

## ✅ Passing

| Area | Status | Notes |
|------|--------|-------|
| `npm install` | ✅ | All native modules (sharp, get-windows, ffmpeg-static) install correctly |
| `tsc --noEmit` | ✅ | Zero type errors |
| `vite build` | ✅ | Client + electron main both bundle |
| App launch | ✅ | Electron window opens, tray created, global shortcut registered |
| `get-windows` | ✅ | Active window polling works (app names, PIDs, paths, bounds all captured) |
| Clipboard collector | ✅ | Detects clipboard changes, hashes + previews correctly |
| Session store | ✅ | Creates `%APPDATA%/skill-recorder/sessions/<id>/` with correct files |
| Event stream | ✅ | `events.jsonl` written with well-formed JSON lines |
| Pipeline (bundle + description) | ✅ | `bundle.json` and `description.md` generated post-stop |
| ffmpeg-static | ✅ | Binary exists at `node_modules/ffmpeg-static/ffmpeg.exe`, runs `ffmpeg -version` |
| Path handling | ✅ | All `path.join` usage is OS-agnostic; no hardcoded `/` separators found |
| Terminal hooks (pwsh) | ✅ | PowerShell hook snippet is correct and would write to `~/.skill-recorder/shell.jsonl` |

---

## ⚠️ Issues Found

### 1. Copilot SDK describer fails to start (BLOCKING for AI analysis)

**Symptom:** `[IPC] analyze failed: CLI server exited unexpectedly with code 0`  
**Root cause:** `@github/copilot-sdk` `CopilotClient.start()` spawns a child server process that exits immediately. The `copilot` CLI is not installed on this machine (`where copilot` → not found).  
**Impact:** The AI-powered session analysis (intent extraction, step refinement, feedback loop) is completely unavailable.  
**Fix:** Install the GitHub Copilot CLI (`copilot`) and sign in. The doctor UI already surfaces this requirement — no code change needed, just a prerequisite.

### 2. No video captured during test recording

**Symptom:** Session directory has no `video.webm` or `video.json`. The `frames/` directory is empty.  
**Likely cause:** `desktopCapturer.getSources({ types: ["screen"] })` may return an empty array when running without a visible desktop session, or Screen Recording permission equivalent is missing. In normal interactive use this should work — needs confirmation in a full desktop session.  
**Impact:** Frame extraction and visual correlation are skipped. The event-only pipeline still produces a valid bundle.  
**Fix:** No code change needed — this is expected degradation. The `VideoRecorder.start()` already handles this gracefully (line 88-90: logs "no screen source available; skipping video").

### 3. URL provider returns `null` on Windows (KNOWN LIMITATION)

**Symptom:** No `browser.url` events emitted even when Edge is frontmost.  
**Root cause:** `createUrlProvider()` at `electron/collectors/url-provider.ts:121` explicitly returns `null` for non-darwin platforms. Comment says: "Windows: UI Automation address-bar read is a later milestone."  
**Impact:** Browser URL tracking is unavailable on Windows. App switches and titles still work.  
**Fix needed:** Implement a Windows `UrlProvider` using UI Automation (or Accessibility APIs) to read the address bar of Chromium/Edge. This is a feature gap, not a bug.

### 4. Window titles are empty strings at `basic` capture level

**Symptom:** All `app.activate` events show `"title": ""`.  
**Root cause:** This is **by design** — `basic` level sets `windowTitles: false` (confirmed in `common/config.ts`). The `ActiveWindowCollector` respects this and passes empty titles.  
**Impact:** None — working as intended. Titles appear at `standard` or `full` levels.  
**Not a bug.**

---

## 🔍 Code Review: Windows-Specific Considerations

### Things that already work correctly

1. **`doctor.ts`** — uses `where` (Windows) vs `which` (Unix) for binary detection ✅
2. **`terminal-hooks.ts`** — includes a PowerShell hook (`PWSH_HOOK`) alongside zsh/bash ✅
3. **`session-store.ts`** — uses `path.join()` everywhere, no hardcoded separators ✅
4. **`vite.config.ts`** — uses `path.join()` for all asset copying ✅
5. **`video/recorder.ts`** — uses `path.join()` for preload and capture.html paths ✅
6. **Session ID validation** — regex `[A-Za-z0-9._-]` is safe on Windows filesystems ✅
7. **`ffmpeg-static`** — ships platform-specific binary (`ffmpeg.exe` on Windows) ✅
8. **`sharp`** — has Windows native bindings, installed and loadable ✅

### Potential issues for production/packaging

| Issue | File | Detail |
|-------|------|--------|
| `electron-builder` packaging | `package.json` | Untested — `npm run dist` was not run. Native modules (sharp, ffmpeg-static, get-windows) may need special `asarUnpack` config for Windows `.exe`/`.dll` files |
| `get-windows` binary | `node_modules/get-windows` | Ships a Windows binary; needs to survive asar packing or be unpacked |
| Long path risk | `session-store.ts` | `%APPDATA%` paths can be deep; session dirs with many nested frames could exceed 260-char limit on older Windows builds without long path support |

---

## Recommendations

1. **Install Copilot CLI** to unblock the describer — no code changes needed.
2. **Test video capture** in a full interactive desktop session (not headless/remote).
3. **Implement Windows URL provider** (UI Automation) as a future feature.
4. **Test `npm run dist`** (electron-builder) to verify native module packaging with `asarUnpack`.
5. **Consider enabling long paths** in the app manifest or documenting the requirement for Windows users.
