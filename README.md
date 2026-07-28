# Skill Recorder

**Record yourself doing a task once — turn it into a skill your AI agent can repeat.**

Skill Recorder captures a real work session on your screen — the clicks, the app and
window switches, the pages you visit, and (if you want) your spoken narration — then uses
the **GitHub Copilot CLI** to reconstruct *what you actually did* as a clear **intent plus
an ordered list of steps**. From there, one step turns that single run into something an
agent can reuse:

- a **Skill** — a `SKILL.md` procedure an agent runs on demand, or
- an **Automation** — the same procedure on a schedule or trigger.

Both prefer the agent's **native tools** (like the `gh` CLI or `web_fetch`) over replaying
UI clicks, and generalize from your one example — so recording yourself submitting *one*
form can teach the agent to submit *all* of them.

<p align="center">
  <img src="docs/images/recorder.png" alt="Skill Recorder capture window: a record button, timer, optional narration toggle, and readiness checks" width="420">
  &nbsp;&nbsp;
  <img src="docs/images/library.png" alt="Skill Recorder library: recorded sessions on the left, the reconstructed intent and ordered steps on the right" width="520">
</p>

## How it works

1. 🔴 **Record** — Hit record (or `⌘⇧R` / `Ctrl+Shift+R` from anywhere) and just do your
   task. Skill Recorder captures your screen and activity locally, in the background.
2. 🎛️ **Control** — While recording, a small always-on-top bar shows capture and
   microphone state. Mute, unmute, or switch mics on the fly, then finish — or discard
   (with a confirmation) if the take didn't go to plan.
3. 🧠 **Analyze** — Click Analyze and GitHub Copilot reconstructs one overall intent and
   an ordered list of steps. Review and edit until it reads right.
4. ✨ **Create** — From an approved analysis, generate a reusable **Skill** and/or a
   scheduled **Automation**.

## Get started

The quickest path: one command downloads Skill Recorder, sets it up, builds it, and
launches it. It's **safe to re-run** — the same command updates your install to the latest
version and only does work when something actually changed.

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/adilei/skill-recorder/master/install.sh | bash
```

**Windows** — paste into any terminal (Command Prompt *or* PowerShell)

```powershell
powershell -c "irm https://raw.githubusercontent.com/adilei/skill-recorder/master/install.ps1 | iex"
```

No prerequisites to chase: if you don't already have **Node.js 22+**, the installer quietly
downloads a private copy just for Skill Recorder (nothing is installed system-wide, no
executables are built). You'll want the **GitHub Copilot CLI** signed in for the analysis
step (see [Requirements](#requirements)). On first launch, macOS asks for **Screen Recording**
permission — grant it and you're ready to record.

> ⚠️ **Keep secrets out of your recordings.** Don't record, type, paste, or narrate
> passwords, tokens, API keys, or other confidential info — choosing *Analyze* sends
> recording data to GitHub's cloud. Skill Recorder reminds you before every recording.
> Details in [What gets captured](#what-gets-captured).

<details>
<summary>Install options &amp; updating</summary>

Set any of these environment variables when you run the command:

| Variable | Default | What it does |
| --- | --- | --- |
| `SKILL_RECORDER_HOME` | `~/.skill-recorder` | where the app is installed |
| `SKILL_RECORDER_REF` | `master` | branch, tag, or commit to install |
| `SKILL_RECORDER_NO_RUN` | *(unset)* | set up without launching |
| `SKILL_RECORDER_DETACHED` | *(unset)* | run detached (keeps running after the terminal closes) and write rolling logs to `<home>/logs` |
| `SKILL_RECORDER_LOG_KEEP` | `5` | how many detached log files to keep |
| `SKILL_RECORDER_NODE_VERSION` | `latest-v22.x` | Node version to fetch when none is installed |
| `SKILL_RECORDER_NODE_MIRROR` | `https://nodejs.org/dist` | mirror for the Node download |

**Example — run it detached** so the app keeps running after you close the terminal
(output goes to rolling log files under `<home>/logs`). Note *where* the variable goes:

- **macOS / Linux** — after the pipe, so it applies to `bash`:

  ```bash
  curl -fsSL https://raw.githubusercontent.com/adilei/skill-recorder/master/install.sh | SKILL_RECORDER_DETACHED=1 bash
  ```

- **Windows** — inside the quotes, before `irm`:

  ```powershell
  powershell -c "$env:SKILL_RECORDER_DETACHED=1; irm https://raw.githubusercontent.com/adilei/skill-recorder/master/install.ps1 | iex"
  ```

Re-run the one-liner any time to update and relaunch. To relaunch without re-downloading,
run `npm start` from the install directory. The installer uses `git` when available and
falls back to a source tarball/zip download otherwise.
</details>

---

*The rest of this README is for people who want the details — or want to hack on the code.*

## Requirements

- **macOS** (primary target). Windows 11 x64 and ARM64 are also supported — see
  [`WINDOWS-VALIDATION.md`](WINDOWS-VALIDATION.md).
- **Node.js 22+** — the one-liner auto-downloads a private copy if you don't already have
  it, so you only need to install this yourself if you skip the installer.
- **GitHub Copilot CLI**, installed and signed in, with `copilot` on your `PATH`. It
  powers the analysis and the skill/automation builders.
- No system media tools required — Chromium handles screen snapshots and narration audio
  decoding. A system `ffmpeg` is only used to open recordings made by an older Skill
  Recorder version that has no snapshot manifest.

On first launch macOS prompts for **Screen Recording** (required). Turning on **Narrate**
requests **Microphone** permission immediately so you can pick a named input before
recording; that permission-check stream is released without saving any audio.

## What gets captured

Recording, storage, frame extraction, and optional narration transcription all happen
**on your computer** — nothing leaves while you record. Only when you choose **Analyze**
does Skill Recorder send the event timeline (window/document titles, URLs, and clipboard
previews), extracted screen images, narration text, and anything else you provide to
GitHub's cloud service for Copilot to process.

> ⚠️ **Please don't capture secrets.** Passwords, access tokens, API keys, credentials, and
> other confidential information should never be recorded, typed, pasted, shown, copied,
> or narrated during a session.

The in-app "Records your screen and activity" panel spells out exactly what's collected:

- **Window tracking** — active-app / window switches (Koffi/Win32 on Windows,
  `get-windows` elsewhere).
- **Browser URLs** — the page you're on (macOS, via AppleScript).
- **Screen video** — recorded by Chromium; low-rate snapshots are captured alongside it
  and retained only when the screen changes or a heartbeat is due.
- **Clipboard** — short previews of copied text that tie steps together.
- **Narration** *(optional)* — turn on **Narrate** before capture or toggle the microphone
  from the floating recording bar. Narrate shows the active input and remembers a selected
  microphone, with an explicit **System default** fallback. During capture, the bar can
  switch inputs without interrupting screen recording; each microphone-on interval is
  timestamped on the video timeline, saved locally, and can be transcribed **on-device** in
  any of Whisper's 99 supported languages (via transformers.js), preserving the selected
  language. The first transcription uses an explicit, one-time ~252 MB model download. The
  multilingual q8 checkpoint is only about 0.6 MB larger than the previous English-only
  model and uses the same `small` architecture, so runtime memory and transcription speed
  are expected to remain effectively unchanged.

## Run from source (development)

Prefer to hack on the code instead of using the installer? Clone the repo and:

```bash
npm install
npm run dev
```

`npm run dev` starts Vite and launches the Electron app with hot-reload. The app also
lives in the menu-bar tray; `⌘⇧R` (macOS) / `Ctrl+Shift+R` (Windows) toggles recording
from anywhere. On Windows, press `F12` while the recorder or Sessions window is focused to
toggle DevTools during development.

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
