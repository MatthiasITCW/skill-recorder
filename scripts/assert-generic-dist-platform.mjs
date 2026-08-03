if (process.platform === "win32") {
  throw new Error(
    `Use npm run dist:win:${process.arch} on Windows so Electron and native optional dependencies have the same architecture.`,
  );
}

if (process.platform !== "darwin") {
  throw new Error(
    `${process.platform} is not a supported release target. Supported targets are Windows x64, Windows arm64, and macOS arm64; other platforms install from source (see INSTALL.md).`,
  );
}

if (process.arch !== "arm64") {
  throw new Error(
    `macOS ${process.arch} is not a supported release target; only macOS arm64 is distributed.`,
  );
}
