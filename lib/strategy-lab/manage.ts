// Management-plan schema, validation and owner presets (docs/design-2026-11-24/10 §3, TM-1). Pure data only.

import { LEVEL_KEYS } from "./levels.ts";
import type {
  CandlePattern, LevelKey, ManageAction, ManagePlan, ManageRule, ManageTrigger, TrailSpec,
} from "./types.ts";

export const MANAGE_PLAN_SCHEMA = "mogmine.manage-plan.v1" as const;
/** TM-3 fill convention: profit/target scale-outs are limits; rule exits use recipe market slippage. */
export const MANAGE_FILL_POLICY = { targetScaleOut: "limit", ruleExit: "market" } as const;

export interface ManagePlanIssue { path: string; message: string }
export type ManagePlanValidation =
  | { ok: true; plan: ManagePlan }
  | { ok: false; errors: ManagePlanIssue[] };

type Rec = Record<string, unknown>;
const isRecord = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const integer = (value: unknown, min: number, max: number): value is number =>
  Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
const text = (value: unknown): value is string => typeof value === "string" && value.length >= 1 && value.length <= 200;

const CANDLE_PATTERNS: readonly CandlePattern[] = [
  "engulfing-against", "close-against-prior-low", "inside-bar-break-against",
];
const HTF = ["5m", "15m"] as const;
const ALL_TF = ["1m", "5m", "15m"] as const;

function trigger(value: unknown, path: string, errors: ManagePlanIssue[]): ManageTrigger | null {
  if (!isRecord(value) || typeof value.kind !== "string") {
    errors.push({ path, message: "trigger must be an object with a kind" }); return null;
  }
  if (value.kind === "always" || value.kind === "scaledOut") return { kind: value.kind };
  if (value.kind === "profitR" || value.kind === "profitPoints") {
    if (!finite(value.atLeast) || value.atLeast < 0) errors.push({ path: `${path}.atLeast`, message: "atLeast must be zero or above" });
    else return { kind: value.kind, atLeast: value.atLeast };
    return null;
  }
  if (value.kind === "afterMinutes") {
    if (!integer(value.minutes, 0, 1440)) errors.push({ path: `${path}.minutes`, message: "minutes must be a whole number from 0 to 1440" });
    else return { kind: value.kind, minutes: value.minutes };
    return null;
  }
  if (value.kind === "candle") {
    if (!(HTF as readonly unknown[]).includes(value.tf)) errors.push({ path: `${path}.tf`, message: 'tf must be "5m" or "15m"' });
    if (!(CANDLE_PATTERNS as readonly unknown[]).includes(value.pattern)) errors.push({ path: `${path}.pattern`, message: "pattern must be a known candle pattern" });
    return errors.some((e) => e.path.startsWith(path)) ? null : { kind: value.kind, tf: value.tf as "5m" | "15m", pattern: value.pattern as CandlePattern };
  }
  if (value.kind === "closeBeyond") {
    if (!(ALL_TF as readonly unknown[]).includes(value.tf)) errors.push({ path: `${path}.tf`, message: 'tf must be "1m", "5m" or "15m"' });
    const refs = ["vwap", "ema", ...LEVEL_KEYS] as readonly unknown[];
    if (!refs.includes(value.ref)) errors.push({ path: `${path}.ref`, message: "ref must be vwap, ema or a known level key" });
    return errors.some((e) => e.path.startsWith(path)) ? null : {
      kind: value.kind,
      tf: value.tf as "1m" | "5m" | "15m",
      ref: value.ref as "vwap" | "ema" | LevelKey,
    };
  }
  if (value.kind === "volumeClimax") {
    if (value.tf !== "1m" && value.tf !== "5m") errors.push({ path: `${path}.tf`, message: 'tf must be "1m" or "5m"' });
    if (!finite(value.multiple) || value.multiple <= 0) errors.push({ path: `${path}.multiple`, message: "multiple must be above zero" });
    if (typeof value.against !== "boolean") errors.push({ path: `${path}.against`, message: "against must be true or false" });
    return errors.some((e) => e.path.startsWith(path)) ? null : { kind: value.kind, tf: value.tf as "1m" | "5m", multiple: value.multiple as number, against: value.against as boolean };
  }
  errors.push({ path: `${path}.kind`, message: `Unknown trigger kind "${value.kind}"` });
  return null;
}

function trail(value: unknown, path: string, errors: ManagePlanIssue[]): TrailSpec | null {
  if (!isRecord(value) || typeof value.mode !== "string") { errors.push({ path, message: "trail must be an object with a mode" }); return null; }
  if (value.mode === "givebackPct" || value.mode === "pricePct") {
    if (!finite(value.pct) || value.pct <= 0 || value.pct > 100) errors.push({ path: `${path}.pct`, message: "pct must be above 0 and at most 100" });
    else return { mode: value.mode, pct: value.pct };
  } else if (value.mode === "points" || value.mode === "r") {
    const key = value.mode === "points" ? "points" : "r";
    if (!finite(value[key]) || (value[key] as number) <= 0) errors.push({ path: `${path}.${key}`, message: `${key} must be above zero` });
    else return value.mode === "points" ? { mode: value.mode, points: value.points as number } : { mode: value.mode, r: value.r as number };
  } else if (value.mode === "candleLow") {
    if (!(ALL_TF as readonly unknown[]).includes(value.tf)) errors.push({ path: `${path}.tf`, message: 'tf must be "1m", "5m" or "15m"' });
    if (!integer(value.bars, 1, 240)) errors.push({ path: `${path}.bars`, message: "bars must be a whole number from 1 to 240" });
    if (!integer(value.ticks, 0, 1000)) errors.push({ path: `${path}.ticks`, message: "ticks must be a whole number from 0 to 1000" });
    if (!errors.some((e) => e.path.startsWith(path))) return { mode: value.mode, tf: value.tf as "1m" | "5m" | "15m", bars: value.bars as number, ticks: value.ticks as number };
  } else if (value.mode === "wick") {
    if (!(HTF as readonly unknown[]).includes(value.tf)) errors.push({ path: `${path}.tf`, message: 'tf must be "5m" or "15m"' });
    if (value.part !== "extreme" && value.part !== "half") errors.push({ path: `${path}.part`, message: 'part must be "extreme" or "half"' });
    if (!integer(value.ticks, 0, 1000)) errors.push({ path: `${path}.ticks`, message: "ticks must be a whole number from 0 to 1000" });
    if (!errors.some((e) => e.path.startsWith(path))) return { mode: value.mode, tf: value.tf as "5m" | "15m", part: value.part as "extreme" | "half", ticks: value.ticks as number };
  } else if (value.mode === "ref") {
    if (value.ref !== "vwap" && value.ref !== "ema") errors.push({ path: `${path}.ref`, message: 'ref must be "vwap" or "ema"' });
    if (!integer(value.ticks, 0, 1000)) errors.push({ path: `${path}.ticks`, message: "ticks must be a whole number from 0 to 1000" });
    if (!errors.some((e) => e.path.startsWith(path))) return { mode: value.mode, ref: value.ref as "vwap" | "ema", ticks: value.ticks as number };
  } else errors.push({ path: `${path}.mode`, message: `Unknown trail mode "${value.mode}"` });
  return null;
}

function action(value: unknown, path: string, errors: ManagePlanIssue[]): ManageAction | null {
  if (!isRecord(value) || typeof value.kind !== "string") { errors.push({ path, message: "action must be an object with a kind" }); return null; }
  if (value.kind === "exitAll") return { kind: value.kind };
  if (value.kind === "scaleOut") {
    if (!finite(value.fraction) || value.fraction <= 0 || value.fraction >= 1) errors.push({ path: `${path}.fraction`, message: "fraction must be above 0 and below 1" });
    else return { kind: value.kind, fraction: value.fraction };
  } else if (value.kind === "stopTo") {
    if (value.to !== "breakeven") errors.push({ path: `${path}.to`, message: 'to must be "breakeven"' });
    const offset = value.offsetTicks ?? 0;
    if (!integer(offset, -1000, 1000)) errors.push({ path: `${path}.offsetTicks`, message: "offsetTicks must be a whole number" });
    if (!errors.some((e) => e.path.startsWith(path))) return { kind: value.kind, to: "breakeven", offsetTicks: offset as number };
  } else if (value.kind === "trail") {
    const by = trail(value.by, `${path}.by`, errors);
    if (by) return { kind: value.kind, by };
  } else errors.push({ path: `${path}.kind`, message: `Unknown action kind "${value.kind}"` });
  return null;
}

/** Validates parsed JSON/editor data, fills schema/version/once defaults, and returns detached objects. */
export function validateManagePlan(input: unknown): ManagePlanValidation {
  if (!isRecord(input)) return { ok: false, errors: [{ path: "", message: "Manage plan must be an object" }] };
  const errors: ManagePlanIssue[] = [];
  if (input.schema !== undefined && input.schema !== MANAGE_PLAN_SCHEMA) errors.push({ path: "schema", message: `schema must be "${MANAGE_PLAN_SCHEMA}"` });
  if (!text(input.id)) errors.push({ path: "id", message: "id must be 1–200 characters" });
  if (!integer(input.version ?? 1, 1, 1_000_000)) errors.push({ path: "version", message: "version must be a whole number from 1" });
  if (!text(input.name)) errors.push({ path: "name", message: "name must be 1–200 characters" });
  const rules: ManageRule[] = [];
  if (!Array.isArray(input.rules)) errors.push({ path: "rules", message: "rules must be a list" });
  else input.rules.forEach((rule, index) => {
    const path = `rules[${index}]`;
    if (!isRecord(rule)) { errors.push({ path, message: "rule must be an object" }); return; }
    const when = trigger(rule.when, `${path}.when`, errors);
    const then = action(rule.then, `${path}.then`, errors);
    if (rule.once !== undefined && typeof rule.once !== "boolean") errors.push({ path: `${path}.once`, message: "once must be true or false" });
    if (when && then && (rule.once === undefined || typeof rule.once === "boolean")) rules.push({ when, then, once: (rule.once ?? true) as boolean });
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, plan: { schema: MANAGE_PLAN_SCHEMA, id: input.id as string, version: (input.version ?? 1) as number, name: input.name as string, rules } };
}

const PRESETS: readonly ManagePlan[] = [
  { schema: MANAGE_PLAN_SCHEMA, id: "fixed-bracket", version: 1, name: "Fixed bracket", rules: [] },
  { schema: MANAGE_PLAN_SCHEMA, id: "be-at-1r", version: 1, name: "BE at 1R", rules: [{ when: { kind: "profitR", atLeast: 1 }, then: { kind: "stopTo", to: "breakeven" } }] },
  { schema: MANAGE_PLAN_SCHEMA, id: "half-at-1r-be-run", version: 1, name: "Half at 1R, BE, run", rules: [
    { when: { kind: "profitR", atLeast: 1 }, then: { kind: "scaleOut", fraction: 0.5 } },
    { when: { kind: "scaledOut" }, then: { kind: "stopTo", to: "breakeven" } },
    { when: { kind: "scaledOut" }, then: { kind: "trail", by: { mode: "candleLow", tf: "5m", bars: 1, ticks: 0 } } },
  ] },
  { schema: MANAGE_PLAN_SCHEMA, id: "trail-30-giveback", version: 1, name: "Trail 30% giveback", rules: [{ when: { kind: "profitR", atLeast: 0.5 }, then: { kind: "trail", by: { mode: "givebackPct", pct: 30 } } }] },
  { schema: MANAGE_PLAN_SCHEMA, id: "15m-engulfing-exit", version: 1, name: "15m engulfing exit", rules: [{ when: { kind: "candle", tf: "15m", pattern: "engulfing-against" }, then: { kind: "exitAll" } }] },
  { schema: MANAGE_PLAN_SCHEMA, id: "5m-engulfing-exit", version: 1, name: "5m engulfing exit", rules: [{ when: { kind: "candle", tf: "5m", pattern: "engulfing-against" }, then: { kind: "exitAll" } }] },
  { schema: MANAGE_PLAN_SCHEMA, id: "trail-15m-wicks-half", version: 1, name: "Trail 15m wicks (half)", rules: [{ when: { kind: "profitR", atLeast: 1 }, then: { kind: "trail", by: { mode: "wick", tf: "15m", part: "half", ticks: 1 } } }] },
  { schema: MANAGE_PLAN_SCHEMA, id: "volume-climax-out", version: 1, name: "Volume climax out", rules: [{ when: { kind: "volumeClimax", tf: "1m", multiple: 3, against: true }, then: { kind: "exitAll" } }] },
];

/** The eight owner presets as fresh, independently editable JSON objects. */
export function ownerManagePresets(): ManagePlan[] {
  return JSON.parse(JSON.stringify(PRESETS)) as ManagePlan[];
}
