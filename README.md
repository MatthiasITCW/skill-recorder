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
3. **Analyze** — on stop, it correlates the signals and a Copilot agent reconstructs
   *what you did*: one overall intent plus an ordered list of steps. You can review
   and edit the result.
4. **Create** — from an approved analysis, generalize the one run into a:
   - **Skill** — a `SKILL.md` procedure an agent runs on demand, and
   - **Automation** — the same procedure on a schedule/trigger.

   Both prefer the agent's **native tools** (e.g. the `gh` CLI, `web_fetch`) over
   replaying UI clicks, and generalize from your single example (e.g. "submit one form
   per row" for *all* N rows, not the 3 you happened to record).

## What's captured

Everything is captured and processed **locally**. The in-app "Records your screen and
activity" panel shows exactly what's collected:

- **Window tracking** — active-app / window switches (Koffi/Win32 on Windows,
  `get-windows` elsewhere).
- **Browser URLs** — the page you're on (macOS, via AppleScript).
- **Screen video** — recorded by Chromium; low-rate snapshots are captured alongside
  it and retained only when the screen changes or a heartbeat is due.
- **Clipboard** — copy/paste content that ties steps together.
- **Narration** *(optional)* — turn on **Narrate** before capture or toggle the
  microphone from the floating recording bar. Narrate shows the active input and
  remembers a selected microphone, with an explicit **System default** fallback.
  During capture, the bar can switch inputs without interrupting screen recording;
  each microphone-on interval is timestamped on the video timeline, saved locally,
  and can be transcribed **on-device** (Whisper via transformers.js). The first
  transcription uses an explicit, one-time ~250 MB model download.

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

## Run it (development)

> There is no packaged/released download yet — run it from source.

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
