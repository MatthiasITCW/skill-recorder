const RECORDER_MIN_HEIGHT = 320;
const RECORDER_MAX_HEIGHT = 720;

export interface RecorderWindowSizingTarget {
  isDestroyed(): boolean;
  getContentSize(): number[];
  getSize(): number[];
  isResizable(): boolean;
  setResizable(resizable: boolean): void;
  setSize(width: number, height: number, animate?: boolean): void;
}

/**
 * Fit the recorder to its rendered content while preserving its fixed outer width.
 * Windows changes the non-client frame thickness when resizability is toggled, so
 * feeding a content width measured before that toggle into `setContentSize` grows
 * the outer window on every ResizeObserver callback.
 */
export function fitRecorderHeight(
  win: RecorderWindowSizingTarget,
  contentHeight: number,
): void {
  if (win.isDestroyed() || !Number.isFinite(contentHeight)) return;

  const targetContentHeight = Math.round(
    Math.max(RECORDER_MIN_HEIGHT, Math.min(RECORDER_MAX_HEIGHT, contentHeight)),
  );
  const [, currentContentHeight] = win.getContentSize();
  if (Math.abs(currentContentHeight - targetContentHeight) < 1) return;

  const [outerWidth, outerHeight] = win.getSize();
  const targetOuterHeight = outerHeight + targetContentHeight - currentContentHeight;
  const wasResizable = win.isResizable();
  if (!wasResizable) win.setResizable(true);
  try {
    win.setSize(outerWidth, targetOuterHeight);
  } finally {
    if (!wasResizable && !win.isDestroyed()) win.setResizable(false);
  }
}
