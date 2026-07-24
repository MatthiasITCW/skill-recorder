/** Minimal tagged logger. Replaced/extended when telemetry lands. */
export function createLogger(tag: string) {
  const prefix = `[${tag}]`;
  return {
    info: (...args: unknown[]) => console.log(prefix, ...args),
    warn: (...args: unknown[]) => console.warn(prefix, ...args),
    error: (...args: unknown[]) => console.error(prefix, ...args),
  };
}
