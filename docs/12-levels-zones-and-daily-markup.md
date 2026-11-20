# 12 — Levels, Zones & the Daily Markup

How MogMine computes, draws, stores and shares price levels, and how they feed the daily plan, Position Boxes and the AI review. MogMine is a trade logger: backtesting is out of scope. It describes the premarket markup the owner already does every trading day on a TradingView layout, so the app reproduces that workflow and does not invent a second one.

IDs (`LV-nn`) are stable. Cite them in PRs and handoff notes. Open choices are `OD-20`–`OD-23` in [DECISIONS.md](../DECISIONS.md). This file builds on:

- [02 §6](02-charting-position-boxes-and-divergence.md#6-automated-session-key-levels), which covers session levels.
- [09 B-13/B-14](09-backend-risk-register.md#2-market-data-b-10--b-15), which covers session caches and point-in-time levels.
- [10 — Yahoo-First Build Plan](10-yahoo-first-build-plan.md), which covers the data source and build order.
- [11 — Mobile Workflows, Chart Context & Assistant API](11-product-workflows-and-api-context.md), which covers levels and zones as anchors, daily plans, detail presets and assistant drafts.

> [!NOTE]
> **Scope.** This is a proposal, like docs/11. It does not expand the first release (`OD-14`, `OD-16`), and it keeps `D-009`: Yahoo is the only data source, and trades come from manual entry, the test-trade tool and fixtures. The table shapes in §6 are input for the separate schema change that [06 §3](06-data-model-and-roadmap.md#3-phased-build-roadmap) requires before docs/11 proposals are built. They are not migrations.

> [!NOTE]
> **Times.** Rules are written in Central Time (CT), because that is how the owner trades and reads charts. They are the same instants as the `America/New_York` definitions required by `AGENTS.md` §3b-5 (B-20): 17:00 CT = 18:00 ET, 08:30 CT = 09:30 ET, 15:00 CT = 16:00 ET. Implement them in the shared session module. Never use a fixed `UTC-6` offset (LV-03).

---

## 1. The daily workflow this replaces

| Step | Today (TradingView, by hand or with the AI helper) | In MogMine |
| :--- | :--- | :--- |
| 1 | Before the 08:30 CT open, pull the prior session and overnight bars | Read from `market_candles`, filled by the daily archive ([10 §3](10-yahoo-first-build-plan.md#3-start-the-candle-archive-first)), plus an overnight top-up at ~08:00 CT |
| 2 | Compute ~20 candidate levels: prior day, RTH, overnight, pivots, ADR, swings, weekly, event shelves | Levels engine (§3), or a level-set draft from the AI helper (§12) |
| 3 | Merge levels within a few points into labelled zones | Zone merge (§4) |
| 4 | Clear yesterday's drawings and draw ~13 rays and rectangles with right-edge labels | `SessionLevelsPrimitive` draws the published set. Yesterday's set stops drawing but is kept (LV-12). |
| 5 | Write the plan: bias, long and short scenarios, invalidation, news times | Daily plan revision ([11 §1](11-product-workflows-and-api-context.md#1-the-daily-loop-beyond-the-chart), §8 here) |
| 6 | Size trades at ~$250 risk, target ≥ 1.5R, stops snapped to levels | Position Box defaults (§9) |
| 7 | Review trades on a 1m chart with the same levels | Trade Detail uses the level-set revision frozen at entry (§7) |
| 8 | Flag big moves nobody took | Missed-move flags (§11) |

The owner's chart conventions: `15m` for the markup, `1m` for trade review, extended hours (ETH) shown, display zone CT.

---

## 2. Sessions

| Term | Definition (CT) | Notes |
| :--- | :--- | :--- |
| **Globex session** for `session_date` D | 17:00 on the prior trading day → 16:00 on D | B-20: the evening belongs to the next day's session. Sunday 17:00 opens Monday. |
| **Overnight (ON)** | 17:00 prior day → 08:30 on D | The part of the Globex session before RTH. |
| **RTH** | 08:30 → 15:00 on D | Equity-index futures cash-session hours. |
| **Settlement** | The CME daily settlement for D | Not the last bar. Wed Nov 11: the 3 PM bar closed at 7642.75 and the settlement was 7640.50. Under `D-009` it comes from Yahoo's `1d` close, which matched the CME settlement on Nov 10 (7544.25) and Nov 11 (7640.50). Keep checking it. |
| **Week** | Globex sessions Monday → Friday | Used by `week_high` / `week_low`. |

- **LV-01 — Holidays and short days use the exchange calendar** (B-21). A holiday with no RTH session has no `rth_*` levels, and the engine must not fail on it.
- **LV-02 — Yahoo `1d` bars are labelled by the Globex start date.** The `MES=F` `1d` bar dated 2026-11-10 is the session that settles on Wed 2026-11-11. Build daily highs and lows from archived intraday bars by `session_date`, or shift the Yahoo label by one session. Getting this wrong puts the ADR window one day early. Globex sessions start and end on the hour, so session highs and lows from Yahoo's `1h` backfill (730 days, [10 §2](10-yahoo-first-build-plan.md#2-what-yahoo-serves-measured-2026-11-14)) are exact. ADR can therefore be computed on the archive's first day.
- **LV-03 — Display zone is a preference, and the owner's is `America/Chicago`** (UX-86). TradingView's fixed `UTC-6` setting matches CT only while Standard Time is in effect, so the app must never copy it. The M1 "ET axis" in [10 §7](10-yahoo-first-build-plan.md#build-order) is the product default. Until the preference exists the app displays CT for the owner (`lib/time.ts`, 2026-11-14); session math stays in `America/New_York`.

---

## 3. Level types and formulas

All prices are computed first, then snapped to the nearest tick (`MES` tick = `0.25`). They are stored in integer ticks as well as price (`AGENTS.md` §3b-4). `H`, `L` and `C` are the prior Globex session's high, low and **settlement**.

### A. Computed by code

| `type` | Label | Formula | `formed_at` |
| :--- | :--- | :--- | :--- |
| `pdh` | PDH | `max(high)` over the prior Globex session | Bar time of the high |
| `pdl` | PDL | `min(low)` over the prior Globex session | Bar time of the low |
| `pdc` | PDC / settle | Prior session's settlement | Settlement time |
| `rth_open` | RTH open | Open of the prior session's 08:30 bar | 08:30 |
| `rth_high` / `rth_low` | RTH high / low | High / low between 08:30 and 15:00 of the prior session | Bar time |
| `rth_close` | 3 PM close | Close of the 14:59 `1m` bar | 15:00 |
| `globex_open` | Globex open | Open of the first bar at 17:00 | 17:00 |
| `onh` / `onl` | ONH / ONL | High / low between 17:00 and 08:30, as of `computed_at` | Bar time. Always shown with its time. |
| `pp` | PP | `(H + L + C) / 3` | — |
| `r1` / `s1` | R1 / S1 | `2·PP − L` / `2·PP − H` | — |
| `r2` / `s2` | R2 / S2 | `PP + (H − L)` / `PP − (H − L)` | — |
| `adr_high` / `adr_low` | ADR High / Low | `Open ± ADR/2` | 17:00 |
| `adr_inner_high` / `adr_inner_low` | ADR inner high / low | `Open ± 0.33 · ADR/2` | 17:00 |
| `week_high` / `week_low` | Wk high / low | High / low of the current or prior week, as labelled | Bar time |
| `day_high` / `day_low` / `day_settle` | e.g. "Tue high" | As `pdh` / `pdl` / `pdc` for an older session, named by `source_session_date` | Bar time |

> [!WARNING]
> **Conflict with [02 §6](02-charting-position-boxes-and-divergence.md#6-automated-session-key-levels) and `mogprompt.md` §7.** Both define `PDH` / `PDL` / `PDC` as the previous **RTH** high, low and close. The owner's `PDH` / `PDL` span the whole Globex session: Tuesday's PDH of 7598.75 printed at 00:34 CT, overnight. The owner's `PDC` is the settlement. RTH values keep their own types (`rth_high`, `rth_low`, `rth_close`), so nothing is lost. Decision: `OD-21`.

**ADR (LV-04).** This matches the *ADR Pivots* indicator by ArunKBhaskar on the owner's chart. Do not use `ONL + ADR` or `ONH − ADR` envelopes.

```text
ADR      = SMA(prior-day High, 14) − SMA(prior-day Low, 14)
           over the 14 completed Globex sessions before session_date
Open     = globex_open of session_date (the 17:00 CT open)
ADR High = Open + ADR/2          ADR Low = Open − ADR/2
Inner    = Open ± 0.33 × ADR/2   (inner multiplier is a setting, default 0.33)
```

Worked check, Thu 2026-11-12:

- ADR: the 14 sessions are Oct 23 → Nov 11, so `ADR = 141.73`. With `Open = 7616.50`, ADR High is `7687.25`, ADR Low `7545.75`, and the inner bands `7640.00` / `7593.00`.
- Pivots: from `H 7671.50`, `L 7547.50`, `C 7640.50`, they are `PP 7619.75`, `R1 7692.25`, `S1 7568.25`, `R2 7743.75`, `S2 7495.75`.

Like indicators in [11 §4](11-product-workflows-and-api-context.md#4-indicator-context-is-reproducible), every computed level records its calculation version, provider, series and covered interval. A level whose inputs are missing is marked unavailable. It is never drawn as if complete.

### B. Authored (by the trader or the AI helper)

| `type` | Example | What it is |
| :--- | :--- | :--- |
| `swing_high_4h` / `swing_low_4h` | "7700 4h LH", "Nov 3 4h" | Higher-timeframe structure. On the `1m` review chart, 4h swings replace 15m swings (LV-14). |
| `swing_high_1h` / `swing_low_1h` | | 1h structure. Markup chart only by default. |
| `event_shelf` | "Tue CPI shelf" | A shelf built after a news release. `source_event_id` links the event. |
| `breakout_zone` | "Mon breakout 7456–7477" | A range price broke out of. Always a zone. |
| `custom` | | Anything else. Needs a label. |

Authored levels carry a free-text `formula` ("4h lower high, Nov 10 14:00 bar") so the source is never lost. A level may be a single price or a range (`price_low`, `price_high`).

- **LV-05 — ONH and ONL are point-in-time.** They hold only up to `computed_at`. Thursday's ONL of 7572.50 printed at 07:17, minutes before the markup. If the overnight session extends after `computed_at`, the set gets a new revision (LV-11). It is not edited in place.
- **LV-06 — One series for levels and candles.** Levels are computed from the series the chart draws. Under `OD-15` (decided 2026-11-14), `MES` charts on `MES=F` and `MNQ` on `MNQ=F` with no `ES=F`/`NQ=F` fallback, matching the owner's markup and the fixture below ([10 §4](10-yahoo-first-build-plan.md#4-finding-yahoo-has-separate-mesf-and-mnqf-series-od-15-decided)). Record the provider and series on every set. Never draw `ES=F` levels on `MES=F` candles or the reverse.

---

## 4. Zone merging

Point levels that sit close together become one zone with one combined label, so the chart shows ~13 objects and not ~25.

**LV-07 — Merge rule.**

1. Sort all non-hidden levels by price. Authored ranges (`breakout_zone`, `week_high` areas, a "Nov 3 4h" band) start as zones of their own.
2. Walk upward. A level joins the current zone when its price is within `merge_tolerance_pts` of the zone's nearest edge. The default is **5.0 pts** for `MES`, stored on the set.
3. A zone is drawn as a **ray** when `price_low = price_high`. Otherwise it is drawn as a rectangle that extends right.
4. **Label:** member labels are joined with ` / `, in this order: ADR, prior day (PDH, PDL, PDC, settle), opens, pivots, overnight, RTH, swings, weekly, events. The stored `label` is authoritative, and the author may reorder it.
5. **Role** (drives colour, §5):
   - Any member is an ADR level → `adr`.
   - Otherwise, any member is an open, a pivot or a settlement → `neutral`.
   - Otherwise, the zone is above `reference_price` → `resistance`, or below it → `support`.

   The author may override the role.
6. **Stable keys.** Every level and zone has a `key` that survives revisions (`adr_low`, `z11`). A note anchored to a zone follows it to the current revision, and a historical review keeps the revision it used ([11 §3](11-product-workflows-and-api-context.md#3-notes-attach-to-market-objects)).

Thursday examples:

- `7544.25 Tue settle`, `7545.75 ADR Low` and `7547.50 PDL` become **"ADR Low / PDL / Tue settle"**, a yellow rectangle.
- `7593.00 ADR inner low` and `7598.75 Tue high` are 5.75 pts apart, so they stay separate.

> [!WARNING]
> **Conflict with UX-21.** [08 §5](08-ux-notes-viewing-and-journaling.md#5-trade-detail-layout) merges labels "within a few ticks" with `·` ("ONL · VWAP"). The daily markup merges within points and uses ` / `. Proposed: LV-07 applies to stored zones, and UX-21 governs how labels render on the Trade Detail view. Decision: `OD-20`.

---

## 5. Style spec

**LV-08 — Colour by role, from tokens** (Invariant 5, UX-80). Primitives never hardcode hex values. They read them into the theme store, like the box colours (docs/08 §2).

| Role | Token | Default | Used for |
| :--- | :--- | :--- | :--- |
| `resistance` | `--level-resistance` | red `#EF4444` | Levels above price at markup time |
| `support` | `--level-support` | green `#22C55E` | Levels below price |
| `adr` | `--level-adr` | yellow `#EAB308` | Any zone that contains an ADR band |
| `neutral` | `--level-neutral` | gray `#9CA3AF` | Opens, pivot, settlement |
| label text | `--level-label-text` | white `#FFFFFF` | All level labels |

**LV-09 — Drawing.**

| Element | Spec |
| :--- | :--- |
| Ray | 1 px solid line in the role colour. It starts at `formed_at`, or at the left edge for prior-day levels, and runs to the right edge. |
| Rectangle | Role-colour fill at `--level-zone-opacity` (default `0.14`) with a 1 px border, extended right |
| Label | A small price tag at the **right edge**, white text on a dark pill: `7547.50 ADR Low / PDL / Tue settle`. 11 px minimum (UX-82). |
| Placement | In the empty space right of the last bar (time-scale `rightOffset`), **never over candles**. Colliding labels group or stack with a leader tick ([11 §7](11-product-workflows-and-api-context.md#7-review-gates-and-scope)). They never shrink. |
| Price axis | The live daily set may show axis tags. This is a user toggle, off by default. Archived and history items never cast prices onto the axis (LV-18). |
| Offscreen | Distant zones do not compress the price scale. They are listed as offscreen in the context list (docs/11 §3). |
| Lock | Published levels are locked. Editing creates a new revision (LV-11). |
| Colour-blind preset | The label text also carries the role. In the colour-blind preset, support and resistance swap to blue and orange (UX-80). |

**Detail presets** (`OD-17`, [11 §2](11-product-workflows-and-api-context.md#2-detail-and-full-chart-mode-are-separate)):

| Preset | Levels shown |
| :--- | :--- |
| Low | The three zones nearest the trade |
| Medium | The full published set. This is the markup view's default. |
| High | Medium, plus hidden levels and each zone's member list with formulas |

Missing-level warnings show at every preset.

> [!WARNING]
> **Conflict with [02 §6](02-charting-position-boxes-and-divergence.md#6-automated-session-key-levels).** That table styles levels by type: dashed slate for `PDH/PDL/PDC`, dotted gold for `ONH/ONL`, amber ORB and cyan IB. The owner styles levels by role (red, green, yellow, gray), and a zone mixes types. Proposed: role colours for the daily set, and the 02 §6 styles kept only for automatic intraday levels (ORB, IB) that are not part of the markup. Decision: `OD-22`.

---

## 6. Data model (proposed shape)

This would replace the fixed-column `session_levels` table ([06](06-data-model-and-roadmap.md)). Fixed columns cannot hold ~25 typed levels, authored zones, labels, formulas, stable keys or revisions. Names follow the interim canonical set (`OD-1`). Every table carries `user_id` and RLS (Invariant 7, B-40). Decision: `OD-20`. Under `OD-19`'s interim rule, these names are not committed until the owner reviews them.

```sql
-- One markup for one symbol and session. Revisions are new rows, never edits (B-14).
create table level_sets (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null,
  symbol              text not null,                 -- canonical, 'MES'
  provider            text not null,                 -- 'yahoo_finance' (D-009)
  provider_symbol     text not null,                 -- 'MES=F' or 'ES=F' (OD-15)
  contract_label      text,                          -- Yahoo meta.shortName for the session (B-12)
  session_date        date not null,                 -- B-20 definition
  revision            int  not null default 1,
  status              text not null default 'draft'
                        check (status in ('draft','published','superseded','dismissed')),
  source              text not null
                        check (source in ('engine','assistant','manual')),
  calc_version        text not null,                 -- formula version, as in docs/11 §4
  timeframe           text not null default '15m',
  merge_tolerance_pts numeric(8,2) not null default 5.0,
  reference_price     numeric(12,4),                 -- price used for support/resistance roles
  reference_price_at  timestamptz,
  inputs              jsonb not null,                -- H/L/C, globex open, ADR window and value, coverage
  computed_at         timestamptz not null,          -- what the set knew, point-in-time
  published_at        timestamptz,                   -- set by the user's publish action
  created_at          timestamptz not null default now(),
  unique (user_id, symbol, session_date, revision)
);

create table level_zones (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  level_set_id  uuid not null references level_sets(id) on delete restrict,
  key           text not null,                       -- stable across revisions
  price_low     numeric(12,4) not null,
  price_high    numeric(12,4) not null check (price_high >= price_low),
  label         text not null,
  role          text not null check (role in ('resistance','support','adr','neutral')),
  draw          text not null check (draw in ('ray','rectangle')),
  sort          int  not null,
  unique (level_set_id, key)
);

create table levels (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null,
  level_set_id        uuid not null references level_sets(id) on delete restrict,
  key                 text not null,                 -- stable across revisions
  zone_id             uuid references level_zones(id),   -- null when hidden
  type                text not null,                 -- CHECK against the §3 list
  price               numeric(12,4),                 -- point level
  price_low           numeric(12,4),                 -- authored range
  price_high          numeric(12,4),
  price_ticks         int,                           -- integer ticks for math
  label               text not null,
  formula             text not null,                 -- human-readable source
  inputs              jsonb,                         -- numbers the formula used
  source_session_date date,                          -- for day_high / day_settle etc.
  source_event_id     uuid references economic_events(id),
  formed_at           timestamptz,                   -- B-14: draw from here
  hidden              boolean not null default false,
  unique (level_set_id, key),
  check (price is not null or (price_low is not null and price_high is not null))
);
```

```typescript
export type LevelRole = 'resistance' | 'support' | 'adr' | 'neutral';
export type LevelType =
  | 'pdh' | 'pdl' | 'pdc' | 'rth_open' | 'rth_high' | 'rth_low' | 'rth_close'
  | 'globex_open' | 'onh' | 'onl' | 'pp' | 'r1' | 'r2' | 's1' | 's2'
  | 'adr_high' | 'adr_low' | 'adr_inner_high' | 'adr_inner_low'
  | 'week_high' | 'week_low' | 'day_high' | 'day_low' | 'day_settle'
  | 'swing_high_4h' | 'swing_low_4h' | 'swing_high_1h' | 'swing_low_1h'
  | 'event_shelf' | 'breakout_zone' | 'custom';

export interface Level {
  key: string;
  type: LevelType;
  price?: number; priceLow?: number; priceHigh?: number;
  label: string;
  formula: string;
  formedAt?: string;          // ISO with offset
  sourceSessionDate?: string;
  zone?: string;              // zone key
  hidden?: boolean;
}

export interface LevelZone {
  key: string; priceLow: number; priceHigh: number;
  label: string; role: LevelRole; draw: 'ray' | 'rectangle';
}

export interface LevelSet {
  schema: 'mogmine.levelset.v1';
  symbol: string; provider: string; providerSymbol: string;
  sessionDate: string; revision: number;
  source: 'engine' | 'assistant' | 'manual';
  calcVersion: string; computedAt: string; mergeTolerancePts: number;
  referencePrice?: { price: number; asOf: string; delayedMinutes?: number };
  inputs: Record<string, unknown>;
  levels: Level[]; zones: LevelZone[];
  plan?: DailyPlanDraft;
}
```

- **LV-10 — Code computes, the model never does** (B-62). Engine levels are recomputed from `inputs`, never typed in. An assistant draft is checked against the same formulas (§12).
- **LV-11 — Revisions, not edits.** A correction or a later overnight extreme creates `revision + 1`, and the old row is marked `superseded`. Trades and notes keep pointing at the revision they saw.
- **LV-12 — "Clear yesterday" means stop drawing, never delete.** Today's chart draws only today's published set. Older sets stay for history and trade snapshots.

---

## 7. Attaching levels to saved and shared trades

**LV-13 — Snapshot at entry.** When a trade is saved (manual entry or the test-trade tool under `D-009`, later the broker), the app finds the latest `published` level set for `(user_id, symbol, session_date)` with `computed_at <= entry_time`. It freezes that set on the trade:

| Column on `trades` | Contents |
| :--- | :--- |
| `level_set_id`, `level_set_revision` | Provenance |
| `levels_at_entry jsonb` | The name proposed in B-14, reused here. The zones and levels as drawn, plus code-computed facts (§10). |

- If no set existed yet, for example an overnight trade before the markup, use the prior session's set and flag `levels_stale: true`. Never back-fill a later set, because that is look-ahead (B-14).
- Shared links and Trade Cards render only from `levels_at_entry`, never from the live table. A later revision never changes a shared card. This follows the frozen-checklist rule (UX-50) and saved views in [11 §3](11-product-workflows-and-api-context.md#view-and-export-behavior).
- Shield mode (UX-71/72) does not hide levels, which contain nothing private.

**LV-14 — Review chart defaults.** The `1m` Trade Detail shows the frozen daily zones plus 4h swings, never 15m swings. Labels follow LV-09 and the detail preset in §5.

---

## 8. The daily plan and news

[11 §1](11-product-workflows-and-api-context.md#1-the-daily-loop-beyond-the-chart) proposes a revisioned daily plan on Today, with scenarios, relevant levels and zones, linked playbooks, invalidation and one practice goal (`OD-19`). This section adds what the owner's plan needs on top of that:

| Field | Example (Thu 2026-11-12) |
| :--- | :--- |
| `level_set` revision | The set the plan was written against |
| `bias`, `bias_condition` | `bullish`, "while 7547.50 holds" |
| `scenarios[]` | `{ side, trigger_zone, trigger, targets[] (zone keys), invalidation }` |
| `do_not[]` | "Don't fade a reclaim of 7640.50" |
| `risk_budget_usd`, `min_reward_risk` | `250`, `1.5` |
| `practice_goal`, `playbook` links | As in docs/11 |

- **LV-15 — Scenarios point at zone keys, not prices.** The AI review can then match a trade to a scenario without parsing prose. The plan revision must exist before the entry to count as evidence (docs/04 §1, docs/11 §5).
- **LV-16 — News is wider than Tier-1.** The owner's plan lists red-letter data, Fed speakers (with voters marked), Treasury auctions and EIA. Proposed: extend `economic_events` with `kind` (`data`, `fed_speaker`, `auction`, `eia`, `other`), `speaker`, `is_voter` and `previous_value`. `previous_value` is the `mogprompt.md` name, kept under the `OD-1` rule. The ±30-minute hazard check in [04](04-ai-review-engine.md) applies to `impact = 'high'` and to voter speakers. Show times in the display zone, with its label (UX-75).

---

## 9. Position Boxes: sizing and the three styles

### Sizing defaults (LV-17)

1. The trader saves the execution first: side, symbol, quantity, entry/exit prices and entry/exit times. Stop, target and key level remain nullable and are set afterwards on Trade Detail.
2. Default stop distance = `risk_budget_usd ÷ (qty × pointValueUsd)`. On `MES` that is 50 pts for 1 contract, 25 pts for 2, and 16.75 for 3 (tick-snapped), from `FUTURES_SPECS` (D-008).
3. **Snap the stop to structure.** If a zone edge lies within ±25 % of the default distance, move the stop one tick beyond the far edge of that zone. Show the resulting risk in dollars, and never hide the change.
4. **Target** = the first zone edge at or beyond `min_reward_risk × risk` (default 1.5R). If no zone edge is far enough, use exactly 1.5R and say so.

The 4/6/8-point chips in UX-36 are far tighter than this owner's risk. Derive the chips from the plan's risk budget and the quantity instead. For manual trades under `D-009`, offer them on Trade Detail after the execution is saved, not in the execution sheet.

### Three box styles (LV-18)

| Style | When | Look | Price axis | Markers and path |
| :--- | :--- | :--- | :--- | :--- |
| **Planned / theoretical** | A plan scenario, a "what if" or a missed-move box. Faint red (stop) and faint green (target) fills only, no outline, no purple. Fills are weaker than the actual band (D-010, [docs/15 §1](15-trade-document-and-render-grammar.md)). | Off | No fill markers. Entry, stop and target ticks only. |
| **Actual** | A trade built from fills (manual entry included) | Stronger fill in the result colour (green, red or gray), no frame, at `--position-box-opacity` (D-010) | On for the selected trade only | Fill markers, execution path, P&L or R pill |
| **Archived / history** | Older trades on a day or week chart | Thin dotted neutral outline, fill alpha ≤ 0.10, no labels | **Never** (`priceAxisViews()` returns `[]`) | None. Tap to expand to Actual. |

> [!NOTE]
> **Restated to D-010 (issue #91).** Planned versus actual is carried by fill strength and result colour, with no outline on either, so there is no dash pattern to conflict with UX-80. The earlier purple-versus-teal outlined look and its `PLAN` tag were superseded by D-010; `OD-23` and `OD-33` in [DECISIONS.md](../DECISIONS.md) record the change.

Missed-move and test-tool trades never appear in the journal feed or its statistics. They use `is_sample` ([10 §5](10-yahoo-first-build-plan.md#5-trades-without-a-broker)) or the planned style. The owner does not want automated-strategy trades in the review tool.

---

## 10. How the AI review uses levels

Facts come from code and judgments from the model (B-62, `OD-12`). The price-action-and-levels plugin is one of the two plugins [10 §7](10-yahoo-first-build-plan.md#parked-until-proven-needed) keeps. It adds a **levels block** computed from `levels_at_entry` and the plan revision in force at entry:

| Fact (code) | Example, Thu 2026-11-12 (illustrative trade, not a logged one) |
| :--- | :--- |
| `entry_zone` | Entry 7597.75 is +4.75 above "ADR inner low / Wed RTH low" (7593.00) |
| `stop_vs_structure` | Stop 7544.00 is one tick below "ADR Low / PDL / Tue settle" (7544.25–7547.50) |
| `target_zone` | Target 7687.25 is the bottom of "ADR High / R1" |
| `zones_crossed_in_trade` | Globex open / PP → ONH / Nov 3 4h → Wed settle / ADR inner high → Wed high |
| `plan_match` | Long scenario 1 (trigger zone `z09`), with the bias |
| `bias_condition_held` | `true` (7547.50 never traded) |
| `news_nearby` | Barr (voter) at 09:00, 26 min after entry |
| `levels_stale` | `false` |

- The model receives these facts as given text, such as "entry at the ADR inner low / Wed RTH low zone", and never recomputes distances.
- Code fills `key_level_context.nearest_entry_level` and `nearest_exit_level` in `AITradeReviewOutput` from this block. The model keeps only `level_execution_quality` and its commentary.
- Proposed judgment field `plan_read: string`: did the trade follow, front-run or contradict the plan? It sits in the decision-time section. Without a plan revision from before the entry, the model describes the location and asks about intent (docs/11 §5).
- Observations anchor to level and zone keys and revisions, never to pixels (docs/04 §1).

---

## 11. Missed-move flags (Later, optional)

**LV-19 — A missed move** is a session run that meets all three conditions:

- It starts from a zone in the published set.
- It travels at least `max(0.35 × ADR, 30 pts)`.
- It overlaps none of the trader's own trades (`is_sample` trades excluded).

Missed moves are hindsight by definition, and are labelled as hindsight everywhere (B-63). Each one stores the session, direction, start and end time and price, `origin_zone_key`, the level-set revision, an LV-17 `rule_box` (entry, stop, target, result, MFE in R) and a `source` (`detector`, `assistant` or `user`). It is drawn with the planned style.

Real example, Thu 2026-11-12 (Yahoo `MES=F` 1m):

- **The move:** the low was 7581.50 at 08:30. Price closed back above the 7593 zone at 08:34 (7597.75) and made its high of 7674.50 at 10:20 CT. That is +93 pts from the "ONL / S1" and "ADR inner low" zones. It is flagged if no journal trade overlapped it.
- **The LV-17 rule box:** 1 MES, entry 7597.75, stop 7544.00, target 7687.25. It peaked at ≈ +1.43R and missed its target by 12.75 pts, just under ADR High.

Backtesting and strategy research are **not** part of MogMine. The owner does that separately with his AI helper.

---

## 12. Level sets from the AI helper

The owner's AI helper computes the daily set each morning. Under [11 §5](11-product-workflows-and-api-context.md#5-assistant-api-without-assistant-controlled-layout) and `OD-19`, an external assistant may only **create a draft**. This section defines the level-set payload for that operation. It does not define an endpoint path or a credential.

- **Draft, then publish (LV-20).** An assistant submission lands as `status = 'draft'`. One tap on Today ("Publish levels") publishes it, which sets `published_at`. Dismissing it keeps the draft as history. The assistant cannot publish or accept its own draft (docs/11 §5.2). The owner chose draft-then-publish on 2026-11-14; the helper never auto-publishes.
- **Validated by code (LV-10):**
  - The server recomputes pivots and ADR bands from `inputs` against the archive. Any computed level more than one tick off is rejected with the expected value.
  - Authored types are accepted as given, but they need a `label` and a `formula`.
  - Ownership, tick precision, times and payload size are checked as listed in docs/11 §5.3.
- **Idempotent:** retries are keyed by user, client and request id (docs/11 §5.4). A changed body for the same session needs `revision + 1`.
- **Merge:** if `zones` is omitted, the server runs LV-07. If zones are present, every non-hidden level must sit inside its zone.
- **`plan` is optional.** It creates a draft plan revision. `news` items upsert into `economic_events` by `(event_time, title)`.
- **Untrusted content:** labels and formulas are text. Instructions inside them have no effect (docs/11 §5.7).
- **Export:** the same JSON, and a CSV of `price_low,price_high,label,role` rows that can be pasted into a TradingView script or a spreadsheet.

### Sample: Thu 2026-11-12, MES

Full file: `fixtures/levelsets/MES-2026-11-12.json`. Values are the owner's markup that day, checked against Yahoo `MES=F` bars. Zones are shown in full; levels are abridged.

```json
{
  "schema": "mogmine.levelset.v1",
  "doc": "docs/12-levels-zones-and-daily-markup.md",
  "symbol": "MES",
  "provider": "yahoo_finance",
  "provider_symbol": "MES=F",
  "contract_label": "MICRO E-MINI S&P 500 INDEX FUTU",
  "session_date": "2026-11-12",
  "revision": 1,
  "source": "assistant",
  "calc_version": "levels-v1",
  "computed_at": "2026-11-12T08:05:00-06:00",
  "display_tz": "America/Chicago",
  "chart": { "timeframe": "15m", "session": "ETH" },
  "reference_price": { "price": 7594.00, "as_of": "2026-11-12T08:00:00-06:00", "delayed_minutes": 10 },
  "merge_tolerance_pts": 5.0,
  "inputs": {
    "prior_session": { "session_date": "2026-11-11", "high": 7671.50, "low": 7547.50, "settle": 7640.50 },
    "prior_rth": { "open": 7612.00, "high": 7671.50, "low": 7593.00, "close_1500": 7642.75 },
    "overnight": { "globex_open": 7616.50, "onh": 7628.75, "onh_at": "2026-11-11T20:20:00-06:00",
                   "onl": 7572.50, "onl_at": "2026-11-12T07:17:00-06:00" },
    "adr": { "method": "arunkbhaskar_adr_pivots", "length": 14, "window": ["2026-10-23", "2026-11-11"],
             "value": 141.73, "day_open": 7616.50, "inner_multiplier": 0.33 }
  },
  "levels": [
    { "key": "adr_low", "type": "adr_low", "price": 7545.75, "label": "ADR Low",
      "formula": "Open − ADR/2 = 7616.50 − 70.87", "zone": "z11" },
    { "key": "pdl", "type": "pdl", "price": 7547.50, "label": "PDL",
      "formula": "min(low) over Globex session 2026-11-11", "zone": "z11" },
    { "key": "tue_settle", "type": "day_settle", "source_session_date": "2026-11-10", "price": 7544.25,
      "label": "Tue settle", "formula": "Settlement 2026-11-10 (Yahoo 1d close)", "zone": "z11" },
    { "key": "onl", "type": "onl", "price": 7572.50, "formed_at": "2026-11-12T07:17:00-06:00",
      "label": "ONL", "formula": "min(low) 17:00–08:30 CT", "zone": "z10" },
    { "key": "s2", "type": "s2", "price": 7495.75, "label": "S2", "formula": "PP − (H − L)", "hidden": true }
  ],
  "zones": [
    { "key": "z01", "price_low": 7738.75, "price_high": 7752.50, "label": "Wk high / R2", "role": "resistance", "draw": "rectangle" },
    { "key": "z02", "price_low": 7700.00, "price_high": 7700.00, "label": "4h LH", "role": "resistance", "draw": "ray" },
    { "key": "z03", "price_low": 7687.25, "price_high": 7692.25, "label": "ADR High / R1", "role": "adr", "draw": "rectangle" },
    { "key": "z04", "price_low": 7671.50, "price_high": 7671.50, "label": "Wed high", "role": "resistance", "draw": "ray" },
    { "key": "z05", "price_low": 7640.00, "price_high": 7640.50, "label": "Wed settle / ADR inner high", "role": "adr", "draw": "rectangle" },
    { "key": "z06", "price_low": 7623.75, "price_high": 7628.75, "label": "ONH / Nov 3 4h", "role": "resistance", "draw": "rectangle" },
    { "key": "z07", "price_low": 7616.50, "price_high": 7619.75, "label": "Globex open / PP", "role": "neutral", "draw": "rectangle" },
    { "key": "z08", "price_low": 7598.75, "price_high": 7598.75, "label": "Tue high", "role": "resistance", "draw": "ray" },
    { "key": "z09", "price_low": 7593.00, "price_high": 7593.00, "label": "ADR inner low / Wed RTH low", "role": "adr", "draw": "ray" },
    { "key": "z10", "price_low": 7568.25, "price_high": 7572.50, "label": "ONL / S1", "role": "support", "draw": "rectangle" },
    { "key": "z11", "price_low": 7544.25, "price_high": 7547.50, "label": "ADR Low / PDL / Tue settle", "role": "adr", "draw": "rectangle" },
    { "key": "z12", "price_low": 7512.00, "price_high": 7512.00, "label": "Tue CPI shelf", "role": "support", "draw": "ray" },
    { "key": "z13", "price_low": 7456.00, "price_high": 7477.00, "label": "Mon breakout", "role": "support", "draw": "rectangle" }
  ],
  "plan": {
    "bias": "bullish",
    "bias_condition": "Short-term pullback, but the bigger rebound holds while 7547.50 holds.",
    "risk_budget_usd": 250,
    "min_reward_risk": 1.5,
    "scenarios": [
      { "side": "long", "trigger_zone": "z09", "trigger": "7593–7599 holds into the 08:30 open",
        "targets": ["z07", "z06", "z05"], "invalidation": "Clean break under 7568" },
      { "side": "long", "trigger_zone": "z10", "trigger": "Second chance: 7568–7572 holds",
        "targets": ["z09", "z07"], "invalidation": "Clean break under 7568" },
      { "side": "short", "trigger_zone": "z07", "trigger": "Rejection at 7616.50–7620 or 7624–7629",
        "targets": ["z09", "z10"], "invalidation": "Reclaim of 7640.50" },
      { "side": "short", "trigger_zone": "z10", "trigger": "7593 breaks and 7568–7572 fails",
        "targets": ["z11", "z12"], "invalidation": "Back above 7593" }
    ],
    "do_not": ["Fade a reclaim of 7640.50: it brings 7671.50 and 7687–7692 back into play."],
    "news": [
      { "event_time": "2026-11-12T07:30:00-06:00", "kind": "data", "impact": "high",
        "title": "Initial jobless claims", "actual": "200K", "forecast": "195K" },
      { "event_time": "2026-11-12T09:00:00-06:00", "kind": "fed_speaker", "impact": "high",
        "title": "Barr speaks", "speaker": "Barr", "is_voter": true },
      { "event_time": "2026-11-12T12:00:00-06:00", "kind": "auction", "impact": "medium",
        "title": "30-year bond auction" },
      { "event_time": "2026-11-12T17:30:00-06:00", "kind": "fed_speaker", "impact": "high",
        "title": "Williams speaks", "speaker": "Williams", "is_voter": true }
    ]
  }
}
```

---

## 13. Where this fits the build order

The milestones are from [10 §7](10-yahoo-first-build-plan.md#build-order) (`OD-16`). Nothing here moves earlier than its milestone.

| Milestone | Levels work |
| :--- | :--- |
| **M0 — Archive** | None beyond the archive. Archive `MES=F` as well as `ES=F` (already in docs/10). Under `OD-15` (decided 2026-11-14), `MES` charts and computes levels on `MES=F`, matching the owner's TradingView levels. |
| **M1 — One trade on one chart** | Two-step manual entry: save the execution, then apply LV-17 sizing defaults on Trade Detail. The Actual box style. |
| **M3 — Context** | Level sets (§6), `SessionLevelsPrimitive` with LV-08/LV-09, the `levels_at_entry` snapshot, the Planned and Archived box styles. The engine computes §3A from the archive. |
| **M4 — AI** | The levels block in the data-only review (§10). |
| **After `OD-19`** | Assistant level-set drafts (§12), daily plan fields (§8). |
| **Later** | Missed-move detector (LV-19), auto-suggested 4h swings and event shelves. |

## 14. Acceptance checklist

- [ ] The Thu 2026-11-12 fixture loads as a draft, recomputes PP/R1/S1/R2/S2 and the ADR bands to the tick, publishes on one tap, and draws 13 objects.
- [ ] Labels sit right of the last bar and never cover a candle at 390 × 844 or at 1280 px wide.
- [ ] A trade entered before `computed_at` gets the prior set with `levels_stale: true`.
- [ ] A shared Trade Card is unchanged after revision 2 of its level set is published.
- [ ] A note anchored to zone `z11` follows it to revision 2, while the historical review keeps revision 1.
- [ ] Archived boxes add nothing to the price axis.
- [ ] Session tests include a DST week. Labels show CT when the display zone is CT.
