/**
 * Incremental session VWAP for the Strategy Lab (spec §7.6, SL-4b).
 *
 * Mirrors `computeSessionIndicators(...).vwap` in lib/session-indicators.ts: the same HLC3 typical
 * price, the same running-mean update order, the same session anchors (`rth` 09:30–16:00 ET,
 * `globex` 18:00–17:00 ET), the same coverage test, and the same `globex-tolerant` gap policy (IN-2).
 * RTH stays strict under either policy.
 *
 * Differences by design: the lab reads a BarSeries, where volume 0 is already NaN. A present bar with
 * missing volume counts for coverage but adds nothing to the sum (the Yahoo first-bar artifact).
 *
 * Each session is walked once into prefix arrays, so reading VWAP at any asOf is O(1). A reading at
 * asOf reads only slots whose bar closed at or before asOf, so it cannot look ahead.
 */
import { equityIndexSessionBounds, sessionDate } from "../session.ts";
import type { GapPolicy } from "../session-indicators.ts";
import { LEVEL_LABELS } from "./levels.ts";
import type { BarSeries, LabLevel } from "./types.ts";

export type VwapAnchor = "rth" | "globex";

/** Mirrors GLOBEX_MAX_MISSING_SHARE and GLOBEX_MAX_GAP_MIN in lib/session-indicators.ts, which does not export them. */
export const VWAP_TOLERANCE = { maxMissingShare: 0.03, maxGapMinutes: 15 } as const;
/** IN-2 default: Globex VWAP may bridge small overnight gaps. RTH is strict either way. */
export const DEFAULT_GAP_POLICY: GapPolicy = "globex-tolerant";

const MINUTE_MS = 60_000;

export interface VwapCoverage {
  /** Expected slots in the anchored window up to asOf. */
  expected: number;
  present: number;
  missing: number;
  /** Present bars whose volume is missing (zero on the source). */
  volumeMissing: number;
  longestGapMin: number;
  /** Missing slots inside regular hours. */
  rthMissing: number;
  complete: boolean;
  approximate: boolean;
}

export interface VwapReading {
  anchor: VwapAnchor;
  /** Session the asOf belongs to, or null when asOf is not a finite time. */
  sessionDate: string | null;
  value: number | null;
  /** Why value is null. */
  withheld: "invalid-time" | "no-bars" | "window-incomplete" | "no-volume" | null;
  coverage: VwapCoverage;
}

interface Track {
  from: number;
  end: number;
  slots: number;
  /** Prefix counts over slots 0..k. */
  missing: Int32Array;
  longestRun: Int32Array;
  rthMissing: Int32Array;
  volumeMissing: Int32Array;
  /** VWAP after slot k, carried across missing slots. NaN until the first bar with volume. */
  vwap: Float64Array;
}

const TRACKS = new WeakMap<BarSeries, Map<string, Track>>();

function typicalPrice(series: BarSeries, j: number): number {
  return (series.high[j] + series.low[j] + series.close[j]) / 3;
}

function buildTrack(series: BarSeries, anchor: VwapAnchor, date: string): Track {
  const bounds = equityIndexSessionBounds(date);
  const from = anchor === "rth" ? bounds.rthOpen : bounds.open;
  const end = anchor === "rth" ? bounds.rthClose : bounds.close;
  const { barMs } = series;
  const slots = Math.max(0, Math.round((end - from) / barMs));
  const track: Track = {
    from,
    end,
    slots,
    missing: new Int32Array(slots),
    longestRun: new Int32Array(slots),
    rthMissing: new Int32Array(slots),
    volumeMissing: new Int32Array(slots),
    vwap: new Float64Array(slots).fill(Number.NaN),
  };

  let volume = 0;
  let value = 0;
  let carry = Number.NaN;
  let missing = 0;
  let run = 0;
  let longest = 0;
  let rthMissing = 0;
  let volumeMissing = 0;
  for (let k = 0; k < slots; k += 1) {
    const time = from + k * barMs;
    const j = series.byTime.get(time);
    if (j === undefined) {
      missing += 1;
      run += 1;
      longest = Math.max(longest, run);
      if (time >= bounds.rthOpen && time + barMs <= bounds.rthClose) rthMissing += 1;
    } else {
      run = 0;
      const barVolume = series.volume[j];
      if (Number.isNaN(barVolume)) {
        volumeMissing += 1;
      } else {
        // Same operations, in the same order, as sessionVwap in lib/session-indicators.ts.
        volume += barVolume;
        value += (typicalPrice(series, j) - value) * (barVolume / volume);
        carry = value;
      }
    }
    track.missing[k] = missing;
    track.longestRun[k] = longest;
    track.rthMissing[k] = rthMissing;
    track.volumeMissing[k] = volumeMissing;
    track.vwap[k] = carry;
  }
  return track;
}

function trackFor(series: BarSeries, anchor: VwapAnchor, date: string): Track {
  let tracks = TRACKS.get(series);
  if (!tracks) {
    tracks = new Map();
    TRACKS.set(series, tracks);
  }
  const key = `${anchor}|${date}`;
  let track = tracks.get(key);
  if (!track) {
    track = buildTrack(series, anchor, date);
    tracks.set(key, track);
  }
  return track;
}

function emptyCoverage(): VwapCoverage {
  return {
    expected: 0, present: 0, missing: 0, volumeMissing: 0, longestGapMin: 0, rthMissing: 0,
    complete: true, approximate: false,
  };
}

/**
 * VWAP as of `asOf` (UTC ms). A bar counts once its close (`time + barMs`) is at or before asOf.
 * Returns the same value as `computeSessionIndicators(...).vwap.at(-1)?.value` for the same candles and policy.
 */
export function vwapAt(
  series: BarSeries,
  anchor: VwapAnchor,
  asOf: number,
  policy: GapPolicy = DEFAULT_GAP_POLICY,
): VwapReading {
  if (!Number.isFinite(asOf)) {
    return { anchor, sessionDate: null, value: null, withheld: "invalid-time", coverage: emptyCoverage() };
  }
  const date = sessionDate(asOf);
  const track = trackFor(series, anchor, date);
  const to = Math.max(track.from, Math.min(track.end, asOf));
  const expected = Math.max(0, Math.floor((to - track.from) / series.barMs));
  if (expected === 0) {
    return { anchor, sessionDate: date, value: null, withheld: "no-bars", coverage: emptyCoverage() };
  }

  const last = expected - 1;
  const missing = track.missing[last];
  const longestGapMin = track.longestRun[last] * series.barMs / MINUTE_MS;
  const rthMissing = track.rthMissing[last];
  const complete = missing === 0;
  const tolerated = anchor === "globex" && policy === "globex-tolerant"
    && missing / expected <= VWAP_TOLERANCE.maxMissingShare
    && longestGapMin <= VWAP_TOLERANCE.maxGapMinutes
    && rthMissing === 0;
  const coverage: VwapCoverage = {
    expected,
    present: expected - missing,
    missing,
    volumeMissing: track.volumeMissing[last],
    longestGapMin,
    rthMissing,
    complete,
    approximate: tolerated && missing > 0,
  };
  if (!complete && !tolerated) {
    return { anchor, sessionDate: date, value: null, withheld: "window-incomplete", coverage };
  }
  const value = track.vwap[last];
  if (Number.isNaN(value)) return { anchor, sessionDate: date, value: null, withheld: "no-volume", coverage };
  return { anchor, sessionDate: date, value, withheld: null, coverage };
}

/**
 * VWAP levels for the LevelBook at decision bar i (`vwap_globex`, `vwap_rth`), for `withLevels` in levels.ts.
 * Each level is available at the decision time, so it never leaks a later bar.
 */
export function vwapLevelsAt(series: BarSeries, i: number, policy: GapPolicy = DEFAULT_GAP_POLICY): LabLevel[] {
  if (!Number.isInteger(i) || i < 0 || i >= series.time.length) return [];
  const asOf = series.time[i] + series.barMs;
  const levels: LabLevel[] = [];
  const entries = [["globex", "vwap_globex"], ["rth", "vwap_rth"]] as const;
  for (const [anchor, key] of entries) {
    const reading = vwapAt(series, anchor, asOf, policy);
    if (reading.value !== null) {
      levels.push({ key, value: reading.value, availableAt: asOf, label: LEVEL_LABELS[key], approx: reading.coverage.approximate });
    }
  }
  return levels;
}
