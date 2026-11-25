/**
 * Context Card rows (SL-7). Pure. Turns the registered skills' values at the decision bar into the five card
 * groups of docs/design-2026-11-24/09 §12.2. The assembly, state and public API live in `context-card.ts`.
 * A missing value is a named skipped row (its skip reason), never NaN text and never zero.
 */
import { clockText } from "./et-clock.ts";
import { LEVEL_KEYS, LEVEL_LABELS } from "./levels.ts";
import { getSkill, SKILLS } from "./registry.ts";
import type {
  LabLevel, LevelBook, LevelKey, SkillContext, SkillMeta, SkillResult, SkipReason, Value,
} from "./types.ts";

export type CardSide = "long" | "short";
export type CardGroupId = "candle" | "levels" | "stops" | "ranges" | "volume";
export type CardWhen = "at-mark" | "after-mark";

/** The mark as the trader enters it: an ET calendar date, a minute of the day (0–1439) and a price. */
export interface CardMark {
  date: string;
  minuteOfDay: number;
  price: number;
  side: CardSide;
}

/** R as resolved by `labRSize`: the dollar size, its basis, and the account name when it came from an account. */
export interface CardRSize {
  usd: number;
  source: "account" | "default";
  accountName: string | null;
}

export interface CardSpec { symbol: string; tickSize: number; pointValueUsd: number }

export interface CardRow {
  key: string;
  label: string;
  value: string | null;
  note?: string;
  when: CardWhen;
  /** Registry reference of the skill that produced the value, e.g. `structureStop@1`. */
  skill: string;
  status: "ok" | "skipped";
  reason?: SkipReason | "no-value";
  detail?: string;
  /** The ⓘ text: the skill's definition and version (title and version only under Shield). */
  info: string;
  proxy?: boolean;
}

export interface CardGroup {
  id: CardGroupId;
  title: string;
  open: boolean;
  rows: CardRow[];
}

export const MES_CARD_SPEC: CardSpec = { symbol: "MES", tickSize: 0.25, pointValueUsd: 5 };
/** Facts up to this many 1m bars after the mark may be shown in the "after the mark" sub-row. Never used for Find similar. */
export const AFTER_MARK_BARS = 60;
export const BAR_MS = 60_000;
/** Shown in place of any number that does not exist (no prior session, no volume, no level). */
export const GAP = "—";

const MINUS = "−";
/** A finite number as text, or the gap mark. */
export const fmt = (value: number | null | undefined, digits = 2) => (
  typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : GAP
);
const signed = (value: number | null, digits = 2) => (
  value === null || !Number.isFinite(value) ? GAP : `${value > 0 ? "+" : value < 0 ? MINUS : ""}${fmt(Math.abs(value), digits)}`
);
const pctile = (value: number | null) => (value === null || !Number.isFinite(value) ? `p${GAP}` : `p${Math.round(value)}`);
const ARROW: Record<string, string> = { up: "▲", down: "▼", flat: "■", positive: "▲", negative: "▼" };
const titleCase = (text: string) => text.replace(/-/g, " ");
const textOf = (value: Value | undefined) => (typeof value === "string" ? value : "");

export function numberOf(value: Value | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Joins note parts, dropping empty parts and any part that shows a gap. */
export function joinNote(...parts: Array<string | null | undefined | false>): string | undefined {
  const kept = parts.filter((part): part is string => typeof part === "string" && part !== "" && !part.includes(GAP));
  return kept.length > 0 ? kept.join(" · ") : undefined;
}

export interface Run { ref: string; skill: { meta: SkillMeta }; result: SkillResult }

/** Run one registered skill at the context's index, preflight first. Never throws for missing data. */
export function runSkill(ctx: SkillContext, id: string, params: Record<string, Value> = {}): Run {
  const skill = getSkill(id, SKILLS);
  if (!skill) throw new Error(`Unknown Strategy Lab skill: ${id}`);
  const ref = `${skill.meta.id}@${skill.meta.version.split(".")[0]}`;
  const preflight = skill.preflight({ ...ctx, params });
  const result: SkillResult = preflight.ok
    ? skill.compute({ ...ctx, params })
    : { ok: false, reason: preflight.reason, detail: preflight.detail };
  return { ref, skill, result };
}

/**
 * The ⓘ text. Under Shield it is the title and version only: some skill definitions name dollar units
 * (levelMap's "$ per contract"), and Shield means no dollar sign anywhere on the card.
 */
export function infoText(meta: SkillMeta, shield: boolean): string {
  return shield ? `${meta.title} · v${meta.version}` : `${meta.description} (v${meta.version})`;
}

interface Cell { value: string; note?: string; proxy?: boolean }

interface RowSpec {
  key: string;
  label: string;
  /** Dollar rows are dropped entirely under Shield. */
  usd?: boolean;
  format: (values: Record<string, Value>) => Cell | null;
}

/** One row from a skill run. A missing run or output becomes a skipped row with its reason, never a blank or a zero. */
export function rowFrom(run: Run | null, spec: RowSpec, shield: boolean): CardRow | null {
  if (!run) return null;
  if (spec.usd && shield) return null;
  const base = { key: spec.key, label: spec.label, when: "at-mark" as const, skill: run.ref, info: infoText(run.skill.meta, shield) };
  if (!run.result.ok) {
    return { ...base, value: null, status: "skipped", reason: run.result.reason, detail: run.result.detail };
  }
  const cell = spec.format(run.result.values);
  if (!cell || cell.value.includes(GAP)) return { ...base, value: null, status: "skipped", reason: "no-value" };
  return { ...base, value: cell.value, note: joinNote(cell.note), status: "ok", proxy: cell.proxy };
}

export function isRow(row: CardRow | null): row is CardRow {
  return row !== null;
}

/** First 1m bar after the decision bar (same session, within AFTER_MARK_BARS) where the reclaim holds. */
function firstReclaimAfter(ctx: SkillContext, side: CardSide): { time: number | null; detail: string } {
  const { series, i } = ctx;
  const last = Math.min(series.time.length - 1, i + AFTER_MARK_BARS);
  for (let j = i + 1; j <= last; j += 1) {
    if (series.sessionDate[j] !== series.sessionDate[i]) break;
    const reading = runSkill({ ...ctx, i: j }, "confirm1m", { side }).result;
    if (reading.ok && reading.values.reclaim === true) return { time: series.time[j], detail: "" };
  }
  return { time: null, detail: `No reclaim in the ${AFTER_MARK_BARS} minutes after the mark` };
}

export interface GroupInput {
  ctx: SkillContext;
  side: CardSide;
  spec: CardSpec;
  rSizeUsd: number;
  levels: LevelBook;
  shield: boolean;
}

/** The five groups in spec order. Candle and Volume open by default (§12.2). */
export function buildGroups(input: GroupInput): CardGroup[] {
  const { ctx, side, spec, rSizeUsd, levels, shield } = input;
  const tick = spec.tickSize;
  const pointsOf = (ticks: number) => ticks * tick;
  const usdPerContract = (ticks: number) => ticks * tick * spec.pointValueUsd;
  const labelOf = (key: string) => ((LEVEL_KEYS as readonly string[]).includes(key) ? LEVEL_LABELS[key as LevelKey] : key);
  const row = (run: Run | null, rowSpec: RowSpec) => rowFrom(run, rowSpec, shield);

  // Candle / MTF, with the 1m reclaim split into "at the mark" and "after the mark".
  const candle = runSkill(ctx, "mtfCandle");
  const structure = runSkill(ctx, "structure5m");
  const confirm = runSkill(ctx, "confirm1m", { side });
  const reclaimNow = confirm.result.ok && confirm.result.values.reclaim === true;
  const after = !reclaimNow && confirm.result.ok ? firstReclaimAfter(ctx, side) : null;
  const afterRow: CardRow | null = after === null ? null : {
    key: "reclaimAfter",
    label: "1m reclaim after the mark",
    value: after.time === null ? null : `${clockText(after.time + BAR_MS)} ET`,
    // The reclaim is known when its bar closes, so show the close time (the 08:13 bar closes at 08:14).
    note: after.time === null ? undefined : "after the mark",
    when: "after-mark",
    skill: confirm.ref,
    status: after.time === null ? "skipped" : "ok",
    reason: after.time === null ? "no-value" : undefined,
    detail: after.time === null ? after.detail : undefined,
    info: infoText(confirm.skill.meta, shield),
  };

  // Levels & targets
  const levelMap = runSkill(ctx, "levelMap");
  const vwap = runSkill(ctx, "vwapRelation");
  const orRun = runSkill(ctx, "openingRange");

  // Stops & R: the stop uses the mark's side and the fixed 0.25R sizing target.
  const stop = runSkill(ctx, "structureStop", { side, riskR: 0.25 });
  const rr = ((): CardRow | null => {
    if (!stop.result.ok || !levelMap.result.ok) return null;
    const stopPoints = numberOf(stop.result.values.stopPoints);
    const aboveTicks = numberOf(levelMap.result.values.nearestAboveTicks);
    if (stopPoints === null || stopPoints <= 0 || aboveTicks === null) return null;
    const above = textOf(levelMap.result.values.nearestAboveKey);
    return {
      key: "rrNearest", label: "R:R to nearest above", value: fmt(pointsOf(aboveTicks) / stopPoints, 1),
      note: `to ${labelOf(above)}`, when: "at-mark", skill: stop.ref, status: "ok",
      info: "Distance to the nearest level above ÷ the structure stop distance.",
    };
  })();

  const ranges = runSkill(ctx, "contextRanges");

  // Volume
  const rvol = runSkill(ctx, "rvol");
  const spike = runSkill(ctx, "volumeSpike");
  const entry = runSkill(ctx, "entryVolume");
  const delta = runSkill(ctx, "deltaProxy");
  // The nearest book level to the mark, for the at-level volume row. Ties keep book order.
  const price = ctx.mark?.price ?? ctx.series.close[ctx.i];
  let nearest: LabLevel | undefined;
  for (const level of levels.levels) {
    if (!nearest || Math.abs(level.value - price) < Math.abs(nearest.value - price)) nearest = level;
  }
  const atLevel = nearest ? runSkill(ctx, "volumeAtLevel", { level: nearest.key, toleranceTicks: 2, since: "session" }) : null;

  return [
    {
      id: "candle", title: "Candle / MTF", open: true,
      rows: [
        row(candle, {
          key: "range", label: "15m candle",
          format: (v) => ({
            value: `${fmt(numberOf(v.range))} pt`,
            note: joinNote(`range ${pctile(numberOf(v.rangePctile))}`, textOf(v.direction), v.forming === true ? "forming" : undefined),
          }),
        }),
        row(candle, {
          key: "lowerWick", label: "15m lower wick",
          format: (v) => ({
            value: `${fmt(numberOf(v.lowerWick))} pt`,
            note: joinNote(pctile(numberOf(v.lowerWickPctile)), `body ${fmt(numberOf(v.body))}`),
          }),
        }),
        row(structure, {
          key: "structure5m", label: "5m structure",
          format: (v) => ({
            value: titleCase(textOf(v.structure)),
            note: `${numberOf(v.higherLows) ?? 0} higher lows · ${numberOf(v.lowerHighs) ?? 0} lower highs`,
          }),
        }),
        row(confirm, {
          key: "reclaimAtMark", label: "1m reclaim at the mark",
          format: (v) => ({ value: v.reclaim === true ? "yes" : "no" }),
        }),
      ].concat(afterRow ? [afterRow] : []).filter(isRow),
    },
    {
      id: "levels", title: "Levels & targets", open: false,
      rows: [
        row(levelMap, {
          key: "nearestAbove", label: "Nearest above",
          format: (v) => {
            const ticks = numberOf(v.nearestAboveTicks);
            if (ticks === null || v.nearestAboveKey === "none") return null;
            return {
              value: labelOf(textOf(v.nearestAboveKey)),
              note: joinNote(
                `+${fmt(pointsOf(ticks))} pt`, `${ticks}t`, `${fmt(usdPerContract(ticks) / rSizeUsd)}R`,
                !shield && `$${fmt(usdPerContract(ticks))}/ct`,
              ),
            };
          },
        }),
        row(levelMap, {
          key: "nearestBelow", label: "Nearest below",
          format: (v) => {
            const ticks = numberOf(v.nearestBelowTicks);
            if (ticks === null || v.nearestBelowKey === "none") return null;
            return {
              value: labelOf(textOf(v.nearestBelowKey)),
              note: joinNote(
                `${MINUS}${fmt(pointsOf(ticks))} pt`, `${ticks}t`, `${fmt(usdPerContract(ticks) / rSizeUsd)}R`,
                !shield && `$${fmt(usdPerContract(ticks))}/ct`,
              ),
            };
          },
        }),
        row(vwap, {
          key: "vwap", label: "Session VWAP",
          format: (v) => {
            const level = numberOf(v.vwap);
            if (level === null) return null;
            const event = textOf(v.event);
            return {
              value: fmt(level),
              note: joinNote(`${signed(numberOf(v.distTicks), 0)}t`, textOf(v.side), event !== "none" ? event : undefined),
            };
          },
        }),
        row(orRun, {
          key: "openingRange", label: "Opening range",
          format: (v) => ({
            value: titleCase(textOf(v.relation)),
            note: joinNote(`${fmt(numberOf(v.orLow))}–${fmt(numberOf(v.orHigh))}`, textOf(v.widthBucket)),
          }),
        }),
      ].filter(isRow),
    },
    {
      id: "stops", title: "Stops & R", open: false,
      rows: [
        row(stop, {
          key: "stopPrice", label: "Structure stop",
          format: (v) => ({
            value: fmt(numberOf(v.stopPrice)),
            note: joinNote(`${fmt(numberOf(v.stopPoints))} pt`, numberOf(v.stopTicks) === null ? undefined : `${numberOf(v.stopTicks)}t`),
          }),
        }),
        row(stop, {
          key: "qtyAtRisk", label: "Contracts at 0.25R",
          format: (v) => ({
            value: numberOf(v.qtyAtRiskR) === null ? GAP : `${numberOf(v.qtyAtRiskR)} ct`,
            note: joinNote(`risk ${fmt(numberOf(v.riskR))}R`, v.oversized === true ? "one contract is over 0.25R" : undefined),
          }),
        }),
        row(stop, {
          key: "stopUsd", label: "Stop risk per contract", usd: true,
          format: (v) => (numberOf(v.stopUsdPerContract) === null ? null : { value: `$${fmt(numberOf(v.stopUsdPerContract))}` }),
        }),
        rr,
      ].filter(isRow),
    },
    {
      id: "ranges", title: "Overnight · Yesterday · Week", open: false,
      rows: [
        row(ranges, {
          key: "overnight", label: "Overnight",
          format: (v) => ({
            value: `${fmt(numberOf(v.overnightRange))} pt ${ARROW[textOf(v.overnightTrend)] ?? ""}`.trim(),
            note: `at ${fmt(numberOf(v.overnightPosPct), 0)}% of range`,
          }),
        }),
        row(ranges, {
          key: "yesterday", label: "Yesterday (RTH)",
          format: (v) => ({ value: `${fmt(numberOf(v.yesterdayRange))} pt ${ARROW[textOf(v.yesterdayDirection)] ?? ""}`.trim() }),
        }),
        row(ranges, {
          key: "week", label: "Week to date",
          format: (v) => ({
            value: `${fmt(numberOf(v.weekPosPct), 0)}% of range`,
            note: joinNote(`${fmt(numberOf(v.weekLow))}–${fmt(numberOf(v.weekHigh))}`),
          }),
        }),
        row(ranges, {
          key: "pdc", label: "vs PDC≈",
          format: (v) => ({ value: `${signed(numberOf(v.pdcDistPoints))} pt`, note: textOf(v.pdcSide) || undefined }),
        }),
      ].filter(isRow),
    },
    {
      id: "volume", title: "Volume", open: true,
      rows: [
        row(rvol, {
          key: "rvol", label: "RVOL (5 min)",
          format: (v) => ({
            value: `${fmt(numberOf(v.rvol), 1)}×`,
            note: joinNote(titleCase(textOf(v.rvolBucket)), `${numberOf(v.baselineSessions) ?? 0} sessions`),
          }),
        }),
        row(spike, {
          key: "spike", label: "Volume spike",
          format: (v) => ({ value: `${fmt(numberOf(v.ratio), 1)}× median`, note: v.spike === true ? "spike" : "no spike" }),
        }),
        row(entry, {
          key: "entryBar", label: "Entry bar volume",
          format: (v) => ({
            value: `${fmt(numberOf(v.entryBarVolume), 0)} ct`,
            note: joinNote(textOf(v.trend), `${fmt(numberOf(v.entryVsMedian), 1)}× median`),
          }),
        }),
        row(atLevel, {
          key: "atLevel", label: `At ${nearest ? labelOf(nearest.key) : "nearest level"}`,
          format: (v) => ({ value: `${fmt(numberOf(v.volume), 0)} ct`, note: `${numberOf(v.touches) ?? 0} visits` }),
        }),
        row(delta, {
          key: "delta", label: "Δ proxy",
          format: (v) => ({ value: signed(numberOf(v.normalized)), note: textOf(v.sign) || undefined, proxy: true }),
        }),
      ].filter(isRow),
    },
  ];
}
