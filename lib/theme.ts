// Theme values for Canvas code. Read from the CSS variables once into this small store and re-read
// only when a slider, preset or palette changes — never per frame (Invariant 5, AGENTS §3b-7, docs/08 §2).

export interface ChartTheme {
  chartBg: string;
  chartGrid: string;
  chartAxis: string;
  chartBorder: string;
  crosshair: string;
  candleUp: string;
  candleDown: string;
  profit: string;
  risk: string;
  boxActual: string;
  goldMid: string;
  goldLight: string;
  textPrimary: string;
  textMuted: string;
  surface: string;
  elevated: string;
  boxOpacity: number;
}

const NEUTRAL = "#888888";
let theme: ChartTheme | null = null;
const listeners = new Set<() => void>();

function read(): ChartTheme {
  const style = getComputedStyle(document.documentElement);
  const value = (name: string) => style.getPropertyValue(name).trim() || NEUTRAL;
  const opacity = Number.parseFloat(style.getPropertyValue("--position-box-opacity"));
  return {
    chartBg: value("--chart-bg"),
    chartGrid: value("--chart-grid"),
    chartAxis: value("--text-muted"),
    chartBorder: value("--chart-border"),
    crosshair: value("--chart-crosshair"),
    candleUp: value("--candle-up"),
    candleDown: value("--candle-down"),
    profit: value("--profit-emerald"),
    risk: value("--risk-crimson"),
    boxActual: value("--box-actual"),
    goldMid: value("--gold-mid"),
    goldLight: value("--gold-light"),
    textPrimary: value("--text-primary"),
    textMuted: value("--text-muted"),
    surface: value("--bg-surface"),
    elevated: value("--bg-elevated"),
    boxOpacity: Number.isFinite(opacity) ? opacity : 0.28,
  };
}

export function getTheme() {
  theme ??= read();
  return theme;
}

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
