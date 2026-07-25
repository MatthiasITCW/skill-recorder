# Windows event capture

Skill Recorder is cross platform (macOS + Windows). The core (recorder controller,
event bus, session store, collector host, capture tiers, describer, skill builder)
is platform agnostic. This doc covers the parts that are OS specific: how each
event source behaves on Windows, how to set it up, and a live smoke test to run
before trusting a Windows build.

## What captures what on Windows

| Source | Mechanism on Windows | Parity vs macOS | Permission |
|--------|----------------------|-----------------|------------|
| App switches | `get-windows` native addon | Full | None |
| Window titles | `get-windows` native addon | Full (better: no grant needed) | None |
| Browser URLs | UI Automation address bar read (`powershell.exe` host) | Functional, not byte exact | None |
| Clipboard | Electron clipboard | Full | None |
| Screen video + frames | `desktopCapturer` + ffmpeg + sharp | Full | Screen capture |

Notes:

- **Browser URLs** read the *omnibox display value* through UI Automation
  (`electron/collectors/windows-url-provider.ts`), not the exact active tab URL
  the macOS AppleScript provider gets. That is enough for host level step
  segmentation, and unlike macOS it also reads **Firefox**. Values that look like
  a search term (whitespace, or no dot) are dropped rather than emitted as noise.
- **Window titles** need no OS permission on Windows (macOS needs Accessibility).

## Prerequisites

1. **Native window addon.** `get-windows` ships a prebuilt N-API binary per
   platform. On a Windows build/dev machine, `npm install` fetches
   `napi-*-win32-*-x64/node-get-windows.node`. If it is missing, `get-windows`
   silently returns no-op stubs and app-switch tracking dies with no error, so
   the doctor check below exists specifically to catch that.
2. **Windows PowerShell.** `powershell.exe` (Windows PowerShell 5.1, in-box on
   every Windows 10/11) is used to host the UI Automation URL reader. No install
   needed.
3. **Copilot CLI** on `PATH` for the describer (`copilot`).
4. **ffmpeg** is bundled via `ffmpeg-static`; no system install needed.

## Doctor signals

Open the recorder HUD and read the doctor rows (or call `doctor()` over IPC).
On Windows, confirm:

- **window tracking** = `native` (not `addon missing`). `addon missing` means the
  `get-windows` `.node` did not resolve, which is a packaging or install problem.
- **browser URLs** = `uia` when the capture level includes URLs.

## Live smoke test

Run a real recording on Windows and verify each source lands in the session's
`events.jsonl`. Set the capture level to **Full** first so every source is on.

1. **Start** capture from the HUD (or `Ctrl+Shift+R`).
2. **App switches / titles.** Alt-Tab between two apps (e.g. Edge and Notepad).
   Expect `app.activate` events with the right `owner.name`, and
   `app.title-change` as titles change.
3. **Browser URLs.** In Edge or Chrome, navigate to two different sites. Expect
   `browser.url` events with the address bar URL and `host`. Try Firefox too.
   Typing a partial URL or a search term should not emit a bogus event.
4. **Clipboard.** Copy some text. Expect a `clipboard.change` event with a
   preview and hash.
5. **Video.** Confirm a `.webm` is written and `frame.captured` events appear.
6. **Stop.** The recording should show up in the library as `recorded`, and
   analysis should produce a coherent intent + ordered steps.

If a source produces nothing, check the doctor row for it first, then the main
process log for the one-time warnings (e.g. "Browser URL capture is on but
unavailable on this platform", or a reduced-capture notice).

## Packaging

`package.json` `build` configures electron-builder for both `mac` and `win`
(nsis x64). Native modules (`get-windows`, `sharp`, `@img/*`, `ffmpeg-static`)
are listed under `asarUnpack` so their binaries load from disk rather than from
inside the asar archive.

Build the Windows installer on Windows (or a Windows CI runner) so the native
binaries for `win32-x64` are present:

```powershell
npm ci
npm run dist
```

Cross building the Windows target from macOS will not fetch the Windows native
binaries and is not supported here.

## Known limitations

- Browser URLs are best effort display strings, not the exact tab URL.
- Terminal capture is not currently implemented; a recorded-terminal (PTY)
  approach is tracked in issue #7.
- Semantic UI events (focus/invoke/value via UI Automation) are not implemented
  on either platform yet.
- The Windows paths above are validated by typecheck, a PowerShell parse check of
  the UIA script, and a `win32` describer eval (`evals/scenarios/windows-deploy.ts`).
  Live capture must still be verified on a real Windows machine using the checklist
  above.
