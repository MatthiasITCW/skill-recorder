# Third-Party Notices

Skill Recorder is licensed under the MIT License (see [`LICENSE`](./LICENSE)).

Packaged/distributed builds include third-party components that are covered by
their own license terms. This file summarizes the notable ones. The complete
license text for every dependency lives in its own directory under
`node_modules/<package>/` (for example `LICENSE` or `LICENSE.md`).

The dependency tree is otherwise permissive (MIT, ISC, Apache-2.0, BSD,
BlueOak-1.0.0) and compatible with distributing this application under MIT.

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

### FFmpeg — via `ffmpeg-static`
- ⚠️ `ffmpeg-static` currently ships a **GPL-3.0-or-later** FFmpeg build. This is
  the one bundled component that is **not** compatible with an MIT-only
  distribution.
- Tracked in **issue #11**: planned replacement with an **LGPL-2.1** FFmpeg build
  (e.g. `@ffmpeg-installer/ffmpeg`). This project only decodes VP8/VP9 WebM and
  writes JPEG frames, so an LGPL build is fully sufficient.
- FFmpeg is invoked as a separate subprocess; it is not linked into the app.

### libvips — via `sharp` / `@img/sharp-libvips-*`
- License: **LGPL-3.0-or-later** — a prebuilt shared library loaded dynamically
  by `sharp`. Compatible with MIT distribution; the library remains replaceable.
- `sharp` itself is **Apache-2.0**.

### Other native modules
- `get-windows` — MIT
- `sharp` — Apache-2.0 (retain its `LICENSE` / `NOTICE`)

## Apache-2.0 components
Some dependencies (e.g. `sharp`) are Apache-2.0, which requires retaining their
copyright, license, and any `NOTICE` file contents. These are preserved under
`node_modules`.

## Generating a complete license manifest
For a full, per-package license listing at release time:

```sh
npx license-checker-rseidelsohn --production --files THIRD-PARTY-LICENSES
```
