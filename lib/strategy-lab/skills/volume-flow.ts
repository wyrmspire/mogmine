// SL-5: volume skills V3 volumeAtLevel and V5 deltaProxy (docs/design-2026-11-24/09-strategy-lab.md §7.3, §7.5, §9).
// Both are degraded: V3 counts whole bars, V5 is an estimate from 1-minute bars, not order flow.
import { equityIndexSessionBounds } from "../../session.ts";
import type {
  LevelKey, Skill, SkillContext, SkillMeta, SkillResult,
} from "../types.ts";
import {
  LEVEL_KEYS, entryVolumeSkill, intParam, ok, rvolSkill, skip, volumeSkill, volumeSpikeSkill,
} from "./volume.ts";

// ---------------------------------------------------------------------------
// V3 volumeAtLevel: volume and visits within `toleranceTicks` of a level.
// ---------------------------------------------------------------------------

interface AtLevelParams { level: LevelKey; toleranceTicks: number; since: "session" | "rth" }

/** Non-intersecting bars needed between two visits for them to count as separate touches. */
const SEPARATION_BARS = 3;

export const VOLUME_AT_LEVEL_META: SkillMeta = {
  id: "volumeAtLevel",
  version: "1.0.0",
  kind: "feature",
  title: "Volume at a level",
  description: "Volume of bars that trade within tolerance of a level since the session or RTH open, with visit count.",
  status: "degraded",
  params: [
    { key: "level", type: "enum", default: "", options: LEVEL_KEYS, label: "Level" },
    { key: "toleranceTicks", type: "integer", default: 2, min: 0, max: 20, label: "Tolerance (ticks)" },
    { key: "since", type: "enum", default: "session", options: ["session", "rth"], label: "Measure from" },
  ],
  outputs: [
    { key: "volume", type: "number", label: "Volume at level (whole bars)", unit: "contracts" },
    { key: "touches", type: "number", label: "Separate visits" },
    { key: "volumeShare", type: "number", label: "Share of volume since", unit: "ratio" },
    { key: "volumeShareBucket", type: "category", label: "Share bucket (thirds)", categories: ["low", "mid", "high"] },
  ],
  needs: { baseTimeframe: "1m", lookbackMinutes: 1440, volume: true },
  knownAt: "bar-close",
  warnings: [
    "Whole-bar attribution: a bar that touches the level counts all of its volume, so volume at the level is overstated.",
  ],
};

function volumeShareBucket(share: number): string {
  if (share < 1 / 3) return "low";
  if (share < 2 / 3) return "mid";
  return "high";
}

export const volumeAtLevelSkill: Skill = volumeSkill<AtLevelParams>(
  VOLUME_AT_LEVEL_META,
  (ctx) => {
    const level = ctx.params.level;
    const toleranceTicks = intParam(ctx.params, "toleranceTicks", 2, 0, 20);
    const since = ctx.params.since ?? "session";
    if (typeof level !== "string" || !LEVEL_KEYS.includes(level as LevelKey)) {
      return { ok: false, detail: "level is required and must be a known level key" };
    }
    if (toleranceTicks === null || (since !== "session" && since !== "rth")) {
      return { ok: false, detail: "toleranceTicks 0–20; since is session or rth" };
    }
    return { ok: true, p: { level: level as LevelKey, toleranceTicks, since } };
  },
  (ctx, p) => atLevel(ctx, p),
);

function atLevel(ctx: SkillContext, p: AtLevelParams): SkillResult {
  const { series, i, spec } = ctx;
  const book = ctx.levels.byKey.get(p.level);
  if (!book) return skip("no-level", `${p.level} is not in the level book at this time`);
  const decisionTime = series.time[i] + series.barMs;
  if (book.availableAt > decisionTime) return skip("not-known-yet", `${p.level} is not available until later`);

  const sessionStart = series.sessionStart[i];
  let start = sessionStart;
  if (p.since === "rth") {
    const rthOpen = equityIndexSessionBounds(series.sessionDate[i]).rthOpen;
    if (series.time[i] < rthOpen) return skip("out-of-session", "Before the 09:30 ET RTH open; no RTH bars yet");
    start = i;
    while (start - 1 >= sessionStart && series.time[start - 1] >= rthOpen) start -= 1;
  }

  const tolerance = p.toleranceTicks * spec.tickSize;
  const low = book.value - tolerance;
  const high = book.value + tolerance;
  let total = 0;
  let atLevelVolume = 0;
  let missingBars = 0;
  let touches = 0;
  let nonIntersecting = 0;
  let inRun = false;
  for (let j = start; j <= i; j += 1) {
    const volume = series.volume[j];
    // Missing-volume bars are excluded outright: they neither add volume nor break a visit.
    if (Number.isNaN(volume)) {
      missingBars += 1;
      continue;
    }
    total += volume;
    const touchesLevel = series.high[j] >= low && series.low[j] <= high;
    if (touchesLevel) {
      atLevelVolume += volume;
      if (!inRun && (touches === 0 || nonIntersecting >= SEPARATION_BARS)) touches += 1;
      inRun = true;
      nonIntersecting = 0;
    } else {
      inRun = false;
      nonIntersecting += 1;
    }
  }

  if (total === 0) return skip("volume-missing", `No bars with volume since the ${p.since === "rth" ? "RTH open" : "session open"}`);
  const share = atLevelVolume / total;
  const notes = missingBars > 0 ? [`${missingBars} bar(s) with missing volume excluded`] : [];
  return ok({
    volume: atLevelVolume,
    touches,
    volumeShare: share,
    volumeShareBucket: volumeShareBucket(share),
  }, notes);
}

// ---------------------------------------------------------------------------
// V5 deltaProxy: estimated buy/sell pressure from 1-minute bars. Labelled as a proxy everywhere.
// ---------------------------------------------------------------------------

interface DeltaParams { method: "clv" | "tick"; bars: number }

const MAX_MISSING_FRACTION = 0.2;
const FLAT_BAND = 0.1;

export const DELTA_PROXY_META: SkillMeta = {
  id: "deltaProxy",
  version: "1.0.0",
  kind: "feature",
  title: "Δ proxy (estimated, not order flow)",
  description: "Signed volume estimated from 1-minute bars: close location (clv) or tick direction (tick).",
  status: "degraded",
  proxy: true,
  params: [
    { key: "method", type: "enum", default: "clv", options: ["clv", "tick"], label: "Method" },
    { key: "bars", type: "integer", default: 10, min: 1, max: 240, label: "Bars" },
  ],
  outputs: [
    { key: "net", type: "number", label: "Net proxy volume", unit: "contracts" },
    { key: "normalized", type: "number", label: "Normalised (−1 to 1)", unit: "ratio" },
    { key: "sign", type: "category", label: "Proxy sign", categories: ["positive", "flat", "negative"] },
  ],
  needs: { baseTimeframe: "1m", lookbackMinutes: 10, volume: true },
  knownAt: "bar-close",
  warnings: ["Estimated from 1-minute bars. Not real order flow."],
};

export const deltaProxySkill: Skill = volumeSkill<DeltaParams>(
  DELTA_PROXY_META,
  (ctx) => {
    const bars = intParam(ctx.params, "bars", 10, 1, 240);
    const method = ctx.params.method ?? "clv";
    if (bars === null || (method !== "clv" && method !== "tick")) {
      return { ok: false, detail: "bars 1–240; method is clv or tick" };
    }
    return { ok: true, p: { method, bars } };
  },
  ({ series, i }, { method, bars }) => {
    // Chronological walk over the window ending at i. Each minute is looked up by time, so a
    // gap is a missing bar rather than a shifted index.
    let missing = 0;
    let net = 0;
    let totalVolume = 0;
    let lastSign = 0;
    for (let m = bars - 1; m >= 0; m -= 1) {
      const j = series.byTime.get(series.time[i] - m * series.barMs);
      if (j === undefined) {
        missing += 1;
        continue;
      }
      let sign = 0;
      if (method === "tick" && j > 0 && series.time[j - 1] === series.time[j] - series.barMs) {
        const change = series.close[j] - series.close[j - 1];
        if (change > 0) sign = 1;
        else if (change < 0) sign = -1;
        else sign = lastSign;
        if (sign !== 0) lastSign = sign;
      }
      const volume = series.volume[j];
      if (Number.isNaN(volume)) {
        missing += 1;
        continue;
      }
      totalVolume += volume;
      if (method === "clv") {
        const range = series.high[j] - series.low[j];
        const clv = range > 0
          ? ((series.close[j] - series.low[j]) - (series.high[j] - series.close[j])) / range
          : 0;
        net += clv * volume;
      } else {
        net += sign * volume;
      }
    }

    if (missing > bars * MAX_MISSING_FRACTION) {
      return skip("volume-missing", `${missing} of ${bars} bars are missing or have no volume (limit 20%)`);
    }
    if (totalVolume === 0) return skip("volume-missing", "No bars with volume in the window");
    const normalized = net / totalVolume;
    const sign = normalized > FLAT_BAND ? "positive" : normalized < -FLAT_BAND ? "negative" : "flat";
    const notes = missing > 0 ? [`${missing} bar(s) skipped as missing`] : [];
    return ok({ net, normalized, sign }, notes);
  },
);

/** All five SL-5 volume skills. The registry composer (SL-8) registers them; SL-1 keeps SKILLS empty. */
export const VOLUME_SKILLS: readonly Skill[] = [
  rvolSkill,
  volumeSpikeSkill,
  volumeAtLevelSkill,
  entryVolumeSkill,
  deltaProxySkill,
];
