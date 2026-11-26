// Pure indicator registry and persisted instance model (IK-2). UI and chart code consume this contract;
// definitions never import React, lightweight-charts, storage, or browser globals.
export type IndicatorId = "vwap" | "ema" | "volume" | "session-levels";
export type IndicatorCategory = "Trend" | "Volume" | "Levels";
export type IndicatorLineStyle = "solid" | "dashed" | "dotted";
export type IndicatorColor = `theme:${string}` | `#${string}`;

export type IndicatorParam =
  | { type: "number"; title: string; default: number; min: number; max: number; step: number }
  | { type: "boolean"; title: string; default: boolean }
  | { type: "select"; title: string; default: string; options: readonly { value: string; title: string }[] }
  | { type: "number-list"; title: string; default: readonly number[]; min: number; max: number; maxItems: number };

export interface IndicatorLineSlot {
  kind: "line";
  title: string;
  color: IndicatorColor;
  width: number;
  style: IndicatorLineStyle;
  visible: boolean;
}

export interface IndicatorFillSlot {
  kind: "fill" | "background";
  title: string;
  color: IndicatorColor;
  opacity: number;
  visible: boolean;
}

export interface IndicatorDefinition {
  id: IndicatorId;
  title: string;
  category: IndicatorCategory;
  description: string;
  params: Readonly<Record<string, IndicatorParam>>;
  style: Readonly<Record<string, IndicatorLineSlot | IndicatorFillSlot>>;
  labelsDefault: boolean;
}

export interface IndicatorInstance {
  instanceId: string;
  indicatorId: IndicatorId;
  visible: boolean;
  params: Record<string, boolean | number | string | number[]>;
  style: Record<string, IndicatorLineSlot | IndicatorFillSlot>;
  labels: boolean;
}

export const INDICATOR_REGISTRY: readonly IndicatorDefinition[] = [
  {
    id: "vwap", title: "VWAP", category: "Volume", description: "Volume-weighted average price with optional deviation bands.",
    params: {
      anchor: { type: "select", title: "Anchor", default: "rth", options: [
        { value: "rth", title: "RTH · 09:30 ET" }, { value: "globex", title: "Globex · 18:00 ET" }, { value: "week", title: "Week · Sunday 18:00 ET" },
      ] },
      bandMultiples: { type: "number-list", title: "Band multiples", default: [1, 2], min: 0.25, max: 10, maxItems: 4 },
    },
    style: {
      main: { kind: "line", title: "VWAP", color: "theme:vwap", width: 1, style: "solid", visible: true },
      bands: { kind: "line", title: "Bands", color: "theme:vwap", width: 1, style: "dashed", visible: true },
      bandFill: { kind: "fill", title: "Band fill", color: "theme:vwap", opacity: 0.1, visible: false },
    }, labelsDefault: true,
  },
  {
    id: "ema", title: "EMA", category: "Trend", description: "Exponential moving average on the displayed timeframe.",
    params: {
      length: { type: "number", title: "Length", default: 200, min: 2, max: 500, step: 1 },
      source: { type: "select", title: "Source", default: "close", options: [
        { value: "close", title: "Close" }, { value: "open", title: "Open" }, { value: "high", title: "High" }, { value: "low", title: "Low" }, { value: "hlc3", title: "HLC3" },
      ] },
    },
    style: { main: { kind: "line", title: "EMA", color: "theme:ema", width: 1, style: "solid", visible: true } }, labelsDefault: true,
  },
  {
    id: "volume", title: "Volume", category: "Volume", description: "Traded volume histogram below price.",
    params: {},
    style: { bars: { kind: "background", title: "Bars", color: "theme:volume", opacity: 0.56, visible: true } }, labelsDefault: false,
  },
  {
    id: "session-levels", title: "Session levels", category: "Levels", description: "Computed and planned session price levels.",
    params: { labelMode: { type: "select", title: "Labels", default: "tap", options: [{ value: "tap", title: "Show on tap" }, { value: "always", title: "Always" }] } },
    style: { rays: { kind: "line", title: "Rays", color: "theme:role", width: 1, style: "solid", visible: true } }, labelsDefault: true,
  },
] as const;

const byId = new Map(INDICATOR_REGISTRY.map((definition) => [definition.id, definition]));
export function indicatorDefinition(id: IndicatorId) { return byId.get(id)!; }

function cloneSlot(slot: IndicatorLineSlot | IndicatorFillSlot): IndicatorLineSlot | IndicatorFillSlot {
  return { ...slot };
}

export function createIndicatorInstance(id: IndicatorId, instanceId = `${id}-${cryptoId()}`): IndicatorInstance {
  const definition = indicatorDefinition(id);
  return {
    instanceId, indicatorId: id, visible: true, labels: definition.labelsDefault,
    params: Object.fromEntries(Object.entries(definition.params).map(([key, param]) => [key, param.type === "number-list" ? [...param.default] : param.default])) as IndicatorInstance["params"],
    style: Object.fromEntries(Object.entries(definition.style).map(([key, slot]) => [key, cloneSlot(slot)])),
  };
}

let idCounter = 0;
function cryptoId() {
  const random = globalThis.crypto?.randomUUID?.();
  return random ?? `${Date.now().toString(36)}-${(++idCounter).toString(36)}`;
}

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const validColor = (value: unknown, fallback: IndicatorColor): IndicatorColor => typeof value === "string" && (/^#[0-9a-f]{6}$/i.test(value) || /^theme:[a-z-]+$/i.test(value)) ? value as IndicatorColor : fallback;

export function sanitizeIndicatorInstance(raw: unknown): IndicatorInstance | null {
  if (!isObject(raw) || typeof raw.indicatorId !== "string" || !byId.has(raw.indicatorId as IndicatorId)) return null;
  const definition = indicatorDefinition(raw.indicatorId as IndicatorId);
  const paramsRaw = isObject(raw.params) ? raw.params : {};
  const styleRaw = isObject(raw.style) ? raw.style : {};
  const instance = createIndicatorInstance(definition.id, typeof raw.instanceId === "string" && raw.instanceId.trim() ? raw.instanceId.slice(0, 80) : `${definition.id}-restored`);
  instance.visible = raw.visible !== false;
  instance.labels = typeof raw.labels === "boolean" ? raw.labels : definition.labelsDefault;
  for (const [key, param] of Object.entries(definition.params)) {
    const value = paramsRaw[key];
    if (param.type === "boolean") instance.params[key] = typeof value === "boolean" ? value : param.default;
    else if (param.type === "select") instance.params[key] = param.options.some((option) => option.value === value) ? value as string : param.default;
    else if (param.type === "number") instance.params[key] = typeof value === "number" && Number.isFinite(value) ? clamp(value, param.min, param.max) : param.default;
    else {
      const values = Array.isArray(value) ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item)).map((item) => clamp(item, param.min, param.max)) : [];
      instance.params[key] = [...new Set(values)].sort((a, b) => a - b).slice(0, param.maxItems);
      if (!(instance.params[key] as number[]).length) instance.params[key] = [...param.default];
    }
  }
  for (const [key, fallback] of Object.entries(definition.style)) {
    const candidate = isObject(styleRaw[key]) ? styleRaw[key] : {};
    if (fallback.kind === "line") instance.style[key] = {
      ...fallback,
      color: validColor(candidate.color, fallback.color),
      width: typeof candidate.width === "number" ? Math.round(clamp(candidate.width, 1, 4)) : fallback.width,
      style: candidate.style === "dashed" || candidate.style === "dotted" || candidate.style === "solid" ? candidate.style : fallback.style,
      visible: candidate.visible !== false,
    };
    else instance.style[key] = {
      ...fallback,
      color: validColor(candidate.color, fallback.color),
      opacity: typeof candidate.opacity === "number" ? clamp(candidate.opacity, 0, 1) : fallback.opacity,
      visible: candidate.visible !== false,
    };
  }
  return instance;
}

export interface LegacyIndicatorPrefs {
  vwapAnchor?: unknown; vwapBands?: unknown; vwapBandMultiples?: unknown; vwapBandFill?: unknown; weeklyVwap?: unknown;
  ema200?: unknown; showVolume?: unknown; levelLabels?: unknown; showLevels?: unknown;
}

/** One-time migration when `indicators` is absent. Every legacy choice becomes an instance, including hidden ones. */
export function migrateLegacyIndicators(raw: LegacyIndicatorPrefs): IndicatorInstance[] {
  const levels = createIndicatorInstance("session-levels", "session-levels-default");
  levels.visible = raw.showLevels !== false;
  levels.params.labelMode = raw.levelLabels === "always" ? "always" : "tap";
  const volume = createIndicatorInstance("volume", "volume-default");
  volume.visible = raw.showVolume !== false;
  const ema = createIndicatorInstance("ema", "ema-200");
  ema.visible = raw.ema200 === true;
  const session = createIndicatorInstance("vwap", "vwap-session");
  session.visible = raw.vwapAnchor === "rth" || raw.vwapAnchor === "globex";
  session.params.anchor = raw.vwapAnchor === "rth" ? "rth" : "globex";
  session.params.bandMultiples = Array.isArray(raw.vwapBandMultiples) ? raw.vwapBandMultiples : [1, 2];
  session.style.bands.visible = raw.vwapBands !== false;
  session.style.bandFill.visible = raw.vwapBandFill === true;
  const result = [levels, session];
  if (raw.weeklyVwap === true) {
    const weekly = createIndicatorInstance("vwap", "vwap-week");
    weekly.params.anchor = "week";
    weekly.params.bandMultiples = Array.isArray(raw.vwapBandMultiples) ? raw.vwapBandMultiples : [1, 2];
    weekly.style.bands.visible = raw.vwapBands !== false;
    weekly.style.bandFill.visible = raw.vwapBandFill === true;
    result.push(weekly);
  }
  result.push(ema, volume);
  return result.map((item) => sanitizeIndicatorInstance(item)!);
}

export function sanitizeIndicatorInstances(raw: unknown, legacy: LegacyIndicatorPrefs = {}): IndicatorInstance[] {
  if (!Array.isArray(raw)) return migrateLegacyIndicators(legacy);
  const seen = new Set<string>();
  return raw.slice(0, 24).flatMap((item) => {
    const clean = sanitizeIndicatorInstance(item);
    if (!clean || seen.has(clean.instanceId)) return [];
    seen.add(clean.instanceId);
    return [clean];
  });
}

export function resetIndicatorInstance(instance: IndicatorInstance) {
  return createIndicatorInstance(instance.indicatorId, instance.instanceId);
}
