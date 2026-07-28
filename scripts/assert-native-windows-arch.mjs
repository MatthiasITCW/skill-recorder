const requestedArch = process.argv[2];
if (requestedArch !== "x64" && requestedArch !== "arm64") {
  throw new Error("Usage: node scripts/assert-native-windows-arch.mjs <x64|arm64>");
}

if (process.platform !== "win32" || process.arch !== requestedArch) {
  throw new Error(
    `Windows ${requestedArch} packages must be built with ${requestedArch} Node.js on ${requestedArch} Windows. ` +
      `The current host is ${process.platform}-${process.arch}; cross-packaging would embed native dependencies for the wrong architecture.`,
  );
}
