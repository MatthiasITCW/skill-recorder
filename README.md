# Skill Recorder

Record a real work session on your screen, and turn it into a reusable **skill** or
**automation** for an AI agent. Skill Recorder captures what you did — screen video
plus activity signals — then uses the GitHub Copilot CLI to reconstruct it into a
clear **intent + ordered steps**, which you can generalize into something an agent
can repeat.

<p align="center">
  <img src="docs/images/recorder.png" alt="Skill Recorder capture window: a record button, timer, optional narration toggle, and readiness checks" width="420">
  &nbsp;&nbsp;
  <img src="docs/images/library.png" alt="Skill Recorder library: recorded sessions on the left, the reconstructed intent and ordered steps on the right" width="520">
</p>

## What it does

1. **Record** — hit record (or `⌘⇧R` / `Ctrl+Shift+R` from anywhere) and do your task.
   Skill Recorder captures the screen and your activity in the background.
2. **Control** — while recording, a movable always-on-top bar shows capture and
   microphone state. Use its split microphone control to mute, unmute, or change
   inputs, then finish or discard the recording; discard always asks for confirmation.
3. **Analyze** — when you choose Analyze, relevant recording data is sent to GitHub's
   cloud service and processed by GitHub Copilot to reconstruct *what you did*: one
   overall intent plus an ordered list of steps. You can review and edit the result.
4. **Create** — from an approved analysis, generalize the one run into a:
   - **Skill** — a `SKILL.md` procedure an agent runs on demand, and
   - **Automation** — the same procedure on a schedule/trigger.

   Both prefer the agent's **native tools** (e.g. the `gh` CLI, `web_fetch`) over
   replaying UI clicks, and generalize from your single example (e.g. "submit one form
   per row" for *all* N rows, not the 3 you happened to record).

## What's captured

Recording, storage, frame extraction, and optional narration transcription happen
**locally**, and nothing leaves your computer while you record. When you choose
Analyze, the event timeline (including window/document titles, URLs, and clipboard
previews), extracted screen images, narration text, and other content you provide are
sent to GitHub's cloud service and processed by GitHub Copilot.

Do not record, type, paste, display, copy, or narrate passwords, access tokens, API
keys, credentials, secrets, or other sensitive or confidential information. The app
shows a reminder before recording and its "Records your screen and activity" panel
explains exactly what's collected:

- **Window tracking** — active-app / window switches (Koffi/Win32 on Windows,
  `get-windows` elsewhere).
- **Browser URLs** — the page you're on (macOS, via AppleScript).
- **Screen video** — recorded by Chromium; low-rate snapshots are captured alongside
  it and retained only when the screen changes or a heartbeat is due.
- **Clipboard** — short previews of copied text that tie steps together.
- **Narration** *(optional)* — turn on **Narrate** before capture or toggle the
  microphone from the floating recording bar. Narrate shows the active input and
  remembers a selected microphone, with an explicit **System default** fallback.
  During capture, the bar can switch inputs without interrupting screen recording;
  each microphone-on interval is timestamped on the video timeline, saved locally,
  and can be transcribed **on-device** in any of Whisper's 99 supported languages
  (via transformers.js), preserving the selected language. The first transcription
  uses an explicit, one-time ~252 MB model download. The multilingual q8 checkpoint
  is only about 0.6 MB larger than the previous English-only model and uses the same
  `small` architecture, so runtime memory and transcription speed are expected to
  remain effectively unchanged.

## Requirements

- **macOS** (primary target). Windows 11 x64 and ARM64 are also supported; see
  [`WINDOWS-VALIDATION.md`](WINDOWS-VALIDATION.md).
- **Node.js 22+**.
- **GitHub Copilot CLI** installed and signed in — the `copilot` command must be on
  your `PATH`. This powers the analysis and the skill/automation builders.
- No system media tools are required. Chromium handles screen snapshots and narration
  audio decoding. A system `ffmpeg` is used only when opening a recording created by
  an older Skill Recorder version that has no snapshot manifest.

On first launch macOS will prompt for **Screen Recording** (required). Enabling
Narrate requests **Microphone** permission immediately so named inputs can be selected
before recording; the permission-check stream is released without saving audio.

## Quick start (download & run)

Don't want to clone and manage a source checkout? A one-line installer downloads Skill
Recorder into `~/.skill-recorder`, installs its dependencies, builds it, and launches
it. It's **safe to re-run**: the same command updates an existing install to the latest
code and only reinstalls or rebuilds when something actually changed.

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/adilei/skill-recorder/master/install.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/adilei/skill-recorder/master/install.ps1 | iex
```

You still need **Node.js 22+** and, for analysis, the **GitHub Copilot CLI** (see
[Requirements](#requirements)). The installer prefers `git` and falls back to a source
tarball/zip download when `git` isn't available.

Prefix either command with these optional overrides to change its behavior:

| Variable | Default | Purpose |
| --- | --- | --- |
| `SKILL_RECORDER_HOME` | `~/.skill-recorder` | where the app is installed |
| `SKILL_RECORDER_REF` | `master` | branch, tag, or commit to install |
| `SKILL_RECORDER_NO_RUN` | *(unset)* | install & build only, don't launch |

To update and relaunch later, just run the same one-liner again; to launch without
re-downloading, run `npm start` from the install directory.

## Run it (development)

> Prefer the one-line installer above for a quick run. To hack on the code, run it from
> source instead:

```bash
npm install
npm run dev
```

`npm run dev` starts Vite and launches the Electron app with hot-reload. The app also
lives in the menu-bar tray; `⌘⇧R` (macOS) / `Ctrl+Shift+R` (Windows) toggles recording
from anywhere. On Windows, press `F12` while the recorder or Sessions window is focused
to toggle DevTools during development.

Other useful scripts:

```bash
npm run typecheck   # tsc --noEmit
npm run build       # typecheck + production build (dist/ + dist-electron/)
npm run dist        # build a non-Windows distributable via electron-builder
npm run dist:win:x64    # requires native Windows x64
npm run dist:win:arm64  # requires native Windows ARM64
npm start           # run the last build with `electron .`
```

## Evals

The variable part of the system — the Copilot **describer** and **builders** — has a
fixture-based eval suite. See [`evals/README.md`](evals/README.md).

```bash
npm run eval            # score the describer against synthetic recordings
npm run eval:builder    # score the skill/automation generalization
```

## License

[MIT](LICENSE)
