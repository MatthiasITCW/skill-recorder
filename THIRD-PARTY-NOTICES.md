# Third-Party Notices

Skill Recorder is licensed under the MIT License (see [`LICENSE`](./LICENSE)).

Packaged/distributed builds include third-party components that are covered by
their own license terms. This file summarizes the notable ones. The complete
license notices retained by Electron are distributed as `LICENSE.electron.txt`
and `LICENSES.chromium.html`; package metadata and the source links below cover
the other native runtime components.

The dependency tree is otherwise permissive (MIT, ISC, Apache-2.0, BSD,
BlueOak-1.0.0) and compatible with distributing this application under MIT.

## Optional downloaded model

### OpenAI Whisper small — `Xenova/whisper-small`
- The multilingual model is downloaded from
  [`Xenova/whisper-small`](https://huggingface.co/Xenova/whisper-small) only
  after explicit user approval; its weights are not bundled with Skill Recorder.
- The Transformers.js-compatible ONNX conversion is published by Xenova
  (Joshua Lochner) from OpenAI's
  [`openai/whisper-small`](https://huggingface.co/openai/whisper-small)
  checkpoint.
- The Hugging Face model metadata declares **Apache-2.0**. OpenAI's
  [Whisper repository](https://github.com/openai/whisper) also states that its
  code and model weights are released under the **MIT License**. The downloaded
  model remains subject to its publisher's applicable terms and does not change
  Skill Recorder's MIT license.

## Bundled runtime components

### GitHub Copilot CLI — `@github/copilot` (+ platform binary `@github/copilot-<platform>-<arch>`)
- License: **GitHub Copilot CLI License** (proprietary) — see
  `node_modules/@github/copilot/LICENSE.md`.
- Pulled in by `@github/copilot-sdk` (MIT) and spawned as a separate process.
- Redistribution is permitted **only** as an unmodified copy bundled as part of
  this application, with the license and all copyright/attribution notices
  retained. The license explicitly states it does not restrict this
  application's own license, including distribution under an open-source (MIT)
  license.

### Electron / Chromium media codecs
- License: Electron is **MIT**. Its Chromium runtime includes `ffmpeg.dll`
  (`libffmpeg.dylib` / `libffmpeg.so` on other platforms), a dynamically loaded
  codec library whose bundled notice identifies FFmpeg as **LGPL-2.1-or-later**.
  GPL portions require an explicit non-default FFmpeg build configuration.
- Electron's `LICENSE.electron.txt` and `LICENSES.chromium.html` are retained in
  every packaged application.
- The currently pinned source is Electron
  [`v43.1.1`](https://github.com/electron/electron/tree/v43.1.1), Chromium
  [`150.0.7871.114`](https://chromium.googlesource.com/chromium/src/+/150.0.7871.114),
  and Chromium FFmpeg revision
  [`ad41607c61898cf7150e0fb20fe4bbabd44922a3`](https://chromium.googlesource.com/chromium/third_party/ffmpeg/+/ad41607c61898cf7150e0fb20fe4bbabd44922a3).
- Chromium records the WebM media, captures screen snapshots, and decodes
  narration audio. Skill Recorder does **not** distribute `ffmpeg-static` or a
  standalone FFmpeg executable.
- A user-installed standalone FFmpeg may be invoked only to read a recording
  created before snapshot manifests were introduced. That executable is not part
  of this app.

### Sharp / libvips — `sharp` and `@img/sharp-*`
- `sharp` is **Apache-2.0**. Its Windows native packages are
  **Apache-2.0 AND LGPL-3.0-or-later**; other platforms load the corresponding
  **LGPL-3.0-or-later** `@img/sharp-libvips-*` package.
- The currently pinned source is Sharp
  [`v0.34.5`](https://github.com/lovell/sharp/tree/v0.34.5), its reproducible
  packaging scripts
  [`sharp-libvips v1.2.4`](https://github.com/lovell/sharp-libvips/tree/v1.2.4),
  and libvips
  [`v8.17.3`](https://github.com/libvips/libvips/tree/v8.17.3). The unpacked
  native module remains replaceable in the packaged application.

### LGPL release materials

Before publishing an installer, its release must provide archives of the exact
source revisions above, the applicable LGPL text, and any build/object material needed
to relink modified LGPL components. These materials must be available beside
the installer, or through a written offer valid for at least three years; do
not rely only on third-party hosting remaining available.

### Other native modules
- `get-windows` — MIT
- `koffi` / `@koromix/koffi-*` — MIT; used for Win32 foreground-window calls,
  including the native Windows ARM64 build.
- `sharp` — Apache-2.0; see the Sharp/libvips section for native payload terms

## Apache-2.0 components
Some dependencies (e.g. `sharp`) are Apache-2.0, which requires retaining their
copyright, license, and any `NOTICE` file contents. These are preserved under
`node_modules`.

## Generating a complete license manifest
For a full, per-package license listing at release time:

```sh
npx license-checker-rseidelsohn --production --files THIRD-PARTY-LICENSES
```
