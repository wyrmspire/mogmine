// UX-E4: pure sizing for Trade Card chart exports (docs/design-2026-11-24/08 §2 F-9, §7.3).
// A DPR-1 chart screenshot is only ~1x of the card, so the card upscales it soft. Export at >= 2x instead.

/** Target minimum bitmap width: a 4:5 card (1080px) and a 16:9 chart area (1920px) never upscale below this. */
export const EXPORT_MIN_BITMAP_WIDTH = 1200;

export interface ExportDimensions {
  resize: boolean;
  width: number;
  height: number;
}

/**
 * CSS size to resize the chart to before `takeScreenshot`, so the bitmap is at least `minBitmapWidth` wide.
 * Returns the host size unchanged when the host already renders wide enough, or when it has no size yet.
 */
export function computeExportDimensions(
  hostWidth: number,
  hostHeight: number,
  dpr: number,
  minBitmapWidth = EXPORT_MIN_BITMAP_WIDTH,
): ExportDimensions {
  if (hostWidth <= 0 || hostHeight <= 0) return { resize: false, width: hostWidth, height: hostHeight };
  if (hostWidth * dpr >= minBitmapWidth) return { resize: false, width: hostWidth, height: hostHeight };
  const factor = Math.min(3, Math.max(2, Math.ceil(minBitmapWidth / (hostWidth * Math.max(1, dpr)))));
  return {
    resize: true,
    width: Math.round(hostWidth * factor),
    height: Math.round(hostHeight * factor),
  };
}

export interface SnapshotDrawBox {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/** Aspect-preserving placement of a snapshot, centred inside the available box. */
export function computeSnapshotDrawBox(
  availX: number,
  availY: number,
  availW: number,
  availH: number,
  snapW: number,
  snapH: number,
): SnapshotDrawBox {
  if (snapW <= 0 || snapH <= 0) return { dx: availX, dy: availY, dw: 0, dh: 0 };
  const scale = Math.min(availW / snapW, availH / snapH);
  const dw = snapW * scale;
  const dh = snapH * scale;
  return { dx: availX + (availW - dw) / 2, dy: availY + (availH - dh) / 2, dw, dh };
}
