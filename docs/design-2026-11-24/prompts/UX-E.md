# Package Prompt: `UX-E` — Modern Position Zones (Visual Polish from `08-visual-quality.md`)

- **Agent / Lane:** `swarm-3` (`L3 Chart look`) · **Wave:** `2` · **Branch:** `swarm/UX-E`
- **Depends on:** `IN-1` (Wave 1) **AND `docs/design-2026-11-24/08-visual-quality.md` on `origin/main`**

## 1. Goal

Upgrade the visual styling of trade position boxes/zones on the chart (entry/stop/target risk and reward zones, plan vs actual rectangles, borders, and zone labels) from their dated, scanline-heavy "8-bit computer" look to the crisp, TradingView-grade palette specified in `docs/design-2026-11-24/08-visual-quality.md`. This package is **100% visual**: do NOT alter coordinate projection, bar anchoring, hit-testing, data structures, or pan/zoom behavior, while keeping Shield mode, the `blue-orange` accessibility palette, candle readability, and Trade Card PNG exports working seamlessly.

## 2. Read First (CRITICAL — DO NOT GUESS COLORS)

1. **`docs/design-2026-11-24/08-visual-quality.md`** — **READ THIS FILE FIRST FROM YOUR WORKTREE.** If `docs/design-2026-11-24/08-visual-quality.md` does not exist in your worktree yet, **STOP IMMEDIATELY** and write `"BLOCKED: docs/design-2026-11-24/08-visual-quality.md not yet merged on origin/main"` in `notes/handoffs/2026-11-24-UX-E.md`. Do NOT invent or guess hex colors, alphas, or stroke widths!
2. `AGENTS.md` (Invariant 1 Canvas primitive only, Invariant 5 CSS variables / dynamic slider updates via `lib/theme.ts`, §4 mobile checklist, §6.12 file-length rule)
3. `docs/design-2026-11-24/92-decisions-made-by-swarm.md` (`D-J` / `D-V1`..`D-V5`: implement `08-visual-quality.md`'s exact token object, alphas, strokes, `lib/chart-paint.ts` helpers, and writable file list, adopting `D-V1`..`D-V5` as recommended in `08-visual-quality.md`, including 1 px price-edge lines at entry/stop/target only)

## 3. Writable Files (Exact List from `08-visual-quality.md` §7.2 — Everything Else Read-Only)

- `components/PositionBoxPrimitive.ts` *(existing, 379 lines; target `<= 440` lines; state before/after line count)*
- `lib/chart-paint.ts` *(new — helpers `crisp`, `dashFor`, `drawChip`, `zoneGradient`; `<= 120` lines)*
- `lib/theme.ts` *(existing — new keys, `--font-mono` / `--font-sans`, `document.fonts?.ready.then(refreshTheme)`)*
- `app/globals.css` *(existing, **1,174 lines — grandfathered**: `:root` chart tokens and `[data-palette="blue-orange"]` block ONLY; state before/after line count)*
- `components/TradeChart.tsx` *(existing, **578 lines — grandfathered**: options ONLY at lines 229–241, 329, 346–348, net `<= +6` lines; state before/after line count)*
- `lib/shareCard.ts` *(existing, **627 lines — grandfathered**: `DEFAULT_CARD_THEME` new `ChartTheme` keys ONLY; state before/after line count)*
- `lib/__tests__/chart-paint.test.ts` *(new — crisp DPR `1/2/2.625/3` snapping, chip width, dash table, token pinning, and `>= 4.5:1` chip text contrast in both palettes)*
- `scripts/check-position-box.mjs` *(existing — only if its theme stub needs the new `ChartTheme` keys)*
- `notes/handoffs/2026-11-24-UX-E-*.png` *(required before/after headless screenshots for `mes-opening-scalp`, `mnq-trend-hold`, `mes-failed-reclaim` at `390×844` and `1280px` in default and `blue-orange` palettes)*

## 4. Step-by-Step Implementation Plan

1. **Read `docs/design-2026-11-24/08-visual-quality.md` completely** and extract:
   - The exact CSS custom properties for `:root` (classic dark Obsidian theme) and `[data-palette="blue-orange"]` (accessibility blue/orange palette).
   - The exact `chartTheme` / `ChartTheme` token object (zone fills, alphas, border colors/widths, label text colors/fonts, candle/grid harmonies, and how `--position-box-opacity` scales zone fills live when dragged on Tune).
   - The exact Canvas drawing rules for `PositionBoxPrimitive.ts` (replacing ugly 3px dotted scanline loops or harsh fills with the clean semi-transparent fills, crisp 1px borders/dividers, and legible typography specified in `08-visual-quality.md`).
2. **Centralize tokens:**
   - Put the named tokens into `app/globals.css` (`:root` + `[data-palette="blue-orange"]`) and `lib/theme.ts` (and `lib/chart-theme.ts` if specified by `08`), reading CSS variables once on theme refresh (never calling `getComputedStyle` per animation frame, per `AGENTS.md` §3b-7).
3. **Update `components/PositionBoxPrimitive.ts` (and `TradeChart.tsx` / `ReviewChart.tsx` if specified in `08`):**
   - Apply the exact zone fill, border stroke, archived-neighbour faintness (`<= 0.1` alpha), and label typography from `08-visual-quality.md`.
   - **CRITICAL:** Do **NOT** change `timeToCoordinate`, `priceToCoordinate`, `bounds(...)`, `alignTradeToBars`, `hitTestArchivedBoxes`, or any geometry/anchoring/data behavior!
   - Keep candles clearly readable (`zOrder: "bottom"` for zone fills so candlesticks and wicks paint cleanly over the position zones) and keep `chart.takeScreenshot(true)` / Trade Card PNG output consistent.
4. **Capture Before & After Headless Screenshots (`390×844` and `1280px`):**
   - Before editing (on `origin/main` checkout or stashed baseline), capture headless Chrome screenshots of a trade chart with a Position Box (e.g. sample trade on `/trades/...` at `390×844` and `1280×800`) to `notes/handoffs/2026-11-24-UX-E-before-390.png` and `notes/handoffs/2026-11-24-UX-E-before-1280.png`.
   - After applying `08-visual-quality.md`, capture the matching after screenshots to `notes/handoffs/2026-11-24-UX-E-after-390.png` and `notes/handoffs/2026-11-24-UX-E-after-1280.png` (and verify `blue-orange` palette + Shield mode). List all PNG paths in `notes/handoffs/2026-11-24-UX-E.md`.

## 5. Tests to Write (`lib/__tests__/chart-paint.test.ts`)

Write `node:test` unit tests covering:
1. **Token pinning:** asserts every hex color, alpha multiplier, stroke width, and font token in the centralized theme constant matches `08-visual-quality.md` for both `"classic"` and `"blue-orange"` palettes.
2. **WCAG contrast check (`>= 4.5:1`):** implements standard relative-luminance + alpha-compositing over `--chart-bg` (and composited zone fill over `--chart-bg`) and asserts contrast ratio `>= 4.5` for profit label text, risk label text, and neutral/entry label text in both `"classic"` and `"blue-orange"` across the `boxOpacity` slider range (`0.15`..`0.65`).
3. **Slider reactivity:** changing `--position-box-opacity` updates computed zone alpha proportionally without mutating base hex tokens.
4. **Geometry invariance:** `hitTestArchivedBoxes` and `scripts/check-position-box.mjs` pass unchanged.

## 6. Verification Commands

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run check:file-length
node scripts/check-position-box.mjs
```

## 7. Claim, Handoff & PR Steps

1. Claim atomically:
   ```bash
   git fetch origin
   git push origin origin/main:refs/heads/claim/UX-E
   ```
2. Write `notes/handoffs/2026-11-24-UX-E.md` listing the exact tokens implemented from `08-visual-quality.md`, before/after line counts for any grandfathered file touched (`app/globals.css`, `components/TradeChart.tsx`, `lib/shareCard.ts`), paths to the `390×844` and `1280px` before/after PNGs, and real command outputs.
3. Commit, push, and open PR:
   ```bash
   git add -A
   git status   # verify ONLY files in §3 and notes/handoffs/2026-11-24-UX-E* are staged
   git commit -m "style(UX-E): modern position zones and chart palette per 08-visual-quality"
   git push -u origin swarm/UX-E
   gh pr create --base main --title "[UX-E] Modern position zones from 08-visual-quality" --body-file notes/handoffs/2026-11-24-UX-E.md
   ```

## 8. What NOT to Do & Out-of-Scope Rule

- Do **NOT** invent colors if `08-visual-quality.md` is missing — STOP and write a blocker handoff.
- Do **NOT** change position box geometry, time/price anchoring, `lib/trade-marks.ts`, or `components/TradeDetail.tsx`.
- **STOP and leave a note** in `notes/handoffs/2026-11-24-UX-E.md` if `08-visual-quality.md` specifies a file outside §3.

HARD RULES:
- Supabase: only `mogmine_`-prefixed objects. If a package truly needs a schema change, write the SQL migration file under `supabase/migrations/` in the PR, but DO NOT apply it yourself: NEVER run `supabase db push`, NEVER run `supabase migration repair`, never use psql against the project. Note "MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP)" at the top of the handoff and PR body; code must degrade gracefully (local mode) until it is applied. Never touch `showmob_` tables, auth site_url or disable_signup settings.
- No data dumps (no exporting tables/journals/backups, no printcode full dumps committed).
- Never print, log, commit or echo secrets (.env*, tokens, keys). Do not cat env files.
- Never modify, delete or re-create Chris's real trade records or accounts (no calls to the live /api/v1 with real tokens, no Supabase writes). Use fixtures and unit tests.
- Stay inside this package's scope and its listed writable files. Out-of-scope need = stop and write it in the handoff.
- Never edit BOARD.md, NOTES.md, DECISIONS.md. Never merge PRs, never push to main, never force-push other branches, never touch other worktrees.
