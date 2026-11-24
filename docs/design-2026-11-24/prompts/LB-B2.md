# Package Prompt: `LB-B2` — Level Card Popover, Accessible Disclosure List, and Labelled Export

- **Agent / Lane:** `swarm-3` (`L3 Chart look`) · **Wave:** `6` · **Branch:** `swarm/LB-B2`
- **Depends on:** `LB-B1` (W5), `SM-3` (W5), `DR-2` (W5)

## 1. Goal

Complete tap-to-reveal session levels (`03-indicators-and-levels.md` §3 `LB-6`, `LB-7`): render a solid, opaque `<LevelCard />` popover inside `.chart-frame` on ray/zone tap (dismissing on outside tap, pan/zoom, Escape, or 6s, and excluded from `takeScreenshot`), add a keyboard/screen-reader level disclosure list + `"Tap | Always"` label-mode toggle in `TradeDetail.tsx` (`<= 10` net lines) that highlights the focused ray, and render up to 4 compact labelled level groups during Trade Card PNG export (`D-E`).

## 2. Read First (Required Context)

1. `AGENTS.md` (Invariant 1 `LevelCard` is DOM UI chrome like the OHLC HUD — never a position box — and stays out of `chart.takeScreenshot(true)`, §4 `390×844` mobile & `tabular-nums`, §6.12 `TradeChart.tsx` & `TradeDetail.tsx` line counts)
2. `docs/design-2026-11-24/03-indicators-and-levels.md` (§3 `LB-6` Level card & keyboard disclosure, `LB-7` Exports, §7)
3. `docs/design-2026-11-24/90-work-packages.md` (`LB-B2`)
4. `docs/design-2026-11-24/92-decisions-made-by-swarm.md` — **Chosen default locked for you:**
   - **D-E:** Trade Card PNG exports (`screenshot()` in `TradeChart.tsx` / `TradeCardSheet.tsx`) draw compact pills for **at most 4** merged level groups (the trade's `key_level_price` if present + merged groups nearest `entry_price`) in the `LB-1`/`LB-2` solid behind-candle style with `LB-3` right offset, then restore live `"tap"` mode immediately after taking the canvas snapshot!

## 3. Writable Files (Strict Scope — Everything Else Read-Only)

- `components/LevelCard.tsx` *(new)*
- `components/TradeChart.tsx` *(existing, **grandfathered** — state before/after line counts)*
- `components/TradeCardSheet.tsx` *(existing — if export preview triggers `screenshot()`)*
- `components/TradeDetail.tsx` *(existing, **grandfathered** — `<= 10` net lines; state before/after line counts)*
- `app/levels.css` *(new)*
- `app/layout.tsx` *(existing — add `import "./levels.css";`)*
- `lib/__tests__/level-card.test.ts` *(new)*

## 4. Step-by-Step Implementation Plan

1. **Create `components/LevelCard.tsx` + `app/levels.css` (imported in `app/layout.tsx`):**
   - Export pure layout/copy helpers `formatLevelCardData(hit: LevelHit, symbol: string): LevelCardView` and `clampPopoverPosition(anchor: { x: number; y: number }, cardSize: { width: number; height: number }, frameSize: { width: number; height: number }, hudHeight?: number): { left: number; top: number }` (never covering the top `.chart-hud` readout or overflowing `.chart-frame`!).
   - Style `.level-card` in `app/levels.css` with a **solid/near-opaque** surface background (`background: var(--bg-elevated)` at `>= 0.96` opacity, subtle `1px solid var(--border-strong)`, crisp `tabular-nums` prices):
     ```
     PDC · 3 PM close          7340.75
     Globex open               7341.00
     Prior session · computed
     ```
     Show each merged member's name, exact formatted price (`tabular-nums`), source (`computed` vs `planned: <session>`), and partial-coverage tag if present (never showing withheld levels, which aren't drawn).
   - Auto-dismiss after `6000 ms`, on `Escape`, or on close button (`×`), with `role="dialog"` / `aria-label="Session level details"` (non-modal so chart gestures work; tapping outside/panning/zooming dismisses immediately via `LB-B1`'s `onSelectLevel(null)`).
   - Also export a compact `<LevelsDisclosureList />` component inside `components/LevelCard.tsx` (so `TradeDetail.tsx` mounts it in `<= 5` lines!) providing:
     - `Tap | Always` toggle bound to `setPrefs({ levelLabels })`.
     - Accessible `<details>` disclosure listing every active level with tabular price; focusing or hovering a row calls `onHighlightPrice(line.price_ticks)` (`null` on blur) so keyboard/screen-reader users can inspect every level without touching the canvas!

2. **Update `components/TradeChart.tsx` (and `components/TradeCardSheet.tsx` if needed):**
   - Manage `openLevelHit` state from `LB-B1`'s hit test and render `<LevelCard hit={openLevelHit} ... />` as a sibling DOM element over `.chart-host` (outside `lightweight-charts` canvas, so `chart.takeScreenshot(true)` NEVER includes `<LevelCard />`!).
   - Support optional `highlightedLineTick?: number | null` prop passed to `levelsPrimitive` (emphasizing the focused ray).
   - **`LB-7` / `D-E` Export (`screenshot()`):**
     - Add pure selector `selectExportLevelPills(pills: readonly LevelPill[], entryPrice: number, keyLevelPrice: number | null, maxGroups = 4): LevelPill[]` (excludes trade entry/stop/target anchors except keeps `key_level_price` if set, plus nearest groups to `entryPrice`, capped at `4`).
     - In `screenshot()` on `TradeChartHandle`: when `levels.length > 0` and live mode is `"tap"`, temporarily switch `levelsPrimitive` to export-pills mode (`<= 4` pills + matching `rightOffset`), call `chart.takeScreenshot(true, false)`, and immediately restore live `"tap"` mode (`0` pills, `rightOffset: 0`) synchronously!

3. **Mount `<LevelsDisclosureList />` in `components/TradeDetail.tsx` (`<= 10` net lines):**
   - Replace/augment the static View menu level status row with `<LevelsDisclosureList ... />` and pass `highlightedLineTick` to `<TradeChart />`.

## 5. Tests to Write (`lib/__tests__/level-card.test.ts`)

1. `formatLevelCardData`: formats merged members (`PDC`, `3 PM close`, `Globex open`) with tabular prices and accurate `computed` vs `planned: Pre-market` source strings.
2. `clampPopoverPosition`: keeps card strictly within `[4, frameWidth - width - 4]` and below `hudHeight` (`>= 32px`) at `390×844` even when tapping near top-left or bottom-right edges.
3. `selectExportLevelPills` (`D-E`): caps output at `<= 4` groups, prioritizes `key_level_price` when present followed by groups nearest `entryPrice`, and excludes trade entry/stop/target pills.
4. Verifies `<LevelCard />` is DOM chrome outside canvas (`takeScreenshot` excludes it).

## 6. Verification Commands

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run check:file-length
```
Also verify at `390×844` that tapping a ray opens `LevelCard` inside `.chart-frame` with zero horizontal overflow and without covering `.chart-hud`.

## 7. Claim, Handoff & PR Steps

1. Claim atomically:
   ```bash
   git fetch origin
   git push origin origin/main:refs/heads/claim/LB-B2
   ```
2. Write `notes/handoffs/2026-11-24-LB-B2.md` with changed files, `TradeChart.tsx` and `TradeDetail.tsx` before/after line counts, and real command outputs.
3. Commit, push, and open PR:
   ```bash
   git add components/LevelCard.tsx components/TradeChart.tsx components/TradeCardSheet.tsx components/TradeDetail.tsx app/levels.css app/layout.tsx lib/__tests__/level-card.test.ts notes/handoffs/2026-11-24-LB-B2.md
   git commit -m "feat(LB-B2): LevelCard tap popover, accessible level disclosure, and <=4 export pills"
   git push -u origin swarm/LB-B2
   gh pr create --base main --title "[LB-B2] Level card popover, accessible list, and labelled export" --body-file notes/handoffs/2026-11-24-LB-B2.md
   ```

## 8. What NOT to Do & Out-of-Scope Rule

- Do **NOT** put CSS rules into `app/globals.css` (all new rules belong in `app/levels.css`).
- Do **NOT** let `TradeDetail.tsx` grow by more than 10 net lines.
- **STOP and leave a note** in the handoff if any out-of-scope file seems needed.

HARD RULES:
- Supabase: only `mogmine_`-prefixed objects. If a package truly needs a schema change, write the SQL migration file under `supabase/migrations/` in the PR, but DO NOT apply it yourself: NEVER run `supabase db push`, NEVER run `supabase migration repair`, never use psql against the project. Note "MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP)" at the top of the handoff and PR body; code must degrade gracefully (local mode) until it is applied. Never touch `showmob_` tables, auth site_url or disable_signup settings.
- No data dumps (no exporting tables/journals/backups, no printcode full dumps committed).
- Never print, log, commit or echo secrets (.env*, tokens, keys). Do not cat env files.
- Never modify, delete or re-create Chris's real trade records or accounts (no calls to the live /api/v1 with real tokens, no Supabase writes). Use fixtures and unit tests.
- Stay inside this package's scope and its listed writable files. Out-of-scope need = stop and write it in the handoff.
- Never edit BOARD.md, NOTES.md, DECISIONS.md. Never merge PRs, never push to main, never force-push other branches, never touch other worktrees.
