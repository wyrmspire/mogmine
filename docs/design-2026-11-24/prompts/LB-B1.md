# Package Prompt: `LB-B1` — Tap Mode: No Pills, Price-Axis Tags, and Level Hit Test

- **Agent / Lane:** `swarm-3` (`L3 Chart look`) · **Wave:** `5` · **Branch:** `swarm/LB-B1`
- **Depends on:** `LB-A` (W4), `IN-1` (W1)

## 1. Goal

Implement `levelLabels: "tap"` mode (`03-indicators-and-levels.md` §3 `LB-5`, `LB-6`): hide always-on right-edge level pills (`rightOffset: 0`), expose at most 3 price-only `priceAxisViews` on `SessionLevelsPrimitive` for the merged level groups nearest `entry_price` (excluding trade prices), build pure `hitLevel` (`lib/level-hit-test.ts`) with `10px` ray tolerance, and wire `onChartClick` in `TradeChart.tsx` with priority `neighbour box → level ray/zone → dismiss`.

## 2. Read First (Required Context)

1. `AGENTS.md` (Invariant 1 Canvas & `lightweight-charts` v5 `ISeriesPrimitive` `priceAxisViews`, Invariant 5 tokens, §6.12 `TradeChart.tsx` line count)
2. `docs/design-2026-11-24/03-indicators-and-levels.md` (§3 `LB-5`, `LB-6`, §7)
3. `docs/design-2026-11-24/90-work-packages.md` (`LB-B1`)
4. `docs/design-2026-11-24/92-decisions-made-by-swarm.md` — **Chosen default locked for you:**
   - **D-D:** `levelLabels` defaults to `"tap"` (landed in `IN-1`). In `"tap"` mode: draw **0** right-edge pills (`rightOffset = 0`), and render **at most 3** price-only `priceAxisViews` for the merged level groups nearest `entry_price`, never including the trade's own entry/stop/target prices. In `"always"` mode: preserve `LB-A`'s right-edge pills (max 8) and `rightOffset` with 0 `priceAxisViews`.

## 3. Writable Files (Strict Scope — Everything Else Read-Only)

- `lib/level-hit-test.ts` *(new)*
- `components/SessionLevelsPrimitive.ts` *(existing)*
- `components/TradeChart.tsx` *(existing, **grandfathered** — state before/after line counts)*
- `scripts/check-session-levels.mjs` *(existing)*
- `lib/__tests__/level-hit-test.test.ts` *(new)*

*(Note: `LB-B2` in Wave 6 builds `<LevelCard />`, mounts it inside `.chart-frame`, and wires `TradeDetail.tsx` + PNG export. Here in `LB-B1`, expose `onSelectLevel?: (hit: LevelHit | null) => void` on `TradeChart.tsx` props and fire it from `onChartClick` + dismiss on pan/zoom!)*

## 4. Step-by-Step Implementation Plan

1. **Create `lib/level-hit-test.ts` (pure, no DOM/Canvas):**
   ```ts
   import type { LevelLine, LevelPill } from "./chart-levels.ts";

   export interface LevelZone {
     id: string;
     label: string;
     priceLow: number;
     priceHigh: number;
     role: LevelLine["role"];
   }

   export interface LevelHit {
     kind: "group" | "zone";
     price: number;
     y: number;
     x: number;
     lines: LevelLine[];     // all merged members within 4 ticks (e.g. PDC + 3 PM close + Globex open)
     zone?: LevelZone;
   }

   export const LEVEL_HIT_TOLERANCE_PX = 10;

   /**
    * Pick up to `maxCount` (default 3) merged level groups nearest `entryPrice`,
    * excluding trade-anchor pills (`pill.tone != null`).
    */
   export function selectAxisTagGroups(
     pills: readonly LevelPill[],
     entryPrice: number,
     maxCount?: number,
   ): LevelPill[];

   /**
    * Hit-test a tap at CSS `(x, y)` against visible rays (within `tolerancePx = 10` of `priceToY(line.price)`,
    * and `x >= rayStartX && x <= rayEndX`) and zones (`y` inside `[yTop, yBottom]`).
    * Nearest ray in `|y - lineY|` wins; returns all lines belonging to that ray's merged 4-tick group!
    */
   export function hitLevel(
     lines: readonly LevelLine[],
     zones: readonly LevelZone[],
     point: { x: number; y: number },
     project: {
       priceToY: (price: number) => number | null;
       raySpanX?: (line: LevelLine) => { x0: number; x1: number } | null;
     },
     tolerancePx?: number,
   ): LevelHit | null;
   ```

2. **Update `components/SessionLevelsPrimitive.ts`:**
   - Accept `mode: "tap" | "always"` (default `"tap"`) and `symbol: string` in `update(...)`.
   - When `mode === "tap"`:
     - Draw **zero** pills in the `"labels"` pane view (all visible rays draw at normal `0.8` alpha — or `0.6` for settlements — instead of dropping/fainting from pill collisions!).
     - Implement `priceAxisViews(): readonly ISeriesPrimitiveAxisView[]` returning up to 3 axis views from `selectAxisTagGroups(pills, entryPrice, 3)`:
       - `coordinate()` → `attachment.series.priceToCoordinate(group.price) ?? -1000`
       - `text()` → `formatPrice(group.price, symbol)` (**price only**, tabular, no level name!)
       - `textColor()` → `theme.levelLabelText`
       - `backColor()` → `roleColor(theme, group.role)`
       - `visible()` / `tickVisible()` → `true` when coordinate is inside `[0, paneHeight]`.
   - When `mode === "always"`: `priceAxisViews()` returns `[]` and pills draw as in `LB-A`.
   - Add `hitTestLevel(x: number, y: number): LevelHit | null` method on `SessionLevelsPrimitive` delegating to `hitLevel`.

3. **Update `components/TradeChart.tsx`:**
   - Read `levelLabels` mode from `usePrefs().levelLabels` (or optional prop `levelLabelsMode?: "tap" | "always"` defaulting to `usePrefs().levelLabels`, so `LB-B2` export can override to `"export"` later!).
   - Add optional prop `onSelectLevel?: (hit: LevelHit | null) => void;`.
   - In `computeLevelRightOffsetBars`: pass `0` pills when `mode === "tap"` so `rightOffset` is `0`!
   - In `onChartClick`:
     1. Check neighbour trade hit first (`hitTradeId`); if hit, call `onSelectNeighbour?.(hitTradeId)` and return.
     2. Check `state.levelsPrimitive.hitTestLevel(param.point.x, param.point.y)`; if hit, call `onSelectLevel?.(levelHit)` and return.
     3. Otherwise call `onSelectLevel?.(null)` to close any open card.
   - Also call `onSelectLevel?.(null)` when the user pans or zooms (`markUserPan` / non-programmatic `subscribeVisibleLogicalRangeChange`), while ensuring a single tap (`<= 6px` movement) does NOT trigger `markUserPan`!

4. **Update `scripts/check-session-levels.mjs` (`03` §7):**
   - Test both modes: in `"tap"` mode assert `0` right-edge pills, `<= 3` `priceAxisViews` (price-only text), `rightOffset === 0`, and rays present; in `"always"` mode assert `<= 8` pills and `0` `priceAxisViews`.

## 5. Tests to Write (`lib/__tests__/level-hit-test.test.ts`)

1. `selectAxisTagGroups`: filters out trade-anchor pills (`tone != null`), picks at most 3 merged groups closest to `entryPrice` in `|group.price - entryPrice|`.
2. `hitLevel`:
   - Tap `8px` from a ray → hits and returns all merged members (e.g. `PDC 7340.75` + `Globex open 7341.00`).
   - Tap `11px` from nearest ray → `null`.
   - Two rays at `y = 100` and `y = 108`, tap at `y = 105` → nearest (`y = 108`, `3px` vs `5px`) wins.
   - Tap left of `ray.startAt` (`x < x0`) → `null`.
   - Tap inside a zone rectangle when no ray is within `10px` → hits zone.
3. Priority test: neighbour box at `(x, y)` takes precedence over a level ray at the same `(x, y)`.

## 6. Verification Commands

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run check:file-length
node scripts/check-session-levels.mjs
```

## 7. Claim, Handoff & PR Steps

1. Claim atomically:
   ```bash
   git fetch origin
   git push origin origin/main:refs/heads/claim/LB-B1
   ```
2. Write `notes/handoffs/2026-11-24-LB-B1.md` with changed files, `TradeChart.tsx` before/after line counts, and real outputs of all 6 commands.
3. Commit, push, and open PR:
   ```bash
   git add lib/level-hit-test.ts components/SessionLevelsPrimitive.ts components/TradeChart.tsx scripts/check-session-levels.mjs lib/__tests__/level-hit-test.test.ts notes/handoffs/2026-11-24-LB-B1.md
   git commit -m "feat(LB-B1): level tap mode, <=3 price-only axis tags, and hitLevel"
   git push -u origin swarm/LB-B1
   gh pr create --base main --title "[LB-B1] Tap mode: no pills, axis tags, and level hit test" --body-file notes/handoffs/2026-11-24-LB-B1.md
   ```

## 8. What NOT to Do & Out-of-Scope Rule

- Do **NOT** touch `components/TradeDetail.tsx` (`SM-3` owns `TradeDetail.tsx` in Wave 5; `LB-B2` mounts `<LevelCard />` and the View menu disclosure in Wave 6).
- **STOP and leave a note** in the handoff if any out-of-scope file seems needed.

HARD RULES:
- Supabase: only `mogmine_`-prefixed objects. If a package truly needs a schema change, write the SQL migration file under `supabase/migrations/` in the PR, but DO NOT apply it yourself: NEVER run `supabase db push`, NEVER run `supabase migration repair`, never use psql against the project. Note "MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP)" at the top of the handoff and PR body; code must degrade gracefully (local mode) until it is applied. Never touch `showmob_` tables, auth site_url or disable_signup settings.
- No data dumps (no exporting tables/journals/backups, no printcode full dumps committed).
- Never print, log, commit or echo secrets (.env*, tokens, keys). Do not cat env files.
- Never modify, delete or re-create Chris's real trade records or accounts (no calls to the live /api/v1 with real tokens, no Supabase writes). Use fixtures and unit tests.
- Stay inside this package's scope and its listed writable files. Out-of-scope need = stop and write it in the handoff.
- Never edit BOARD.md, NOTES.md, DECISIONS.md. Never merge PRs, never push to main, never force-push other branches, never touch other worktrees.
