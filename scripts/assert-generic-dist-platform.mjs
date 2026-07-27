if (process.platform === "win32") {
  throw new Error(
    `Use npm run dist:win:${process.arch} on Windows so Electron and native optional dependencies have the same architecture.`,
  );
}
