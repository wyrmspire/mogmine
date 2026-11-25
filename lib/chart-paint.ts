// Paint helpers and design defaults for chart position zones (docs/design-2026-11-24/08 §4, §7.1).
// Pure functions, plus drawChip / zoneGradient which only use the context they are given.
// Runtime colours still come from the CSS variables that lib/theme.ts reads (Invariant 5). CHART_TOKENS
// is the documented default for the same values: tests pin it against app/globals.css and 08.

/** Token defaults, classic palette unless a `blueOrange` entry says otherwise (08 §4.1, §4.5). */
export const CHART_TOKENS = {
  surface: {
    bg: "#0B0E15", gridH: "rgba(255,255,255,0.045)", gridV: "rgba(255,255,255,0.025)",
    border: "rgba(255,255,255,0.08)", axisText: "#8B93A7", crosshair: "rgba(163,171,189,0.55)", crosshairLabel: "#232838",
  },
  candle: { up: "#22B88F", down: "#EC5664" },
  zone: {
    reward: "#22C39A", risk: "#F0545F",
    nearFactor: 0.55, farFactor: 0.85, planFactor: 0.4, cancelledFactor: 0.15, archivedMaxAlpha: 0.08,
    edgeActual: 0.9, edgePlan: 0.55,
  },
  line: { entry: "#C9CED8", labelMuted: "#A3ABBD", vwap: "#E879C6", vwapWidth: 1.5, bracketAlpha: 0.7 },
  chip: {
    reward: "#0F7A5F", risk: "#B8323F", neutral: "#2A3142", warn: "#8A5A12", ghost: "rgba(18,22,33,0.92)",
    text: "#FFFFFF", neutralText: "#E9ECF2", ghostText: "#C9CED8", height: 16, padX: 6, radius: 3,
  },
  blueOrange: {
    reward: "#4D8DFF", risk: "#F5873A", candleUp: "#4C8DFF", candleDown: "#F98A3C",
    chipReward: "#1F5FCF", chipRisk: "#A8480C", chipWarn: "#5B4A8A",
  },
} as const;

/** Dash patterns in px (08 §4.2). Dots are only for inferred values, drawn round-capped. */
export const DASH = {
  planned: [6, 4], inferred: [2, 3], working: [3, 3], archived: [3, 3], cancelled: [4, 4], ruler: [2, 4],
} as const;

export type LineStyleName = "solid" | "dashed" | "dotted";

export function dashFor(style: LineStyleName): number[] {
  return style === "dashed" ? [...DASH.planned] : style === "dotted" ? [...DASH.inferred] : [];
}

/** Snap a media-space coordinate so a line `width` px wide lands on whole device pixels (08 §7.1). */
export const crisp = (v: number, dpr: number, width = 1) =>
  (Math.round(v * dpr) + (Math.round(width * dpr) % 2 ? 0.5 : 0)) / dpr;

/** Chip width: text plus horizontal padding on both sides. */
export const chipWidth = (textWidth: number) => textWidth + 2 * CHART_TOKENS.chip.padX;

/** Fill alpha for a zone: Position Box Opacity times the token factor. Never mutates the tokens. */
export const zoneAlpha = (factor: number, boxOpacity: number) => factor * boxOpacity;

/** `#rrggbb` with an alpha. Other colour strings are returned unchanged. */
export function withAlpha(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return hex;
  const n = Number.parseInt(match[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.min(1, Math.max(0, alpha)).toFixed(3)})`;
}

/** Vertical gradient from the entry price (`fromY`) to the far price (`toY`), in media pixels. */
export function zoneGradient(
  ctx: CanvasRenderingContext2D, fromY: number, toY: number, color: string, nearAlpha: number, farAlpha: number,
): CanvasGradient {
  const gradient = ctx.createLinearGradient(0, fromY, 0, toY);
  gradient.addColorStop(0, withAlpha(color, nearAlpha));
  gradient.addColorStop(1, withAlpha(color, farAlpha));
  return gradient;
}

/** A rounded chip with a solid background. The caller places the text inside it. */
export function drawChip(
  ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number, fill: string,
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

export interface PaintRect { x: number; y: number; width: number; height: number }

/** The part of `a` not covered by `b`, as up to four rectangles. */
export function subtractRect(a: PaintRect, b: PaintRect): PaintRect[] {
  const aRight = a.x + a.width;
  const aBottom = a.y + a.height;
  const bRight = b.x + b.width;
  const bBottom = b.y + b.height;
  if (b.x >= aRight || bRight <= a.x || b.y >= aBottom || bBottom <= a.y) return [a];
  const pieces: PaintRect[] = [];
  const midTop = Math.max(a.y, b.y);
  const midHeight = Math.min(aBottom, bBottom) - midTop;
  if (b.y > a.y) pieces.push({ x: a.x, y: a.y, width: a.width, height: b.y - a.y });
  if (bBottom < aBottom) pieces.push({ x: a.x, y: bBottom, width: a.width, height: aBottom - bBottom });
  if (b.x > a.x) pieces.push({ x: a.x, y: midTop, width: b.x - a.x, height: midHeight });
  if (bRight < aRight) pieces.push({ x: bRight, y: midTop, width: aRight - bRight, height: midHeight });
  return pieces;
}

/** `a` with every rectangle in `cuts` removed. Used so plan fills never sit under an actual zone. */
export function subtractRects(a: PaintRect, cuts: readonly PaintRect[]): PaintRect[] {
  return cuts.reduce<PaintRect[]>((pieces, cut) => pieces.flatMap((piece) => subtractRect(piece, cut)), [a]);
}
