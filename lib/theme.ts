// Theme values for Canvas code. Read from the CSS variables once into this small store and re-read
// only when a slider, preset or palette changes — never per frame (Invariant 5, AGENTS §3b-7, docs/08 §2).
import { withAlpha } from "./chart-paint.ts";

export interface ChartTheme {
  chartBg: string;
  gridH: string;
  gridV: string;
  chartAxis: string;
  chartBorder: string;
  crosshair: string;
  candleUp: string;
  candleDown: string;
  /** Volume pane bars (`--chart-volume-up`/`-down`, VOL-1): candle colours at alpha 0.35. Optional: literal themes omit them. */
  volumeUp?: string;
  volumeDown?: string;
  profit: string;
  risk: string;
  profitText: string;
  lossText: string;
  boxActual: string;
  boxPlanned: string;
  goldMid: string;
  goldLight: string;
  textPrimary: string;
  textMuted: string;
  surface: string;
  elevated: string;
  boxOpacity: number;
  levelResistance: string;
  levelSupport: string;
  levelAdr: string;
  levelNeutral: string;
  levelLabelText: string;
  /** Opacity of the level pill's background over the chart (`--level-label-bg-alpha`, LB-2). Optional: literal themes (shareCard) omit it and paint at 0.95. */
  levelLabelBgAlpha?: number;
  vwap: string;
  /** Session VWAP ±1σ / ±2σ band colours derived from `--indicator-vwap`. Optional: literal themes omit them. */
  vwapBand1?: string;
  vwapBand2?: string;
  /** 200 EMA line (`--ind-ema200`, IN-3). Optional: literal themes (shareCard) omit it and the chart uses its fallback. */
  ema200?: string;
  /** Chart surface and label tokens (docs/design-2026-11-24/08 §4.1). */
  crosshairLabel: string;
  zoneReward: string;
  zoneRisk: string;
  entryLine: string;
  labelMuted: string;
  chipReward: string;
  chipRisk: string;
  chipNeutral: string;
  chipWarn: string;
  chipGhost: string;
  fontMono: string;
  fontSans: string;
}

const NEUTRAL = "#888888";
let theme: ChartTheme | null = null;
const listeners = new Set<() => void>();

function read(): ChartTheme {
  const style = getComputedStyle(document.documentElement);
  const value = (name: string) => style.getPropertyValue(name).trim() || NEUTRAL;
  const opacity = Number.parseFloat(style.getPropertyValue("--position-box-opacity"));
  const labelAlpha = Number.parseFloat(style.getPropertyValue("--level-label-bg-alpha"));
  const vwap = value("--indicator-vwap");
  return {
    chartBg: value("--chart-bg"),
    gridH: value("--chart-grid-h"),
    gridV: value("--chart-grid-v"),
    chartAxis: value("--chart-axis-text"),
    chartBorder: value("--chart-border"),
    crosshair: value("--chart-crosshair"),
    candleUp: value("--candle-up"),
    candleDown: value("--candle-down"),
    volumeUp: value("--chart-volume-up"),
    volumeDown: value("--chart-volume-down"),
    profit: value("--profit-emerald"),
    risk: value("--risk-crimson"),
    profitText: value("--profit-text"),
    lossText: value("--loss-text"),
    boxActual: value("--box-actual"),
    boxPlanned: value("--box-planned"),
    goldMid: value("--gold-mid"),
    goldLight: value("--gold-light"),
    textPrimary: value("--text-primary"),
    textMuted: value("--text-muted"),
    surface: value("--bg-surface"),
    elevated: value("--bg-elevated"),
    boxOpacity: Number.isFinite(opacity) ? opacity : 0.28,
    levelResistance: value("--level-resistance"),
    levelSupport: value("--level-support"),
    levelAdr: value("--level-adr"),
    levelNeutral: value("--level-neutral"),
    levelLabelText: value("--level-label-text"),
    levelLabelBgAlpha: Number.isFinite(labelAlpha) ? labelAlpha : 0.95,
    vwap,
    vwapBand1: withAlpha(vwap, 0.42),
    vwapBand2: withAlpha(vwap, 0.24),
    ema200: value("--ind-ema200"),
    crosshairLabel: value("--chart-crosshair-label"),
    zoneReward: value("--zone-reward"),
    zoneRisk: value("--zone-risk"),
    entryLine: value("--chart-entry-line"),
    labelMuted: value("--chart-label-muted"),
    chipReward: value("--chip-reward-bg"),
    chipRisk: value("--chip-risk-bg"),
    chipNeutral: value("--chip-neutral-bg"),
    chipWarn: value("--chip-warn-bg"),
    chipGhost: value("--chip-ghost-bg"),
    fontMono: value("--font-mono"),
    fontSans: value("--font-sans"),
  };
}

export function vwapBandColors(t: Pick<ChartTheme, "vwap" | "vwapBand1" | "vwapBand2">) {
  return {
    band1: t.vwapBand1 ?? withAlpha(t.vwap, 0.42),
    band2: t.vwapBand2 ?? withAlpha(t.vwap, 0.24),
  };
}

export function getTheme() {
  theme ??= read();
  return theme;
}

// Canvas text uses the next/font families, which load after first paint (display: swap). Re-read then.
if (typeof document !== "undefined") void document.fonts?.ready.then(() => refreshTheme());

/** Call after any change to the theme variables. Subscribers redraw. */
export function refreshTheme() {
  if (typeof document === "undefined") return;
  theme = read();
  listeners.forEach((listener) => listener());
}

export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
