# 09 — Strategy Lab: measure an idea, find where it works, and say why

Source: Chris, 11/24 (~5:30–5:45 PM CT): *"Say I got a trade: I'm doing a long at a certain time near a certain level and/or an indicator is doing something. A strategy lab that has tools to look back and measure stuff… atomic skills, like my edgerite repo."* Clarified: the skills are for **analysing price and quantifying an idea**, to find **where it works, where it doesn't, when, and why**. Amendment 1 (5:40 PM): *"we've been ignoring volume everywhere"*, so volume is first-class. Amendment 2 (5:43 PM): the anchor use case in §1. Chris authorised "plan and mull this over, no approval needed": every open question in §13 has a default.

Related: [01 — Playbook Lab](01-playbook-lab.md) (vocabulary, `/playbooks/lab`), [03 — Indicators & levels](03-indicators-and-levels.md) (VWAP anchors, `D-F` gap policy, `D-G` EMA), [04 — R size](04-r-size.md) and `D-A` (R = dollars ÷ account R size), [05 — Stops, MAE, fills](05-stops-mae-fills.md) (`R-POST-1`..`3`, measuring after the entry bar), [07 — Agent API](07-agent-api.md), [91 — Swarm plan](91-swarm-plan.md) (file ownership), [92 — Decisions](92-decisions-made-by-swarm.md), `lib/session.ts`, `lib/session-indicators.ts`, `app/api/market-data/route.ts`.

Status: design only. Nothing here is built.

---

## 1. The anchor use case (build this first)

Chris, 11/24 morning: *"I wanted to treat something as the bottom premarket. How big was the 15m candle, what was 5m doing, are we using 1m or not, what are we targeting, how were our stops, what did price do overnight, yesterday, the week, etc."*

The flow the MVP is built around:

```
Mark a point ──► Context Card ──► Find similar ──► Results: where it works / fails, and why
(time, price,     (Candle/MTF ·     (card → recipe,   (matches, outcome stats, splits,
 side; or a        Levels & targets   editable; run     "what separates winners from
 saved trade)      Stops & R ·        over history)     losers", his real trades overlaid)
                   O/N·Yday·Week ·
                   Volume)
```

Worked example (numbers illustrative, the shape is the spec):

- **Mark:** Mon 11/24, 08:12 ET, MES 5,912.25, **long** ("premarket low as the bottom"). Account SIM Eval 50K, 1R = $300.
- **Context Card** answers each of Chris's questions:
  - *How big was the 15m candle?* The 08:00–08:15 candle: range 9.50 pt (82nd percentile of the last 40 15m candles), lower wick 6.25 pt (91st pct), body 1.75 pt, closed up.
  - *What was 5m doing?* Three lower highs into the mark, then the first 5m higher low at 08:10; last 5m swing low 5,910.75.
  - *Are we using 1m?* 1m reclaim: yes, at 08:14 (close above the high of the bar that made the low). It is shown as **after the mark** if it happened after the marked time, so it is never mistaken for something known at the mark.
  - *What are we targeting?* Nearest above: Globex VWAP +6.75 pt (27 ticks, $33.75/contract, 0.11R/contract); ONH +18.25 pt; PDC≈ +22.00 pt. Nearest below: PDL −3.50 pt.
  - *How were our stops?* Structure stop 2 ticks below the swing low = 5,910.25, 2.00 pt = $10/contract. At 0.25R ($75) risk that is 7 contracts; R:R to VWAP 3.4, to ONH 9.1.
  - *Overnight, yesterday, the week?* Overnight range 21.5 pt, trend down (−14 pt open→mark), mark in the bottom 6% of it. Yesterday: 48 pt range, closed down 0.6%. Week: mark at 18% of the week's high–low. 22 pt below PDC≈.
  - *Volume?* Entry bar 2,140 contracts; RVOL (5-minute window vs the same clock time over the last 10 sessions) 2.3 = very high; spike yes (4.1× rolling median); 6,900 contracts traded within 2 ticks of the low over 2 touches; delta proxy over the last 10 bars **positive** (proxy, see §7.5).
- **Find similar** builds: *long, 07:00–09:15 ET, price in the bottom 15% of the overnight range so far, 1m reclaim, RVOL ≥ 1.3; stop 2 ticks beyond the swing low (max 10 pt); target 2× stop distance; max hold 60 min; one match per session.* Slice by: 15m lower-wick percentile, 5m structure, week position, PDC side, RVOL bucket, spike, delta-proxy sign.
- **Results:** e.g. n = 14 over the 20 sessions Yahoo still serves at 1m; win rate 50%, avg +0.06R at 0.25R risk; **"Where it works"**: RVOL ≥ 2 (5 of 6 won, n thin); **"Where it fails"**: mark above the week's midpoint (0 of 4). Every line carries its n and the small-sample warning. Chris's real trades tagged with the chosen playbook appear as overlay rows with the conditions they had.

---

## 2. Goal and non-goals

**Goal.** Quantify a trading idea against price history and attribute outcomes to conditions: *when* it works, *where* (relative to levels, ranges, VWAP, the open), under *what volume*, and *why* (which conditions separate winners from losers), with sample sizes always visible.

**Non-goals.**
- Not an auto-trader and not a signal service. No orders, ever (AGENTS §3b-1). Nothing runs on a schedule in MVP.
- Not a pass/fail backtest headline. A single "expectancy +0.3R" number is the least useful output; the splits are the product.
- No optimiser. The lab never searches parameter grids for the best curve. A parameter change is a new recipe version the trader makes on purpose.
- No claims the data cannot support: no true order-flow delta, footprint or tick-accurate fills (Yahoo has no bid/ask and no ticks). No news filter until a calendar feed exists.
- No AI-written numbers (AGENTS §3b-11). An agent may read lab output; it never computes stats the code can compute.

**Honesty rules (binding for every screen).**
1. Every rate prints with its n. Below 10 matches a rate is shown greyed with "thin"; below 5 only counts show (`PLAYBOOK_CARD_MIN_TRADES` = 10, as in [01](01-playbook-lab.md) §6).
2. Every run states its data: sessions requested, sessions used, sessions excluded (and why: only 5m left, coverage), bars missing, volume-missing bars.
3. A feature is only used if it was **known at the decision time** (§4.4). Lookahead is a bug, tested.
4. When a stop and a target sit inside the same 1m bar, the outcome is counted as the **stop** (worst case) and the count of such bars is printed.
5. With many slices tested, some look strong by chance. The "why" view says so (§8.4).

---

## 3. What we take from edgerite (and what we change)

Read from `~/labs/edgerite` (read-only).

| edgerite | What it is | Take / change |
| :--- | :--- | :--- |
| `src/analysis/types.ts` `DetectorMetadata` | `id`, `name`, `category`, `description`, `version`, `status: "active" \| "degraded" \| "experimental"`, `requiredInputs`, `supportedTimeframes`, `providerRequirements`, `signalType` | **Take** the self-describing metadata, semver `version` and the three-state `status`. **Change:** add typed `params`, typed `outputs` (number / category / boolean with units and buckets), `lookbackMinutes`, `priorSessions`, `needsVolume`, `knownAt`. |
| `src/analysis/types.ts` `IDetector.canRun()` / `execute()` | Async preflight, then async execute against a provider (`context.provider.getBars(...)`) | **Take** preflight-before-compute. **Change:** skills are **pure and synchronous** over an in-memory `BarSeries` and an index. No skill fetches data; the runner loads bars once. This makes a scan over ~25k bars cheap and every skill unit-testable without mocks. |
| `src/analysis/registry.ts` `SkillRegistry` | A class that registers all detectors in its constructor; `getDetector`, `getAllDetectors` | **Take** the single registry. **Change:** a plain frozen object keyed `id@major`, so two major versions can coexist and a recipe pins the one it used. |
| `src/analysis/runtime.ts` `runDetectors` | Unknown detector → a `warning` signal; failed `canRun` → `info` signal with the reason; a thrown error is caught into an `info` signal | **Take** "never throw, always return a reason". **Change:** the reason is a typed code (`needs-1m`, `coverage`, `volume-missing`, `warmup`, `no-level`, `not-known-yet`) so the UI can count exclusions per reason. |
| `src/domain/index.ts` `AnalysisSignal` | Normalized output: `status`, `directionalBias`, `tradability`, `confidence`, `evidence[]`, `levels`, `warnings`, `rawResult`, `version` | **Change:** no `directionalBias` / `tradability` / `confidence` verdicts. A lab skill **measures or labels**; deciding is the trader's job and the attribution engine's evidence. Output is a flat record of typed values plus coverage and notes. |
| `src/analysis/preflight.ts` + `src/domain/services/volume_integrity.ts` | Preflight cards for time, news (explicitly "not integrated yet") and data integrity; volume integrity counts zero / missing volume bars and grades `ok` / `degraded` / `missing` | **Take** the volume-integrity grading and the honest "news unknown" card. **Change:** integrity is computed per run and per session, and printed on the results header. |
| `src/domain/services/coverage_calculator.ts` | Expected bars from an exchange calendar vs actual timestamps, missing periods | **Take** the idea; **use MogMine's own** `lib/session.ts` (`readSessionWindow`, `isRegularTradingBarInterval`), which is already `America/New_York`-correct. |
| `src/analysis/detectors/volume_profile.ts` | `status: "degraded"` because the profile is estimated from OHLCV; warning "True futures VP requires tick data" (also `runtime.ts` `getDetectorWarnings`) | **Take** the pattern exactly: estimated things are `degraded` and carry a warning. The delta proxy (§7.5) is `degraded` + `proxy: true`. |
| `src/analysis/detectors/vwap_settlement.ts`, `session_levels.ts` | VWAP and session high/low anchored on the **UTC calendar date** (`toISOString().split('T')[0]`); zero volume weighted as 1; the code itself warns "True CME session logic is pending" | **Do not copy.** MogMine anchors on 18:00 / 09:30 ET (`lib/session.ts` `equityIndexSessionBounds`) and skips zero-volume bars (`lib/session-indicators.ts` `sessionVwap`). |
| `tests/*-detector.test.ts` (e.g. `vwap-settlement-detector.test.ts`, `volume-profile-detector.test.ts`) | One test file per detector, synthetic bars | **Take**: one test file per skill group, synthetic bars with hand-checked answers. |
| `tests/strategy-versioning.test.ts` | Strategy versions: v1 auto-created, v2 appended and v1 sealed (`validTo`), diffs | **Take** for recipes: editing a recipe that has runs creates a new version; runs reference `recipeId@version`. |

---

## 4. Skills: interface and registry

### 4.1 Kinds

| Kind | Answers | Examples |
| :--- | :--- | :--- |
| `feature` | A number about price/context at bar `i` | distance to PDL in ticks, 15m wick percentile, RVOL |
| `label` | A category or boolean at bar `i` | session phase, 5m structure, VWAP side, spike yes/no |
| `measure` | What happened **after** an entry at bar `i` | bracket outcome ($, R, exit reason), MFE/MAE, level reach, forward return |

Conditions (triggers) are not a skill kind: they are **compositions** of feature/label outputs in a recipe (§5.2). Measures may only appear in a recipe's `measure` block, never in a trigger or a slice (enforced by the recipe validator: that is the lookahead guard at the type level).

### 4.2 Types (`lib/strategy-lab/types.ts`, frozen by SL-1)

```ts
export type OutputType = "number" | "category" | "boolean";
export type Unit = "points" | "ticks" | "usd" | "r" | "ratio" | "pct" | "contracts" | "minutes" | "bars";
export type SkillStatus = "active" | "degraded" | "experimental";
export type SkipReason =
  | "needs-1m" | "coverage" | "volume-missing" | "warmup" | "no-level"
  | "not-known-yet" | "out-of-session" | "bad-params";

export interface OutputSpec {
  key: string;                       // flat, camelCase, e.g. "lowerWickPctile"
  type: OutputType;
  label: string;                     // UI text, e.g. "15m lower wick (pctile)"
  unit?: Unit;
  categories?: readonly string[];    // for type "category": the full closed set
  buckets?: readonly number[];       // for type "number": default split edges, ascending
}

export interface ParamSpec {
  key: string; type: "number" | "integer" | "enum" | "boolean";
  default: number | string | boolean;
  min?: number; max?: number; options?: readonly string[]; label: string;
}

export interface SkillMeta {
  id: string;                        // "rvol"
  version: string;                   // semver; outputs change → major
  kind: "feature" | "label" | "measure";
  title: string; description: string;
  status: SkillStatus;
  proxy?: boolean;                   // true → UI shows "proxy" chip (delta proxy)
  params: readonly ParamSpec[];
  outputs: readonly OutputSpec[];
  needs: {
    baseTimeframe: "1m";             // MVP: every skill needs 1m bars (§10.3)
    lookbackMinutes: number;         // bars before i the skill reads
    priorSessions?: number;          // whole sessions before i's session (RVOL, week)
    volume: boolean;
  };
  knownAt: "bar-close" | "after-entry";  // "after-entry" only for kind "measure"
  warnings?: readonly string[];
}

export type Value = number | string | boolean | null;

export interface SkillContext {
  series: BarSeries;
  i: number;                         // decision bar; its close is the decision time
  params: Record<string, Value>;
  spec: { symbol: string; tickSize: number; pointValueUsd: number };
  rSizeUsd: number;                  // account R size (§6.4)
  levels: LevelBook;                 // §7.6, already filtered by availableAt
  mark?: { price: number; side: "long" | "short" };  // Context Card only
}

export type SkillResult =
  | { ok: true; values: Record<string, Value>; notes?: string[] }
  | { ok: false; reason: SkipReason; detail: string };

export interface Skill {
  meta: SkillMeta;
  /** Cheap: data presence, params, warm-up. Never reads bars after i. */
  preflight(ctx: SkillContext): { ok: true } | { ok: false; reason: SkipReason; detail: string };
  /** Pure, synchronous, deterministic. Reads bars [i - lookback, i] only (measures: (i, i + hold]). */
  compute(ctx: SkillContext): SkillResult;
}
```

### 4.3 `BarSeries` (`lib/strategy-lab/series.ts`)

Built once per run from `/api/market-data` candles (`{time, open, high, low, close, volume}`, `time` = bar open, UTC ms).

```ts
export interface BarSeries {
  symbol: string;
  barMs: 60_000;
  time: Float64Array; open: Float64Array; high: Float64Array; low: Float64Array; close: Float64Array;
  volume: Float64Array;              // NaN = missing. Yahoo volume 0 is stored as NaN (§7.1)
  sessionDate: string[];             // lib/session.ts sessionDate(time)
  etMinute: Uint16Array;             // minutes since 00:00 America/New_York, computed once
  sessionStart: Int32Array;          // index of the first bar of each bar's session
  byTime: Map<number, number>;       // bar open time → index
  sessions: SessionInfo[];           // per session: date, bounds, expected/present bars, volumeMissing, baseTimeframe, excluded?
}
```

- Duplicates and invalid OHLC (`low > min(open, close)` etc.) are dropped with the same test as `readSessionWindow`; counts go to `SessionInfo`.
- **No synthetic bars.** A missing minute stays missing; skills that need contiguous windows treat a gap inside their lookback per their own edge-case rule (each skill spec in §9 states it).
- Aggregation to 5m / 15m / 1h is a pure helper (`aggregate(series, i, minutes)`) aligned to the ET clock (`etMinute % minutes`), returning the bucket's OHLCV **up to and including bar i** plus `{expected, present}`. A bucket containing bar `i` is therefore the **forming** candle at the decision time, labelled so; "previous completed 15m" is a separate output.

### 4.4 Known-at rule (lookahead guard)

- The decision time of bar `i` is its **close** (`time[i] + 60s`). Feature/label skills read bars `≤ i` only.
- Levels carry `availableAt` (`lib/session-indicators.ts` `Level.availableAt`); the `LevelBook` handed to a skill contains only levels with `availableAt ≤ decision time`. ONH/ONL therefore do not exist before 09:30 ET; premarket uses the **running** overnight high/low so far (§9, S7).
- A **mark** at `HH:MM` (Context Card) means "I am acting at HH:MM:00", so the decision bar is the bar that **closed** at that minute (a mark at 08:12 decides on the bar that opened at 08:11). Facts from the 08:12 bar onward are shown in an **"After the mark"** group, never mixed with "At the mark".
- Test (SL-1): every registered feature/label skill returns identical values for bar `i` when all bars after `i` are deleted from the series.

### 4.5 Registry (`lib/strategy-lab/registry.ts`)

```ts
export const SKILLS: Readonly<Record<string, Skill>>;          // key "rvol@1"
export function getSkill(ref: string): Skill | undefined;      // "rvol" → latest major, "rvol@1" → pinned
export function listSkills(): SkillMeta[];                     // for the UI picker and, later, the agent API
```

Later (SL-14, after the swarm): `GET /api/v1/strategy-lab/skills` returns `listSkills()` under the read scope ([07](07-agent-api.md)); `POST /api/v1/strategy-lab/context` returns a Context Card for `{symbol, time, price, side}` so a custom GPT can ask "what did the tape look like at 08:12?" without computing numbers itself.

---

## 5. Recipes

### 5.1 Format (`mogmine.strategy-recipe.v1`)

```ts
interface Recipe {
  schema: "mogmine.strategy-recipe.v1";
  id: string; version: number; name: string; notes?: string;
  playbookId: string | null;                 // §6
  symbol: "MES";                             // MVP: MES only (MNQ later, same code)
  side: "long" | "short";
  window: { startEt: "HH:MM"; endEt: "HH:MM"; days?: ("Mon"|"Tue"|"Wed"|"Thu"|"Fri")[] };  // decision-bar close time, ET; may wrap midnight
  trigger: Condition;                        // §5.2
  entry: { at: "trigger-close" };            // MVP: fill at the trigger bar's close
  stop: { type: "points"; points: number }
      | { type: "beyond-swing"; ticks: number; lookbackBars: number; maxPoints: number };
  target: { type: "points"; points: number } | { type: "rr"; multiple: number }  // rr = multiple of stop distance
        | { type: "level"; level: LevelKey; fallbackPoints: number };
  maxHoldMinutes: number;
  flatAtEt?: "HH:MM";                        // forced exit time, ET; default "16:59"
  sizing: { mode: "risk-r"; riskR: number } | { mode: "contracts"; qty: number };
  account: { accountId: string | null };     // R size resolves from it (§6.4)
  slippageTicks: { stop: number; market: number };  // target limits fill at price
  dedupe: { maxPerSession: number; cooldownMinutes: number; oneAtATime: boolean };
  sliceBy: SkillOutputRef[];                 // attribution dimensions (§8.2)
  measure: { levelReach?: LevelKey[]; forwardMinutes?: number[] };
}
interface SkillOutputRef { skill: string; params?: Record<string, Value>; out: string }
```

Defaults (SL-8 fills them in and the editor shows them): `flatAtEt` "16:59"; `sizing` `{risk-r, 0.25}`; `slippageTicks` `{stop: 1, market: 1}`; `dedupe` `{maxPerSession: 1, cooldownMinutes: 30, oneAtATime: true}`; `maxHoldMinutes` 60.

Sizing with `risk-r`: `qty = max(1, floor(riskR × rSizeUsd ÷ (stopPoints × pointValueUsd)))`. When even 1 contract exceeds `riskR`, the match is kept and flagged `oversized` (counted on the results header).

### 5.2 Conditions

```ts
type Condition =
  | { all: Condition[] } | { any: Condition[] } | { not: Condition }
  | { skill: string; params?: Record<string, Value>; out: string;
      op: "==" | "!=" | "<" | "<=" | ">" | ">=" | "between" | "in" | "crossesAbove" | "crossesBelow";
      value: Value | Value[] };
```

- Nesting depth ≤ 3. `between` is inclusive `[a, b]`. `crossesAbove x`: output was `< x` at `i−1` and `≥ x` at `i` (both bars must exist and be consecutive minutes; otherwise false).
- A condition on a skill that skips (`ok: false`) is **false**, and the skip reason is counted per condition. The run header shows "RVOL unavailable on 312 candidate bars (warmup)".
- Evaluation order: `window` first (free), then conditions in declared order with short-circuit, so cheap clock checks prune before volume work.

### 5.3 Example recipes (valid JSON)

**A. Premarket bottom with 1m reclaim and volume (the anchor, §1).**

```json
{
  "schema": "mogmine.strategy-recipe.v1",
  "id": "rcp-premarket-bottom", "version": 1,
  "name": "Premarket low as the bottom, 1m reclaim, RVOL",
  "playbookId": "onl-sweep-smt",
  "symbol": "MES", "side": "long",
  "window": { "startEt": "07:00", "endEt": "09:15" },
  "trigger": { "all": [
    { "skill": "contextRanges", "out": "overnightPosPct", "op": "<=", "value": 15 },
    { "skill": "confirm1m", "params": { "lookbackBars": 15 }, "out": "reclaim", "op": "==", "value": true },
    { "skill": "rvol", "params": { "windowMinutes": 5, "sessions": 10 }, "out": "rvol", "op": ">=", "value": 1.3 }
  ]},
  "entry": { "at": "trigger-close" },
  "stop": { "type": "beyond-swing", "ticks": 2, "lookbackBars": 15, "maxPoints": 10 },
  "target": { "type": "rr", "multiple": 2 },
  "maxHoldMinutes": 60, "flatAtEt": "16:59",
  "sizing": { "mode": "risk-r", "riskR": 0.25 },
  "account": { "accountId": null },
  "slippageTicks": { "stop": 1, "market": 1 },
  "dedupe": { "maxPerSession": 1, "cooldownMinutes": 30, "oneAtATime": true },
  "sliceBy": [
    { "skill": "mtfCandle", "params": { "minutes": 15 }, "out": "lowerWickPctile" },
    { "skill": "structure5m", "out": "structure" },
    { "skill": "contextRanges", "out": "weekPosPct" },
    { "skill": "contextRanges", "out": "pdcSide" },
    { "skill": "rvol", "params": { "windowMinutes": 5, "sessions": 10 }, "out": "rvolBucket" },
    { "skill": "volumeSpike", "out": "spike" },
    { "skill": "deltaProxy", "out": "sign" }
  ],
  "measure": { "levelReach": ["vwap_globex", "onh", "pdc"], "forwardMinutes": [15, 30, 60] }
}
```

**B. Long at the first prior-day-low touch in the first hour, with volume at the level.**

```json
{
  "schema": "mogmine.strategy-recipe.v1",
  "id": "rcp-pdl-first-hour", "version": 1,
  "name": "PDL first touch, first hour, close back above",
  "playbookId": null,
  "symbol": "MES", "side": "long",
  "window": { "startEt": "09:31", "endEt": "10:30" },
  "trigger": { "all": [
    { "skill": "levelMap", "params": { "level": "pdl", "toleranceTicks": 2 }, "out": "touch", "op": "==", "value": true },
    { "skill": "levelMap", "params": { "level": "pdl", "toleranceTicks": 2 }, "out": "closeDistTicks", "op": ">=", "value": 0 }
  ]},
  "entry": { "at": "trigger-close" },
  "stop": { "type": "points", "points": 4 },
  "target": { "type": "level", "level": "rth_open", "fallbackPoints": 8 },
  "maxHoldMinutes": 90, "flatAtEt": "15:59",
  "sizing": { "mode": "risk-r", "riskR": 0.25 },
  "account": { "accountId": null },
  "slippageTicks": { "stop": 1, "market": 1 },
  "dedupe": { "maxPerSession": 1, "cooldownMinutes": 60, "oneAtATime": true },
  "sliceBy": [
    { "skill": "volumeAtLevel", "params": { "level": "pdl", "toleranceTicks": 2 }, "out": "touches" },
    { "skill": "volumeAtLevel", "params": { "level": "pdl", "toleranceTicks": 2 }, "out": "volumeShareBucket" },
    { "skill": "entryVolume", "params": { "k": 5 }, "out": "entryVsMedianBucket" },
    { "skill": "contextRanges", "out": "overnightTrend" },
    { "skill": "openingRange", "params": { "minutes": 15 }, "out": "widthBucket" },
    { "skill": "sessionClock", "out": "todBucket" }
  ],
  "measure": { "levelReach": ["rth_open", "vwap_rth", "pdc"], "forwardMinutes": [15, 30] }
}
```

**C. VWAP reclaim after 10:00 ET on a volume spike.**

```json
{
  "schema": "mogmine.strategy-recipe.v1",
  "id": "rcp-vwap-reclaim", "version": 1,
  "name": "RTH VWAP reclaim after 10:00 on a spike",
  "playbookId": "vwap-trend-push",
  "symbol": "MES", "side": "long",
  "window": { "startEt": "10:00", "endEt": "15:00" },
  "trigger": { "all": [
    { "skill": "vwapRelation", "params": { "anchor": "rth" }, "out": "event", "op": "==", "value": "reclaim" },
    { "skill": "volumeSpike", "params": { "lookbackBars": 30, "multiple": 2.5 }, "out": "spike", "op": "==", "value": true }
  ]},
  "entry": { "at": "trigger-close" },
  "stop": { "type": "beyond-swing", "ticks": 2, "lookbackBars": 10, "maxPoints": 8 },
  "target": { "type": "rr", "multiple": 1.5 },
  "maxHoldMinutes": 45, "flatAtEt": "15:59",
  "sizing": { "mode": "risk-r", "riskR": 0.25 },
  "account": { "accountId": null },
  "slippageTicks": { "stop": 1, "market": 1 },
  "dedupe": { "maxPerSession": 3, "cooldownMinutes": 30, "oneAtATime": true },
  "sliceBy": [
    { "skill": "rvol", "params": { "windowMinutes": 5, "sessions": 10 }, "out": "rvolBucket" },
    { "skill": "deltaProxy", "params": { "bars": 10 }, "out": "sign" },
    { "skill": "contextRanges", "out": "pdcSide" },
    { "skill": "structure5m", "out": "structure" },
    { "skill": "sessionClock", "out": "todBucket" }
  ],
  "measure": { "levelReach": ["pdh", "onh"], "forwardMinutes": [15, 30, 60] }
}
```

**D. Short a failed opening-range breakout (break above ORH that closes back inside).**

```json
{
  "schema": "mogmine.strategy-recipe.v1",
  "id": "rcp-or-failed-breakout-short", "version": 1,
  "name": "Failed ORH breakout, short back into the range",
  "playbookId": "orb-reclaim",
  "symbol": "MES", "side": "short",
  "window": { "startEt": "09:46", "endEt": "11:30" },
  "trigger": { "all": [
    { "skill": "openingRange", "params": { "minutes": 15, "failBars": 5 }, "out": "failedBreakUp", "op": "==", "value": true },
    { "not": { "skill": "vwapRelation", "params": { "anchor": "rth" }, "out": "side", "op": "==", "value": "above-far" } }
  ]},
  "entry": { "at": "trigger-close" },
  "stop": { "type": "beyond-swing", "ticks": 2, "lookbackBars": 5, "maxPoints": 8 },
  "target": { "type": "level", "level": "or_mid", "fallbackPoints": 6 },
  "maxHoldMinutes": 60, "flatAtEt": "15:59",
  "sizing": { "mode": "risk-r", "riskR": 0.25 },
  "account": { "accountId": null },
  "slippageTicks": { "stop": 1, "market": 1 },
  "dedupe": { "maxPerSession": 1, "cooldownMinutes": 60, "oneAtATime": true },
  "sliceBy": [
    { "skill": "volumeSpike", "out": "spike" },
    { "skill": "entryVolume", "params": { "k": 5 }, "out": "trend" },
    { "skill": "openingRange", "params": { "minutes": 15 }, "out": "widthBucket" },
    { "skill": "contextRanges", "out": "yesterdayDirection" },
    { "skill": "deltaProxy", "out": "sign" }
  ],
  "measure": { "levelReach": ["or_low", "vwap_rth", "pdl"], "forwardMinutes": [15, 30] }
}
```

Validation (`lib/strategy-lab/recipe.ts`, SL-8): unknown skill or output → error naming it; an output used with an op that does not fit its type → error; a `measure` skill inside `trigger` or `sliceBy` → error; `window` times parse; stop/target positive; `sliceBy` ≤ 12 entries.

---

## 6. Playbook linkage

### 6.1 The relationship

- A playbook holds **0..n recipes** (`recipe.playbookId`). A recipe may also be unlinked (exploration). Playbooks stay as they are (`lib/playbooks.ts`); the link lives on the recipe, so no playbook field and no sanitizer change.
- A recipe is a **measurable description** of a playbook, not the playbook: the checklist rules stay the trader's words. The Lab shows them side by side ("Your rules" / "What the recipe measures").
- **Trades tagged with the playbook are the test cases.** For each closed MES trade with `playbook_id = recipe.playbookId` inside the loaded bar range, the overlay (§8.6) evaluates the recipe's conditions and slices at the trade's entry, and shows its real result next to what the recipe would have done.

### 6.2 Joining 01 — Playbook Lab

- [01](01-playbook-lab.md) is about vocabulary (playbooks × tags × trades, `/playbooks/lab`); the Strategy Lab is about price. They meet at the playbook view (01 §4.2). After PL-2b merges, SL-13 adds one row there: **"Recipes · 2 · Open in Strategy Lab →"** linking to `/strategy-lab?playbook=<id>`.
- Conversely, the Strategy Lab's playbook header links back: "Vocabulary for this playbook →" `/playbooks/lab?playbook=<id>`.
- Result R in both uses account R (`D-A`), so a playbook's real "avg +0.31R" (01) and its recipe's simulated expectancy are in the same unit.
- Naming: the 01 page is **Playbook Lab**; this one is **Strategy Lab**. Do not merge the routes or call either "the lab" in UI copy.

### 6.3 Route

- `/strategy-lab` — Mark a point (default tab), Recipes, Runs. `?playbook=<id>` filters recipes and preselects the playbook for overlays. `?trade=<id>` prefills the mark from a trade (entry time, entry price, direction, account).

### 6.4 R size

R = dollars ÷ the account's fixed R size (`D-A`, [04](04-r-size.md)); never stop width. `lib/strategy-lab/r.ts`:

```ts
export function labRSize(accountId: string | null, accounts, prefs): { usd: number; source: "account" | "default" }
```

uses `resolveRSize` from `lib/r-size.ts` (package `RS-1`) when present; until then the account's R size field if any, else `prefs.riskBudgetUsd` (default $250). SIM Eval 50K = $300. Every R number on screen shows its basis once per screen: "R = $300 (SIM Eval 50K)". "× risk" (P&L ÷ the recipe's stop dollars) appears only as a secondary, separately labelled column, never called R.

---

## 7. Volume (first-class)

### 7.1 What the data gives (verified 11/24 against `/api/market-data`)

- Candles are `{time (ms), open, high, low, close, volume}`, source "Yahoo Finance", ticker `MES=F`. Volume is populated on 1m bars: RTH median ≈ 1,950 contracts/min on 11/23; overnight median ≈ 400.
- **The first candle of every response has volume 0** (an edge/partial-bar artifact). Rule: **volume 0 is missing (`NaN`), not zero activity**, everywhere in the lab. A session whose first bar is the artifact loses that bar's volume only.
- 1m is served for ~30 days; the route then falls back to 5m (~60 days) and 1h (~730 days) (`app/api/market-data/route.ts:14-18`). An 8 h overnight window returned 467 of 480 minutes. So **same-time-of-day baselines have at most ~20 RTH sessions of 1m history** today.
- No tick data, no bid/ask: **true delta and footprint are out of scope** until a better feed exists.

### 7.2 Volume integrity per run

Per session: bars present, bars with volume, volume-missing bars (NaN), grade `ok` (0 missing) / `degraded` (≤ 2% missing in RTH) / `missing` (> 2%), after edgerite's `volume_integrity.ts`. Volume skills skip with `volume-missing` when their own window has a missing bar unless their spec says otherwise (§9).

### 7.3 Volume skills (first batch, specs in §9)

`rvol` (same-time-of-day relative volume), `volumeSpike` (multiple of rolling median, log z-score), `volumeAtLevel` (volume and touches within X ticks of a level), `entryVolume` (decision bar and the K bars before: sum, trend, vs median), `deltaProxy` (degraded, proxy).

### 7.4 Volume as slicing dimensions

Default slices offered on every run: `rvol.rvolBucket` (low < 0.7 ≤ normal < 1.3 ≤ high < 2 ≤ very high), `volumeSpike.spike`, `entryVolume.entryVsMedianBucket` (< 0.75, 0.75–1.5, ≥ 1.5), `deltaProxy.sign` (positive / flat / negative). The "where it works / fails" cards treat them like any other feature.

### 7.5 Delta proxy (label it as a proxy, always)

Without bid/ask the lab cannot know who aggressed. Two documented proxies; the UI chip reads **"Δ proxy"** with an info line: *"Estimated from 1-minute bars. Not real order flow."*

- `clv` (default): per bar `CLV = ((close − low) − (high − close)) ÷ (high − low)` (0 when `high = low`), proxy delta = `CLV × volume`.
- `tick`: per bar sign of `close − previous close` (0 → previous sign), proxy delta = `sign × volume`.

Output: sum over the last N bars, normalised by the sum of volume (`−1..1`), and `sign` with a flat band of ±0.1.

### 7.6 VWAP correctness (verified in code, 11/24)

`lib/session-indicators.ts` `sessionVwap`:
- **Volume-weighted typical price:** HLC3 (`typicalPrice`), cumulative, written as the running mean `value += (tp − value) × v ÷ V`, which equals `Σ tp·v ÷ Σ v`.
- **Zero/missing volume:** bars with `volume > 0` only enter the sum; the artifact first bar (volume 0) does not drag the VWAP. ✔
- **Reset:** per session at 18:00 ET (`anchor: "globex"`) or 09:30 ET (`"rth"`), via `equityIndexSessionBounds`, DST-correct. ✔
- **No lookahead:** each point is timestamped at the bar's close (`bar.time + barMs`). ✔
- **Gaps:** VWAP is withheld when the anchored window is incomplete (`volumeUsable` requires `coverage.complete`). Globex VWAP is therefore often missing today; `D-F` / package `IN-2` adds the tolerant policy (≤ 3% missing, longest gap ≤ 15 min, none after 09:30). RTH stays strict.
- **Gap in the checks:** `volumeUsable` accepts `volume >= 0`, so a zero-volume bar counts as present for coverage while contributing nothing. Correct for the artifact, but the count is invisible. The lab reports volume-missing bars inside each VWAP window.

The lab computes VWAP **incrementally per session once** (calling `computeSessionIndicators` per bar would be O(n²)), using the same formula and the same gap policy as `IN-2`, and a golden test (SL-4b) asserts lab VWAP = `computeSessionIndicators(...).vwap` at ≥ 20 sampled `asOf` times on a fixture, to the tick. Edgerite's VWAP (UTC date anchor, zero volume weighted as 1) is the counter-example and is not copied.

### 7.7 Bar cache (later)

Twenty sessions of 1m is thin for RVOL and for history. SL-15 adds a `mogmine_bars_1m` table that a daily job fills (the archive of docs/10), so baselines and history grow past Yahoo's 30 days. Until then the browser caches completed sessions in IndexedDB (§10.2).

---

## 8. Analysis and attribution engine

### 8.1 Run

`lib/strategy-lab/runner.ts`:

```ts
interface Match {
  i: number; time: number; sessionDate: string;
  entry: number; stop: number; target: number; qty: number; oversized: boolean;
  features: Record<string, Value>;      // key = "skill@major:out(params-hash)", sliceBy refs + trigger refs
  outcome: Outcome;                     // bracketOutcome + levelReach + forwardReturn outputs
}
interface RunResult {
  recipe: { id: string; version: number };
  data: { sessionsRequested: number; sessionsUsed: string[]; excluded: { date: string; reason: string }[];
          barsMissing: number; volumeMissing: number; rSize: { usd: number; source: string } };
  candidates: number; skips: Record<string, Record<SkipReason, number>>;
  matches: Match[]; overlays: OverlayRow[];
  stats: Stats; splits: Split[]; separators: Separator[]; timeOfDay: TodCell[];
  ms: number;
}
function runRecipe(recipe: Recipe, series: BarSeries, ctx: { rSizeUsd: number; trades: TradeRecord[] }): RunResult
```

Scan: for each bar in each used session inside `window` → evaluate `trigger` → if true and `dedupe` allows → compute entry/stop/target (§9 M1) → measures → features for `sliceBy` → push. With `oneAtATime`, no new match until the previous simulated trade exits. Runs in a Web Worker if `ms > 300` on the test phone (SL-10 decides; plain call first).

### 8.2 Overall stats

`n`, wins / losses / scratches (scratch = |P&L| ≤ 2 ticks × qty, the `D-C` floor), win rate with **Wilson 95% interval**, avg R, median R, expectancy R (= avg R), total R, avg and median points, profit factor (only when n ≥ 10), exit reasons (target / stop / time / session-end / ambiguous-stop), MFE and MAE distributions (p25 / p50 / p75 in points and R), time to target (median minutes, wins only), level reach rates (`levelReach`: "reached ONH before stop: 6 of 14"), forward returns at each `forwardMinutes`.

### 8.3 Conditional splits

For each `sliceBy` output:
- **Buckets:** categories as declared; booleans as yes/no; numbers by the skill's declared `buckets`, else **terciles of this run's values** (labelled "low / mid / high" with their edges). `null` values form a "n/a" bucket with its count, never silently dropped.
- Per bucket: n, win rate + Wilson CI, avg R, **shrunk avg R** `= (n × avgR + k × overallAvgR) ÷ (n + k)` with `k = 10`, avg MFE/MAE.
- Gating: n ≥ 10 → full row; 5–9 → greyed "thin", no rank; < 5 → counts only.

### 8.4 What separates winners from losers

For each slice with ≥ 2 eligible buckets (n ≥ 10 each, or n ≥ 5 when the run has < 40 matches, then labelled "thin"):
- `gap = max(shrunk avg R) − min(shrunk avg R)` across eligible buckets; also the win-rate gap.
- `clear` when the best and worst buckets' Wilson intervals do not overlap; otherwise `suggestive`.
- `stable` when the best bucket is the same in the first and second half of the sessions (chronological split), else `unstable`.
- Rank by `gap`, clear before suggestive, stable before unstable. Show the top 3 as cards ("**Works:** RVOL ≥ 2 · 5 of 6 won · +0.21R shrunk vs +0.06R overall · thin · stable") and the worst bucket as "**Fails:**".
- Multiple-comparison line, always shown under the cards: *"12 slices tested. By chance alone about 1 in 20 can look clear. Treat single-slice results as leads, not rules."*
- **Winners vs losers table:** for each numeric slice, the median among winners vs among losers; for categories, the share of each category among winners vs losers.

No regression, no p-values, no machine learning in MVP: every number on the "why" view can be recomputed by hand from the matches list.

### 8.5 Time-of-day heatmap

Rows: 30-minute ET buckets of the decision time (`sessionClock.todBucket`); columns: n, win rate, avg R. On a phone it is a vertical list with an inline bar for avg R (single hue `--gold-mid` for n, `--profit-text` / `--loss-text` for the sign of R, both with the number printed; colour never carries the value alone).

### 8.6 Real trades overlay

For each overlay trade (closed, `playbook_id` matches, symbol MES, entry inside the loaded series):
- Decision bar = the bar that closed at or just before the entry time (same rule as a mark, §4.4).
- Show: each trigger condition with pass/fail and the actual value ("RVOL ≥ 1.3 ✗ (0.9)"), the slice values, the trade's **real** result R (account R) and the recipe's **simulated** outcome from that bar.
- Summary line: "7 tagged trades in range · 3 meet the recipe · real avg +0.40R on those 3 · −0.22R on the other 4". This is often the most useful answer: "your trades that fit the idea did better than the ones that didn't".
- Trades outside the 1m range are listed as "older than the bar history" with a count, never computed on 5m silently.
- Sample trades are excluded unless the Shield-style "include samples" toggle is on (as in [01](01-playbook-lab.md)).

---

## 9. First batch of skills (build order)

Common rules: MES tick 0.25, $5/pt. "Missing" = NaN or absent bar. Each skill gets a test group with the listed cases; each test builds synthetic 1m bars with hand-computed answers. File groups in §11.

**S1 `sessionClock` (label, v1).** Outputs: `phase` ∈ {evening 18:00–23:59, overnight 00:00–06:59, premarket 07:00–09:29, rthOpen 09:30–10:29, rthMid 10:30–13:59, rthLate 14:00–15:59, post 16:00–16:59}, `todBucket` (30-min ET bucket label "08:00"), `minutesFromRthOpen` (negative before). Uses the decision time (bar close). Edge: DST weeks (use `America/New_York` only); the 17:00–18:00 halt has no bars. Tests: 13:31 UTC in July → rthOpen; 14:31 UTC in December → rthOpen; 22:59 UTC Sunday → evening of Monday's session (`sessionDate`).

**S2 `mtfCandle` (feature, v1).** Params: `minutes` ∈ {5, 15, 60}, `pctileLookback` (default 40). Outputs: `range`, `body`, `upperWick`, `lowerWick` (points), `bodyPct` (body ÷ range), `rangePctile`, `lowerWickPctile`, `upperWickPctile` (vs the previous `pctileLookback` **completed** candles of the same size, 0–100, ties → midrank), `direction` ∈ {up, down, doji (body ≤ 1 tick)}, `forming` (bool: candle containing bar `i` not yet complete), plus `prev*` versions for the last completed candle. Edge: bucket missing > 20% of its minutes → `coverage` skip; fewer than 20 completed candles for percentiles → percentile outputs null (`warmup`). Tests: 15 synthetic 1m bars aggregate to exact OHLC; forming flag at minute 7 of 15; percentile of the max range = 100.

**S3 `structure5m` (label, v1).** Params: `swingBars` (default 2: a 5m swing low has 2 higher lows each side), `lookbackCandles` (default 12). Outputs: `structure` ∈ {up (last two swing highs and lows rising), down, mixed, none}, `higherLows`, `lowerHighs` (counts in lookback), `lastSwingLow`, `lastSwingHigh` (prices), `firstHigherLow` (bool: the latest swing low is the first higher low after ≥ 2 lower lows). Confirmed swings only: a swing needs `swingBars` completed candles after it (no lookahead). Tests: staircase up → up; V shape → firstHigherLow true once confirmed, false one candle earlier.

**S4 `confirm1m` (label, v1).** Params: `lookbackBars` (default 15). Let `L` = the lowest low in the last `lookbackBars` 1m bars ending at `i`, made at bar `j < i`. Outputs: `reclaim` (long: `close[i] > high[j]` and no lower low after `j`; short mirrors with highs), `higherLow` (a 1m swing low after `j` above `low[j]`), `barsSinceExtreme` (`i − j`). Edge: a missing bar between `j` and `i` → still computed, note "gap". Tests: low at j, close above high[j] two bars later → reclaim; a new low after j → false.

**S5 `levelMap` (feature, v1).** The levels and targets view. Params: `level` (optional key), `toleranceTicks` (default 2). Level keys: `pdh`, `pdl`, `pdc` (≈ last RTH 1m close, labelled ≈), `onh`, `onl` (from 09:30 only), `rth_open`, `week_high`, `week_low`, `vwap_globex`, `vwap_rth`, `or_high`, `or_low`, `or_mid`. Outputs with `level`: `closeDistTicks` (signed, close − level), `touch` (bar range within tolerance), `distPoints`, `distUsd` (per contract), `distR` (per contract, ÷ R size). Without `level` (Context Card): `nearestAboveKey`, `nearestAboveTicks`, `nearestBelowKey`, `nearestBelowTicks`, plus a full list. Levels come from `LevelBook` (§7.6 / §10.2): built per session with the `D-F` tolerance for extremes (≤ 3% missing, longest gap ≤ 15 min, else withheld) and an `approx` flag when anything is missing. Tests: PDL withheld when the prior session misses 5%; ONH absent at 09:29 and present at 09:31; distances in ticks/$/R for a 6.25 pt gap at R $300 (25 ticks, $31.25, 0.104R).

**S6 `structureStop` (feature, v1).** Params: `ticks` (default 2), `lookbackBars` (default 15), `riskR` (default 0.25). Long: stop = lowest low of the last `lookbackBars` 1m bars − `ticks` × 0.25 (short mirrors). Outputs: `stopPrice`, `stopPoints`, `stopTicks`, `stopUsdPerContract`, `qtyAtRiskR`, `riskR` (actual, at that qty), and for the Context Card `rrTo.<levelKey>` for each level on the target side. Edge: stop distance 0 → `bad-params`. Tests: low 5,910.75, ticks 2 → 5,910.25; 2 pt × $5 = $10; at $300 and 0.25R → 7 contracts, risk 0.233R.

**S7 `contextRanges` (feature, v1).** Outputs: `overnightHigh/Low` (running, 18:00 ET → decision time, or to 09:30 once past it), `overnightRange`, `overnightPosPct` (0 = at the low, 100 = at the high), `overnightTrend` ∈ {up, down, flat (|close − open| < 25% of range)}, `yesterdayRange`, `yesterdayDirection` (RTH close vs RTH open, flat within 0.1%), `weekHigh/Low` (Mon session → decision time), `weekPosPct`, `pdcDistPoints`, `pdcSide` ∈ {above, below, at (±2 ticks)}. Edge: Monday's "week" is the Monday session only; missing prior session → yesterday outputs null. Tests: position 0/50/100; Monday week; flat band.

**S8 `openingRange` (feature, v1).** Params: `minutes` (default 15), `failBars` (default 5). Outputs: `orHigh`, `orLow`, `orMid`, `orWidthPoints`, `widthBucket` (terciles of the last 20 sessions' OR widths, else run terciles), `relation` ∈ {inside, above, below}, `failedBreakUp` (a close above `orHigh` within the last `failBars` and close[i] back below `orHigh`), `failedBreakDown`. Unavailable before 09:30 + minutes; OR bar missing → `coverage`. Tests: break-and-fail sequence; no failure if never closed outside.

**S9 `vwapRelation` (label, v1).** Params: `anchor` ∈ {rth, globex}, `farTicks` (default 12). Outputs: `vwap`, `distTicks`, `side` ∈ {above-far, above, at (±2 ticks), below, below-far}, `event` ∈ {reclaim (prev close below, this close above), loss, none}, `slope5` (points/min over 5 bars). Same formula and gap policy as §7.6. Tests: the golden comparison with `computeSessionIndicators`; a zero-volume first bar does not move VWAP; reset at 09:30 and 18:00; reclaim fires once.

**V1 `rvol` (feature, v1).** Params: `windowMinutes` (default 5), `sessions` (default 10), `minSessions` (default 5). `today` = sum of volume over the `windowMinutes` bars ending at `i`. `baseline` = **median** of the same ET clock window's sum over the previous `sessions` sessions (each must have all bars with volume, else that session is skipped). Outputs: `rvol` = today ÷ baseline, `rvolBucket` (low / normal / high / very-high at 0.7 / 1.3 / 2), `baselineSessions` used. Edge: fewer than `minSessions` usable → `warmup`; any missing bar in today's window → `volume-missing`; DST: same ET clock minute, not same UTC. Tests: flat 1,000/min history with today 2,000/min → 2.0; one past session missing a bar is skipped; 4 usable → warmup.

**V2 `volumeSpike` (label, v1).** Params: `lookbackBars` (30), `multiple` (3), `minValid` (20). Outputs: `ratio` = volume[i] ÷ median(previous 30 valid volumes), `logZ` = (ln v − mean ln) ÷ sd ln over the same window, `spike` (`ratio ≥ multiple`). Edge: volume[i] missing → `volume-missing`; fewer than `minValid` valid → `warmup`; window crossing the 17:00 halt is allowed (uses valid bars). Tests: 30 bars of 500 then 2,000 → ratio 4, spike; NaN at i → skip.

**V3 `volumeAtLevel` (feature, v1, degraded: whole-bar attribution).** Params: `level`, `toleranceTicks` (2), `since` ∈ {session (default), rth}. Over bars from `since` to `i`: `volume` = sum of volume of bars whose `[low, high]` intersects `[level ± tolerance]` (whole bar counted: an overstatement, hence `degraded` with that warning), `touches` = number of separate visits (runs of intersecting bars separated by ≥ 3 non-intersecting bars), `volumeShare` = volume ÷ total volume since, `volumeShareBucket` (terciles). Tests: two separated visits → 2 touches; adjacent bars → 1; missing volume bars excluded and counted in notes.

**V4 `entryVolume` (feature, v1).** Params: `k` (5), `medianBars` (30). Outputs: `entryBarVolume` (decision bar), `priorSum` (k bars before), `trend` ∈ {rising, falling, flat} from the least-squares slope of the k+1 volumes (flat when |slope| < 5% of their mean per bar), `entryVsMedian` (÷ median of the previous 30), `entryVsMedianBucket`. Missing bars inside k → `volume-missing`. Tests: 1,2,3,4,5,6 × 100 → rising; constant → flat.

**V5 `deltaProxy` (feature, v1, degraded, proxy).** Params: `method` ∈ {clv, tick} (clv), `bars` (10). As §7.5. Outputs: `net` (contracts), `normalized` (−1..1), `sign` ∈ {positive, flat, negative}. Missing volume bars are skipped; more than 20% missing → `volume-missing`. Tests: closes at highs → normalized 1; doji with high = low → 0; tick method sign carry-over.

**M1 `bracketOutcome` (measure, v1).** Inputs from the recipe: side, entry = close[i] (trigger close), stop and target prices (snapped to tick), qty, slippage, `maxHoldMinutes`, `flatAtEt`. Walk bars **after the entry bar** (`i+1 …`), consistent with `R-POST-1`: the trigger bar is the entry bar, its range is never used. Per bar: if both stop and target are within the bar → `ambiguous-stop` exit at stop (worst case); else stop hit → exit stop − slippage; target hit → exit target (limit, no slippage); then time/flat exit at that bar's close − market slippage. A missing minute is skipped (gap noted); a gap > 15 min inside the hold → outcome `coverage` (excluded from stats, counted). Outputs: `exitReason`, `exitTime`, `pnlPoints`, `pnlUsd` (× qty × $5), `resultR` (= pnlUsd ÷ R size), `riskMultiple` (pnlPoints ÷ stopPoints, labelled "× risk"), `mfePoints`/`maePoints` (best/worst excursion over the after-entry bars up to exit, inclusive of the exit bar), `mfeR`/`maeR` (× qty × $5 ÷ R size), `minutesToExit`, `minutesToTarget`. Tests: entry bar low below stop but later bars above → no stop (the `R-POST-1` case); same-bar stop+target → ambiguous stop; flat at 15:59; long and short symmetry; R at $300 vs $250.

**M2 `levelReach` (measure, v1).** For each requested level on the target side and present in `LevelBook` at entry: `reached` (before the stop, within the hold), `minutesToReach`. Tests: reached after the stop → false.

**M3 `forwardReturn` (measure, v1).** For each N in `forwardMinutes`: signed points from entry to the close of the bar N minutes after the entry bar (nearest earlier present bar within 2 min, else null). Tests: gap handling; short sign.

Batch 2 (after MVP): `emaRelation` (uses `lib/ema.ts` from `IN-3`, 200/20 EMA side and slope, `D-G` warm-up), `rangeRegime` (today's range so far ÷ 10-session ADR), `trendRegime` (5-session close trend), `adrExtension`, `gapOpen` (RTH open vs PDC≈), `profileRelation` (POC/VAH/VAL from `computeSessionIndicators`, degraded), `nqDivergence` (needs `MNQ=F` bars; separate fetch), `newsProximity` (needs a calendar feed; skipped until one exists).

---

## 10. MVP scope

### 10.1 What ships first, in order

1. **Mark a point** at `/strategy-lab`: date, time (ET, minute), price (tick-snapped), side; or `?trade=<id>` prefill.
2. **Context Card** (§12.2) from S1–S9, V1–V5 at the mark.
3. **Find similar** → an editable recipe (§10.4) → run over all 1m sessions available (~20) → **Results** with stats, works/fails cards, splits, time-of-day, matches.
4. **Real trades overlay** for a chosen playbook.
5. Recipes saved locally; recipe list per playbook; JSON view; then the recipe editor form (recipe-first authoring).

### 10.2 Data loading (client-side)

- `lib/strategy-lab/bars.ts` requests one session at a time: `GET /api/market-data?symbol=MES&from=<18:00 ET prev day>&to=<17:00 ET>` (23 h; the route's day mode caps a window at 26 h, `MAX_RANGE_MS`). Concurrency 3, with a progress line ("Loading 12 of 22 sessions").
- Each response's `baseTimeframe` is recorded. **A session that comes back as 5m or 1h is excluded** from the MVP and listed ("Nov 3: only 5m left at Yahoo"); MVP skills need 1m. Volume 0 → NaN.
- Completed sessions (close < now − 1 h) are cached with `idbGet` / `idbSet` from `lib/idb.ts` under keys `strategy-lab:v1:MES:<sessionDate>` (read-only use of the existing helper; no change to it). Today's session is never cached. A cached session whose `baseTimeframe` was 1m stays usable after Yahoo drops it, so the cache slowly extends history on this device.
- Default range: the last 22 sessions (to the mark's session). Context Card needs: the mark's session, the prior session, the week, and `rvol.sessions` (10) prior sessions → ≤ 12 requests on first load.
- Levels per session: built once with `lib/session.ts` helpers (`equityIndexSessionBounds`, `readSessionWindow`, `previousRegularSessionDate`, `sessionWeekMonday`) and the lab's tolerant extreme rule; `availableAt` respected per bar.

### 10.3 Limits stated in the UI

"1-minute history: about the last 30 days (Yahoo). Older sessions are skipped. Volume baselines use at most ~20 sessions. No news filter. Δ is a proxy." Shown once on the results header, collapsible.

### 10.4 Find similar: card → recipe

`lib/strategy-lab/similar.ts`, deterministic:
- `side` from the mark; `window` = the mark's `todBucket` ± 60 min, clipped to the mark's `phase` boundaries.
- Up to **4 trigger conditions**, chosen in this order when they apply:
  1. Level: nearest level within 8 ticks → `levelMap(level).touch == true`; else the overnight/week position if ≤ 15 or ≥ 85 → `contextRanges.overnightPosPct <= 15` (long) / `>= 85` (short).
  2. 1m confirmation, if `confirm1m.reclaim` was true at the mark → `== true`.
  3. The most extreme MTF reading: the 15m `lowerWickPctile` (long) / `upperWickPctile` (short) if ≥ 70 → `>= 70`.
  4. Volume: `rvol ≥ 1.3` if the mark's RVOL ≥ 1.3, else `volumeSpike.spike == true` if spiking, else none.
- `stop` = `beyond-swing` with the card's `structureStop` params (`maxPoints` = 2.5 × the card's stop, min 4); `target` = `rr 2`; `maxHoldMinutes` 60; `sizing` risk-r 0.25; `dedupe` 1 per session.
- `sliceBy` = every other card output that has buckets or categories (not used in the trigger), capped at 12, volume slices always included.
- The generated recipe opens in the editor with a "Why these conditions" line per condition (e.g. "Your mark was 1 tick from ONL"). The trader can drop or change any before running.

### 10.5 Not in MVP

Server-side runs, saved runs in Supabase, the agent endpoints, 5m/1h fallback analysis, MNQ, batch-2 skills, charts inside results (matches link out instead), sharing/exports beyond JSON copy.

---

## 11. Data model

### 11.1 MVP (no migration)

- **Recipes:** `localStorage` key `mogmine-strategy-lab-recipes-v1` = `{ recipes: Recipe[] }`, all versions kept (`id` + `version`), sanitised on read (`lib/strategy-lab/recipe.ts`). A "Copy JSON" / "Paste JSON" pair is the backup path. Not added to `lib/journal-backup.ts` in MVP (owned by `DR-1a`, `PL-3`).
- **Runs:** not persisted; the last run per recipe is kept in memory for the session. Re-running is cheap with the IndexedDB bar cache.
- **Bars:** IndexedDB via `lib/idb.ts` (§10.2).

### 11.2 Later (SL-15; SQL written as a file, applied by the integrator via MCP `apply_migration`, never by a worker)

Same shape as the existing journal tables (`supabase/migrations/20261123004734_mogmine_journal_v1.sql`: `user_id` default `auth.uid()`, text `id`, `record jsonb`, RLS own-rows **and** `mogmine_is_allowed()`, touch trigger, explicit grants as in `20261123004848_mogmine_journal_grants.sql`):

```sql
create table public.mogmine_strategy_recipes (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (length(id) between 1 and 200),
  version integer not null check (version >= 1),
  playbook_id text null,
  record jsonb not null check (jsonb_typeof(record) = 'object' and record->>'id' = id),
  archived boolean not null generated always as (coalesce((record->>'archived')::boolean, false)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id, version)
);
create index mogmine_strategy_recipes_playbook_idx on public.mogmine_strategy_recipes (user_id, playbook_id);

create table public.mogmine_strategy_runs (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (length(id) between 1 and 200),
  recipe_id text not null,
  recipe_version integer not null,
  summary jsonb not null,          -- data coverage, stats, separators (no per-bar arrays)
  matches jsonb not null,          -- compact: time, entry, stop, target, qty, outcome, features
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index mogmine_strategy_runs_recipe_idx on public.mogmine_strategy_runs (user_id, recipe_id, created_at desc);

create table public.mogmine_bars_1m (          -- the bar cache (§7.7); written by a server job only
  symbol text not null,
  time timestamptz not null,
  open numeric not null, high numeric not null, low numeric not null, close numeric not null,
  volume integer null,             -- null = missing (Yahoo 0 artifact)
  source text not null,
  fetched_at timestamptz not null default now(),
  primary key (symbol, time)
);

alter table public.mogmine_strategy_recipes enable row level security;
revoke all on table public.mogmine_strategy_recipes from anon;
create policy mogmine_strategy_recipes_own on public.mogmine_strategy_recipes for all to authenticated
  using (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()))
  with check (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()));
create trigger mogmine_strategy_recipes_touch before insert or update on public.mogmine_strategy_recipes
  for each row execute function public.mogmine_touch_row();
-- same four statements for mogmine_strategy_runs
alter table public.mogmine_bars_1m enable row level security;
revoke all on table public.mogmine_bars_1m from anon;
create policy mogmine_bars_1m_read on public.mogmine_bars_1m for select to authenticated
  using ((select public.mogmine_is_allowed()));
grant select, insert, update, delete on table public.mogmine_strategy_recipes to authenticated, service_role;
grant select, insert, update, delete on table public.mogmine_strategy_runs to authenticated, service_role;
grant select on table public.mogmine_bars_1m to authenticated;
grant select, insert, update, delete on table public.mogmine_bars_1m to service_role;
```

Market bars are not user data, so `mogmine_bars_1m` has no `user_id` (Invariant 7 covers user records) and only `service_role` writes it. Persistence goes through `lib/persistence` repositories ([26](../26-persistence-contract-and-db-readiness.md)) when SL-15 lands.

---

## 12. Phone-first UI (390×844)

All screens: `--bg-obsidian` / `--bg-surface` / `--bg-elevated`, text `--text-primary` / `--text-muted`, numbers in `--font-mono` with `tabular-nums`, gold only via tokens (Invariant 5), 44 px targets, no horizontal page overflow (tables scroll inside their own container with the first column pinned). Shield hides $ (R and points stay, UX-64). States for every screen: loading (with session progress), empty, partial data, error (Yahoo down → "Could not load bars, retry"), offline (cached sessions only).

### 12.1 Mark a point

```
┌ Strategy Lab ─────────────────────────┐
│ [ Mark ] [ Recipes ] [ Runs ]         │ ← segmented, sticky
│ Playbook  ONL Sweep + SMT        ▾    │
│ From a trade…                    ›    │
│ Date   Mon Nov 24            [ ▾ ]    │
│ Time   08:12 ET      [−1m] [+1m]      │
│ Price  5,912.25      [−] [+] tick     │
│ Side   ( Long )  ( Short )            │
│ Account SIM Eval 50K · 1R $300   ▾    │
│                                       │
│        [  Build context card  ]       │ ← thumb zone
└───────────────────────────────────────┘
```

### 12.2 Context Card

```
┌ Long · Mon 08:12 ET · 5,912.25 ───────┐
│ Data: 1m · 10 prior sessions · ✓      │
│ ▸ Candle / MTF                        │
│   15m 08:00 (forming) rng 9.50  p82   │
│   lower wick 6.25  p91 · body 1.75 ▲  │
│   5m: 3 lower highs → 1st higher low  │
│   1m reclaim: after the mark (08:14)  │
│ ▸ Levels & targets                    │
│   VWAP·G  +6.75  27t  $33.75  0.11R   │
│   ONH    +18.25  73t  $91.25  0.30R   │
│   PDL     −3.50  14t                  │
│ ▸ Stops & R                           │
│   2t below swing 5,910.25 · 2.00 pt   │
│   0.25R → 7 ct · risk 0.23R           │
│   R:R  VWAP 3.4 · ONH 9.1 · PDC≈ 11.0 │
│ ▸ Overnight · Yesterday · Week        │
│   O/N 21.5 pt ▼ · at 6% of range      │
│   Yday 48 pt ▼ · Week 18% · −22 PDC≈  │
│ ▸ Volume                              │
│   bar 2,140 · RVOL 2.3 very high      │
│   spike 4.1× · at level 6,900 / 2 tch │
│   Δ proxy + (0.31)  [proxy]           │
│                                       │
│ [ Find similar ]  [ Save as recipe ]  │
└───────────────────────────────────────┘
```

Groups collapse; Volume and Candle/MTF open by default. Each row has an ⓘ with the skill's definition and version. "After the mark" facts are in a muted sub-row.

### 12.3 Recipe list (per playbook)

```
ONL Sweep + SMT · 2 recipes        [ + New ]
┌───────────────────────────────────────┐
│ Premarket bottom, 1m reclaim   v3     │
│ long · 07:00–09:15 · 3 conditions     │
│ last run: n 14 · +0.06R · 20 sess  ›  │
└───────────────────────────────────────┘
Vocabulary for this playbook →
```

### 12.4 Recipe editor

Form first, JSON second (`[ Form | JSON ]`). Form: side, window (two time pickers), conditions as rows (`skill · output · op · value`, chosen from `listSkills()`), stop, target, max hold, sizing, slice-by chips (volume chips pre-selected). JSON tab: a monospace textarea, validated live, errors listed with paths. Saving a recipe that has runs bumps `version`.

### 12.5 Results

```
┌ Premarket bottom v3 · 20 sessions ────┐
│ n 14 · win 50% (27–73%) · +0.06R avg  │
│ exits: T 6 · S 7 · time 1 · amb 0     │
│ MFE p50 1.4× risk · MAE p50 0.6×      │
│ R = $300 (SIM Eval 50K) · 0.25R/trade │
├ Where it works ───────────────────────┤
│ RVOL ≥ 2    5/6 won · +0.21R · thin ◐ │
│ 15m wick ≥ p80  4/5 · +0.18R · thin   │
├ Where it fails ───────────────────────┤
│ Week pos > 50%  0/4 · −0.25R · thin   │
│ 12 slices tested; ~1 in 20 can look   │
│ clear by chance. Leads, not rules.    │
├ Your trades (ONL Sweep + SMT) ────────┤
│ 7 in range · 3 fit · real +0.40R      │
│ 4 don't fit · real −0.22R          ›  │
├ [ Splits ] [ Time of day ] [ Matches ]┤
│ RVOL      n   win   avgR  shrunk      │
│ low       3   —     —     (counts)    │
│ normal    5   40%  −0.02  +0.03 thin  │
│ very high 6   83%  +0.31  +0.21 thin  │
└───────────────────────────────────────┘
```

Matches list rows: date/time, outcome R, exit reason, 3 key features; tap opens a sheet with the bar window as a sparkline and "Open at this time" (a new mark at that bar). Overlay rows link to `/trades/<id>`. "Data" footer lists excluded sessions and missing-bar counts.

---

## 13. Open questions (defaults chosen, reversible)

| # | Question | Default | Why |
| :--- | :--- | :--- | :--- |
| SLQ-1 | Fill model for recipe entries | Trigger close, stop slippage 1 tick, market exits 1 tick, targets at price | Conservative without pretending to know the queue. |
| SLQ-2 | Stop and target inside one bar | Count as stop (`ambiguous-stop`), print the count | Bar order is unknown (issue #47); worst case keeps stats honest. |
| SLQ-3 | Sizing default | `risk-r 0.25` with min 1 contract, flag oversized | Matches Chris's stated 0.25R trades, so lab R ≈ real R. |
| SLQ-4 | PDC without a settlement candle | Close of the 15:59 ET 1m bar, labelled `PDC≈` | The route has no daily bar; settlement is near 16:00 ET. |
| SLQ-5 | Extremes (PDH/PDL/ONH/ONL/week) with Yahoo gaps | Use available bars, `≈` when anything is missing, withhold beyond `D-F` thresholds (3%, 15 min) | Strict completeness withholds them most days (467/480 overnight). Mirrors `D-F`. Same names and definitions as `lib/session-indicators.ts`, no third meaning. |
| SLQ-6 | Sessions served only as 5m | Exclude in MVP, list them | MVP skills need 1m; mixing timeframes silently corrupts splits. |
| SLQ-7 | Volume 0 | Missing (NaN) everywhere | Verified artifact on every response's first bar. |
| SLQ-8 | Default RVOL window and history | 5 min window, median of 10 sessions, min 5 | ~20 sessions exist; median resists one news day. |
| SLQ-9 | Min n for rates / ranking | 10 full, 5–9 "thin", < 5 counts only | Same as `PLAYBOOK_CARD_MIN_TRADES`. |
| SLQ-10 | Shrinkage | `k = 10` toward the run's overall avg R | One knob, explainable: "acts as if 10 average trades were added". |
| SLQ-11 | Recipe storage | localStorage, JSON copy/paste; Supabase in SL-15 | No migration during the swarm. |
| SLQ-12 | Where the entry links live | `/strategy-lab` by URL during the swarm; then one line in `TuneScreen` and one in `PlaybookLab` (SL-13) | Both files are owned by swarm lanes today. |
| SLQ-13 | Run in a Web Worker | Only if a 22-session run exceeds 300 ms on the phone | Keep MVP simple; measure first. |
| SLQ-14 | Dedupe default | 1 match per session, 30 min cooldown, one at a time | Overlapping matches inflate n. |
| SLQ-15 | Mark decision bar | The bar that closed at the marked minute; later facts shown "after the mark" | Prevents the card from leaking the future into "Find similar". |
| SLQ-16 | Name | "Strategy Lab", route `/strategy-lab` | Distinct from "Playbook Lab" (`/playbooks/lab`). Add to DECISIONS.md drift register at integration. |

---

## 14. Work packages

Rules: new files only unless listed; each production file ≤ 450 lines (`npm run check:file-length`); tests in `lib/__tests__/strategy-lab-*.test.ts` run by `npm test` (`node --test`, `.ts` imports with extensions, as the existing tests do); no package touches a file in any swarm lane's `writes` list ([swarm-plan.json](swarm-plan.json)) except SL-13 and SL-14, which wait for the swarm. **Read-only imports** of `lib/session.ts`, `lib/session-indicators.ts`, `lib/trades.ts`, `lib/idb.ts`, `lib/prefs.ts`, `lib/store.ts`, `lib/accounts-store.ts`, `lib/playbooks-store.ts` are fine (no edits). Styling: `app/strategy-lab/strategy-lab.css` imported from `app/strategy-lab/layout.tsx`, class prefix `sl-`, so `app/layout.tsx` (owned by `PL-2a`, `DR-2`, `LB-B2`) is not touched.

| ID | Scope | New files | Tests / acceptance | Depends | Parallel with swarm |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **SL-1** | Types, BarSeries, aggregation, registry, condition evaluator, known-at harness | `lib/strategy-lab/types.ts`, `series.ts`, `aggregate.ts`, `registry.ts`, `conditions.ts` | `strategy-lab-core.test.ts`: series drops bad OHLC and maps volume 0→NaN; ET minute across DST; 15m aggregation and `forming`; all ops incl. `crossesAbove` across a gap (false); skip → false with counted reason; the lookahead harness (truncate after `i`, values equal) as a reusable helper | — | Yes |
| **SL-2** | Bar loader + IDB cache + session coverage | `lib/strategy-lab/bars.ts` | `strategy-lab-bars.test.ts` (mocked `fetch` and IDB): 23 h windows per session; 5m response → excluded with reason; today never cached; concurrency ≤ 3; volume integrity grades | SL-1 | Yes |
| **SL-3** | S1–S4 | `lib/strategy-lab/skills/clock.ts`, `skills/mtf.ts` | `strategy-lab-skills-mtf.test.ts`: cases in §9 S1–S4 + lookahead harness | SL-1 | Yes |
| **SL-4a** | LevelBook (tolerant extremes, `availableAt`, PDC≈, OR, RTH open), S5, S6 | `lib/strategy-lab/levels.ts`, `skills/levels.ts` | `strategy-lab-levels.test.ts`: §9 S5–S6 cases; ONH absent before 09:30; `≈` flag; withheld beyond thresholds | SL-1 | Yes |
| **SL-4b** | S7, S8, S9 + incremental VWAP with golden test | `lib/strategy-lab/vwap.ts`, `skills/context.ts` | `strategy-lab-context-vwap.test.ts`: §9 S7–S9; lab VWAP equals `computeSessionIndicators` at ≥ 20 `asOf` (fixture); zero-volume first bar; resets | SL-1, SL-4a (LevelBook type) | Yes (reads `lib/session-indicators.ts`; if `IN-2` merges first, use its gap policy constant) |
| **SL-5** | V1–V5 volume skills | `lib/strategy-lab/skills/volume.ts` (split `skills/volume-flow.ts` for V3/V5 if > 450) | `strategy-lab-volume.test.ts`: §9 V1–V5 cases; NaN handling; proxy flags `degraded` + `proxy` | SL-1 | Yes |
| **SL-6** | M1–M3 measures, R | `lib/strategy-lab/skills/measure.ts`, `lib/strategy-lab/r.ts` | `strategy-lab-measure.test.ts`: entry-bar exclusion (`R-POST-1` case), ambiguous stop, slippage, flat time, long/short symmetry, R at $300 and $250, `riskMultiple` labelled separately | SL-1 | Yes (`r.ts` imports `lib/r-size.ts` only if `RS-1` merged; else prefs fallback) |
| **SL-7** | Context Card model + Mark/Card UI | `lib/strategy-lab/context-card.ts`, `app/strategy-lab/page.tsx`, `app/strategy-lab/layout.tsx`, `app/strategy-lab/strategy-lab.css`, `components/StrategyLabMark.tsx`, `components/StrategyLabContextCard.tsx` | `strategy-lab-context-card.test.ts`: groups, "after the mark" split, Shield hides $; headless 390×844: no overflow, 44 px, states (loading/partial/error/offline) | SL-2…SL-6 | Yes |
| **SL-8** | Recipe schema/validator/store, Find similar, runner | `lib/strategy-lab/recipe.ts`, `recipes-store.ts`, `similar.ts`, `runner.ts` | `strategy-lab-recipe-run.test.ts`: the four §5.3 examples validate; measure in trigger rejected; card→recipe picks per §10.4; dedupe/oneAtATime; a 22-session fixture run is deterministic | SL-1…SL-6 | Yes |
| **SL-9** | Attribution engine | `lib/strategy-lab/attribution.ts` | `strategy-lab-attribution.test.ts`: Wilson CI known values; shrinkage; tercile edges; n gating; clear/suggestive; stable/unstable halves; null bucket kept; tod buckets | SL-1 (types only) | Yes |
| **SL-10** | Results UI | `components/StrategyLabResults.tsx`, `components/StrategyLabSplits.tsx`, `components/StrategyLabMatches.tsx` | `strategy-lab-results-ui.test.ts` (model-level); 390×844 check; multiple-comparison line always present; thin rows greyed | SL-7, SL-8, SL-9 | Yes |
| **SL-11** | Real trades overlay | `lib/strategy-lab/overlay.ts`, `components/StrategyLabOverlay.tsx` | `strategy-lab-overlay.test.ts`: per-condition pass/fail with values; fit vs not-fit summary in account R; older-than-history count; samples excluded by default | SL-8 | Yes |
| **SL-12** | Recipe list + editor (form + JSON) | `components/StrategyLabRecipes.tsx`, `components/StrategyLabRecipeEditor.tsx` | `strategy-lab-editor.test.ts`: form↔JSON round trip; version bump on edit after a run; validator errors with paths | SL-8 | Yes |
| **SL-13** | Entry links | **Shared, one line each:** `components/TuneScreen.tsx` (link "Strategy Lab"), `components/PlaybookLab.tsx` (row "Recipes · Open in Strategy Lab →") | a11y route test still passes; links resolve | SL-7, swarm `PL-2b`, `PL-3`, `DR-1a` merged | **No — after the swarm** |
| **SL-14** | Agent API read endpoints | `app/api/v1/strategy-lab/skills/route.ts`, `app/api/v1/strategy-lab/context/route.ts`, `lib/agent/strategy-lab.ts`; **shared:** `lib/agent/openapi.ts` (entries) | API tests: read scope only, no numbers computed by the model | SL-7, swarm `API-*` merged | **No — after the swarm** |
| **SL-15** | Supabase recipes/runs + bar cache | `supabase/migrations/<ts>_mogmine_strategy_lab.sql` (§11.2), repository files under `lib/strategy-lab/` | SQL reviewed; applied by the integrator via MCP `apply_migration`; RLS test | SL-12; `lib/persistence` contract stable | **No — after the swarm** |
| **SL-16** | Batch-2 skills (§9 end) | `lib/strategy-lab/skills/regime.ts`, … | per-skill tests | SL-1; `IN-3` (`lib/ema.ts`) for `emaRelation` | Yes, except `emaRelation` waits for `IN-3` |

Critical path for the anchor flow: SL-1 → (SL-2 ∥ SL-3 ∥ SL-4a ∥ SL-5 ∥ SL-6 ∥ SL-9) → SL-4b → SL-7 → SL-8 → SL-10 → SL-11. With 5 helpers: wave A = SL-1; wave B = SL-2, SL-3, SL-4a, SL-5, SL-6; wave C = SL-4b, SL-9, SL-7 (model first); wave D = SL-8, SL-12; wave E = SL-10, SL-11.

**MVP done when:** at 390×844, marking Mon 11/24 08:12 long builds a Context Card with all five groups (or named reasons for each missing value), "Find similar" produces a valid recipe, the run finishes over the available 1m sessions with header coverage, works/fails cards with n and the chance warning, splits including the four volume slices, a time-of-day list, matches, and the overlay for the chosen playbook; `npm test`, `npm run lint`, `npx tsc --noEmit` and `npm run check:file-length` pass with real output in the handoff.
