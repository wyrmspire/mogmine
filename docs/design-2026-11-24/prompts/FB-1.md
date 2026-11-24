# Package Prompt: `FB-1` — ±5-Minute Fill-to-Bar Matching

- **Agent / Lane:** `swarm-2` (`L2 Trade truth`) · **Wave:** `1` · **Branch:** `swarm/FB-1`
- **Depends on:** None (Wave 1 baseline)

## 1. Goal

Build pure `±5`-minute fill-to-bar price matching (`lib/fill-match.ts`) so voice- or API-logged fills that are 1–5 minutes off snap to the nearby 1-minute candle whose range actually contains the fill price instead of triggering a false `fill_outside_bar` warning. Wire the matched bar into `observeTrade` (`lib/trade-bar-validation.ts`), chart fill markers (`lib/trade-marks.ts`), and quiet Data notes (`lib/data-notes.ts`) without mutating stored `entry_time` or `exit_time`.

## 2. Read First (Required Context)

1. `AGENTS.md` (especially Guardrail §3b-6 bar snapping, §6.5 fact vs history vs hindsight, §6.12 file-length rule)
2. `docs/design-2026-11-24/05-stops-mae-fills.md` (§4.1–§4.4, §5 row C)
3. `docs/design-2026-11-24/90-work-packages.md` (`FB-1`)
4. `docs/design-2026-11-24/92-decisions-made-by-swarm.md` — **Chosen default locked for you:**
   - **D-I (`OD-28`):** `observeTrade` and `buildMarks` use the matched bar immediately when `matchFill` returns `shifted` (without waiting for the user to tap `"Use HH:MM"` in `FB-2`), while preserving the trader's stored `entry_time` / `exit_time` untouched. Both `OD-28` (`alignToBar` for missing bars) and `FB-1` (`matchFill` for off-by-minutes prices) coexist: run `alignToBar` first when the stated minute bar is missing, then run `matchFill` from that bar.

## 3. Writable Files (Strict Scope — Everything Else Read-Only)

- `lib/fill-match.ts` *(new)*
- `lib/trade-bar-validation.ts` *(existing, ~382 lines — keep `<= 450` lines)*
- `lib/trade-marks.ts` *(existing, **509 lines — over 450-line target, grandfathered**: keep changes minimal and report before/after line counts in your handoff)*
- `lib/data-notes.ts` *(existing, ~93 lines)*
- `lib/__tests__/fill-match.test.ts` *(new)*

*(Do NOT edit `lib/trades.ts`; `RS-1` owns `lib/trades.ts` in Wave 1.)*

## 4. Step-by-Step Implementation Plan

1. **Create `lib/fill-match.ts` (pure, no DOM/React/I/O):**
   ```ts
   import type { Candle, Timeframe } from "./trades.ts";

   export type FillMatch =
     | { kind: "stated"; barTime: number }
     | { kind: "shifted"; barTime: number; statedBarTime: number; offsetMin: number }
     | { kind: "outside"; barTime: number }
     | { kind: "no-bars" };

   export interface MatchFillOptions {
     windowMin?: number;       // default 5 (for 1m bars); when barMinutes > 1, 1 bar each side
     role?: "entry" | "exit";  // default "entry" (ties: earlier bar for entry, later bar for exit)
     notBefore?: number;       // UTC ms lower bound on matched barTime (inclusive)
     notAfter?: number;        // UTC ms upper bound on matched barTime (inclusive)
     barMinutes?: number;      // default 1
   }

   export function matchFill(
     bars: readonly Candle[],
     statedInstant: number | string,
     price: number,
     symbol: string,
     opts?: MatchFillOptions,
   ): FillMatch;

   export function matchTradeFills(
     bars: readonly Candle[],
     entryInstant: number | string,
     entryPrice: number,
     exitInstant: number | string | null | undefined,
     exitPrice: number | null | undefined,
     symbol: string,
     barMinutes?: number,
   ): { entry: FillMatch; exit: FillMatch | null };
   ```
   - Exact algorithm (`05-stops-mae-fills.md` §4.2):
     1. Parse `statedInstant` to UTC ms. If `!bars.length` or non-finite time/price, return `{ kind: "no-bars" }`.
     2. Find the base bar using `alignToBar(sortedTimes, ms, timeframe)`: if `unresolved`, return `{ kind: "no-bars" }`. Call its `barTime` `baseBarTime`.
     3. Check if the bar at `baseBarTime` (if within `[notBefore, notAfter]`) contains `price` with **0 ticks tolerance** (`fillInsideBar(price, baseBar, symbol, 0)`): if yes, return `{ kind: "stated", barTime: baseBarTime }`.
     4. Search candidate bars in `bars` whose `bar.time` is within `±windowMs` of `baseBarTime` (`windowMs = barMinutes === 1 ? (opts?.windowMin ?? 5) * 60_000 : barMinutes * 60_000`) AND within `[notBefore ?? -Infinity, notAfter ?? Infinity]`, and where `fillInsideBar(price, bar, symbol, 0)` is `true`. Pick the candidate minimizing `Math.abs(bar.time - baseBarTime)`; break ties by choosing the **earlier** `bar.time` when `role !== "exit"` and the **later** `bar.time` when `role === "exit"`. If found, return `{ kind: "shifted", barTime: winner.time, statedBarTime: baseBarTime, offsetMin: Math.round((winner.time - baseBarTime) / 60_000) }`.
     5. Otherwise, if `baseBar` is within `[notBefore, notAfter]` and `fillInsideBar(price, baseBar, symbol, DEFAULT_TICK_TOLERANCE_TICKS)` (4 ticks) is `true`, return `{ kind: "stated", barTime: baseBarTime }`.
     6. Otherwise return `{ kind: "outside", barTime: baseBarTime }`.
   - `matchTradeFills`: match entry first; if closed (`exitInstant != null && exitPrice != null`), match exit with `role: "exit"` and `notBefore: entryMatchBarTime`; if entry's `shifted` bar landed after `exit`'s stated bar and caused `outside`, re-check with `entry` constrained `notAfter: exitStatedBar` so entry is never after exit.

2. **Update `lib/trade-bar-validation.ts`:**
   - Extend `TradeBarFinding` union / optional fields:
     - Add `"fill_time_shifted"` to `TradeBarFinding["code"]` with optional `statedBarTime?: number; offsetMin?: number; role?: "entry" | "exit"`.
   - In `observeTrade`:
     - Run `matchFill` for each fill in `derived.position_timeline` (maintaining monotonic `notBefore` from prior matched fill).
     - When `match.kind === "shifted"`, do **NOT** emit `fill_outside_bar`; instead emit `{ code: "fill_time_shifted", barTime: match.barTime, statedBarTime: match.statedBarTime, offsetMin: match.offsetMin, role: fill.role, price: fill.price, basis: "inferred", segment: fill.seq }`, and use `match.barTime` as that fill's effective bar time for position windows (`D-I`)!
     - When `match.kind === "outside"`, emit `fill_outside_bar` as today.

3. **Update `lib/trade-marks.ts`:**
   - Add `fill_time_shifted` to `findingAppearance` (or filter `fill_time_shifted` out of on-chart `buildFindingMarks` flags since the fill flag itself already anchors to the matched bar with `approximate: true` — per `05` §4.3: *"A `shifted` match is drawn like an `OD-28` nearby snap (visually approximate, #64)"*, and the explanation lives in Data notes, not a duplicate dot flag!).
   - Allow `BuildMarksOptions` to accept optional `bars?: readonly Candle[]` (or `matchedFills` from `facts` / `ObservedTrade` — even cleaner: attach `fillMatches?: ReadonlyMap<number, { barTime: number; shifted: boolean }>` on `ObservedTrade`!) so `buildMarks(derived, facts, ...)` automatically anchors entry/exit/lot spans and fill flags onto the matched bar (bucketed to `timeframe` on `5m`/`15m` via `Math.floor(match.barTime / barMs) * barMs`) with `approximate: true` when `shifted`! Putting `fillMatches` on `ObservedTrade` means every existing `buildMarks(derived, facts, ...)` caller in `TradeDetail.tsx` and `ReviewChart.tsx` gets matched-bar anchoring with **zero** changes to `TradeDetail.tsx`!

4. **Update `lib/data-notes.ts`:**
   - Format `fill_time_shifted` notes as `tone: "quiet"` (`"Entry drawn on the 14:13 bar; you logged 14:14."` / `"Exit drawn on the HH:MM bar; you logged HH:MM."` using `formatDetailTime(barTime, input.zone)` and `formatDetailTime(statedBarTime, input.zone)`), carrying structured metadata (`action?: { kind: "use_matched_fill"; role: "entry" | "exit"; matchedBarTime: number; label: string }`) on `DataNote` so `FB-2` can render the `"Use 14:13"` button cleanly later.

## 5. Tests to Write (`lib/__tests__/fill-match.test.ts`)

Write comprehensive `node:test` cases covering `05-stops-mae-fills.md` §4.4 & §5 row C:
1. Stated minute bar contains price → `{ kind: "stated" }`, zero findings.
2. Trade C pattern (`7263.00` logged at `14:14 CT`, printed only in `14:13 CT` bar `[7261.00, 7265.50]`, `14:14` bar `[7256.00, 7260.00]`): returns `{ kind: "shifted", offsetMin: -1 }`, `observeTrade` emits `fill_time_shifted` (no `fill_outside_bar`), `buildMarks` anchors the entry flag on `14:13` with `approximate: true`, and `collectDataNotes` produces quiet note `"Entry drawn on the 14:13 bar; you logged 14:14."` (in `America/Chicago`).
3. Tie-breaking at `-2m` and `+2m`: picks `-2m` for `role: "entry"` and `+2m` for `role: "exit"`.
4. Price not in any bar within `±5m`, but within `4` ticks of stated bar → `{ kind: "stated" }`.
5. Price outside `±5m` and `> 4` ticks from stated bar → `{ kind: "outside" }`, `fill_outside_bar` fires.
6. Entry stated before exit, but naive entry shift would pass exit → `notAfter` / ordering constraint keeps entry `<=` exit.
7. Empty bars → `{ kind: "no-bars" }`; 5m chart buckets the 1m `fillMatches` bar cleanly.

## 6. Verification Commands

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run check:file-length
```

## 7. Claim, Handoff & PR Steps

1. Claim atomically:
   ```bash
   git fetch origin
   git push origin origin/main:refs/heads/claim/FB-1
   ```
2. Write `notes/handoffs/2026-11-24-FB-1.md` with changed files, exported signatures, before/after line count of `lib/trade-marks.ts` (`509` before), and real output of the 5 commands.
3. Commit, push, and open PR:
   ```bash
   git add lib/fill-match.ts lib/trade-bar-validation.ts lib/trade-marks.ts lib/data-notes.ts lib/__tests__/fill-match.test.ts notes/handoffs/2026-11-24-FB-1.md
   git commit -m "feat(FB-1): +/-5m fill-to-bar price matching for observer, marks, and data notes"
   git push -u origin swarm/FB-1
   gh pr create --base main --title "[FB-1] +/-5-minute fill-to-bar matching" --body-file notes/handoffs/2026-11-24-FB-1.md
   ```

## 8. What NOT to Do & Out-of-Scope Rule

- Do **NOT** mutate `trade.entry_time` or `trade.exit_time` automatically.
- Do **NOT** edit `components/DataNotesChip.tsx` (`FB-2` adds the interactive button).
- Do **NOT** edit `lib/trades.ts` (`RS-1` owns it in Wave 1).
- **STOP and leave a note** in the handoff if any out-of-scope file seems needed.

HARD RULES:
- Supabase: only `mogmine_`-prefixed objects. If a package truly needs a schema change, write the SQL migration file under `supabase/migrations/` in the PR, but DO NOT apply it yourself: NEVER run `supabase db push`, NEVER run `supabase migration repair`, never use psql against the project. Note "MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP)" at the top of the handoff and PR body; code must degrade gracefully (local mode) until it is applied. Never touch `showmob_` tables, auth site_url or disable_signup settings.
- No data dumps (no exporting tables/journals/backups, no printcode full dumps committed).
- Never print, log, commit or echo secrets (.env*, tokens, keys). Do not cat env files.
- Never modify, delete or re-create Chris's real trade records or accounts (no calls to the live /api/v1 with real tokens, no Supabase writes). Use fixtures and unit tests.
- Stay inside this package's scope and its listed writable files. Out-of-scope need = stop and write it in the handoff.
- Never edit BOARD.md, NOTES.md, DECISIONS.md. Never merge PRs, never push to main, never force-push other branches, never touch other worktrees.
