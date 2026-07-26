# Future features

Capabilities that are wired up in the codebase but deliberately not surfaced in
the UI yet. Each entry is dormant, not dead: the backend path stays intact so the
feature can be revived without re-plumbing it.

## Manual markers ("Add marker")

**Status:** backend retained, UI removed.

A marker is a user-authored note captured mid-recording ("what are you doing
right now?"). It was originally a HUD button that opened a blocking prompt.

**Why the button was removed:** voice narration supersedes it. Narration captures
the same "stated intent" signal continuously, hands-free, and timestamped, without
interrupting the task or letting a prompt dialog leak into the recorded frames. In
practice the button was never used, and the describer already treated the "flick
back to add a marker" moment as noise.

**What still exists (the plumbing behind it):**

| Layer | Location |
| --- | --- |
| Renderer bridge | `electron/preload.cjs` (`window.skillRecorder.marker`) |
| IPC channel + result type | `common/ipc.ts`, `electron/ipc.ts` |
| Recorder handler | `electron/recorder/controller.ts` (`marker()`) |
| Event type + payload | `common/events.ts` (`EventType.Marker`, `MarkerPayload`) |
| Correlation / bundling | `common/correlation.ts`, `common/bundle.ts` (`step.markers`) |
| Description surfacing | `common/describe.ts`, describer + skillbuilder `tools.ts` |

**What was removed:** the `Add marker` button and its `addMarker` handler in
`src/Recorder.tsx`, plus the `.marker` styles in `src/App.css`.

**How to revive it well:** don't bring back the blocking `window.prompt`. Prefer a
low-friction trigger that doesn't interrupt the recording, e.g. a global hotkey
that flags the current moment (optionally with a quick inline note), so a marker
becomes a precise "this instant matters" signal that complements the continuous
narration transcript rather than duplicating it.
