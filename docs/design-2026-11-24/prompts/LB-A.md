# Package Prompt: `LB-A` — Level Labels Behind Candles, Solid Alpha Token, and Quieter Right Edge

- **Agent / Lane:** `swarm-3` (`L3 Chart look`) · **Wave:** `4` · **Branch:** `swarm/LB-A`
- **Depends on:** `UX-E` (W2 — serialized on `TradeChart.tsx`, `lib/theme.ts`, and `app/globals.css`)

## 1. Goal

Calm the chart's session-level overlay (`03-indicators-and-levels.md` §2 `LB-1`..`LB-4`): move level pills to `zOrder: "bottom"` so candles and wicks always paint on top of them, drive pill background opacity from a new `--level-label-bg-alpha: 0.95` CSS token, reserve `rightOffset` when text pills are shown (`OD-55a`), stop rays at `lastBar + 4px`, render settlement-type levels (`PDC`, `3 PM close`, settle) as `1px` dotted neutral rays at `0.6` alpha (`Q-7`), and fade level zones over their rightmost `24px` with no right border.

## 2. Read First (Required Context)

1. `AGENTS.md` (Invariant 1 Canvas only, Invariant 5 CSS variables via `lib/theme.ts`, §6.12 file-length rule for `TradeChart.tsx` and `app/globals.css`)
2. `docs/design-2026-11-24/03-indicators-and-levels.md` (§1, §2 `LB-1`..`LB-4`, §7) and `docs/design-2026-11-24/08-visual-quality.md` (§7.3 `LB-A`: reuse shared chip radius `3`, pad `6`, and JetBrains Mono font helpers from `lib/chart-paint.ts` landed by `UX-E` in Wave 2)
3. `docs/design-2026-11-24/90-work-packages.md` (`LB-A`)
4. `docs/design-2026-11-24/92-decisions-made-by-swarm.md` (`Q-7`: settlement levels `PDC`, `rth_close` / `3 PM close`, `settle` draw as 1px dotted `--level-neutral` rays at `0.6` alpha)

## 3. Writable Files (Strict Scope — Everything Else Read-Only)

- `components/SessionLevelsPrimitive.ts` *(existing, ~136 lines)*
- `components/TradeChart.tsx` *(existing, **~585 lines — grandfathered**: state before/after line counts)*
- `lib/chart-levels.ts` *(existing — tag settlement-type lines `settlement?: boolean` cleanly)*
- `lib/theme.ts` *(existing — read `--level-label-bg-alpha`)*
- `app/globals.css` *(existing, **~1,180 lines — grandfathered**: add `--level-label-bg-alpha: 0.95;` token line ONLY; state before/after line counts)*
- `scripts/check-session-levels.mjs` *(existing)*
- `lib/__tests__/session-levels.test.ts` *(existing)*

## 4. Step-by-Step Implementation Plan

1. **Add `--level-label-bg-alpha` token (`LB-2`):**
   - In `app/globals.css`: add `--level-label-bg-alpha: 0.95;` in `:root` (and in `[data-palette="blue-orange"]` if overridden; `0.95` works for both).
   - In `lib/theme.ts`: add `levelLabelBgAlpha: number;` to `ChartTheme`, parsed from `--level-label-bg-alpha` with fallback `0.95`.

2. **Tag settlement levels in `lib/chart-levels.ts` (`LB-4`, `Q-7`):**
   - Add `settlement?: boolean;` on `LevelLine` (true when `key === "pdc" || key === "rth_close"` or planned level label matches `/\b(pdc|settle|settlement|3\s*pm\s*close)\b/i`).

3. **Update `components/SessionLevelsPrimitive.ts` (`LB-1`, `LB-2`, `LB-4`):**
   - **`LB-1` Z-order:** move `"labels"` pane view from `zOrder: () => "top"` to `zOrder: () => "bottom"` (drawn right after `"rays"` in the bottom layer, so candlesticks, wicks, and `PositionBoxPrimitive` marks always paint over level pills!).
   - **`LB-2` Opacity:** replace hardcoded `ctx.globalAlpha = 0.82` with `ctx.globalAlpha = theme.levelLabelBgAlpha` (`0.95`).
   - **`LB-4` Quieter right edge:**
     - Pass `lastBarTime: number | null` into `levelsPrimitive.update(lines, theme, barMs, pills, { lastBarTime })`. Compute `lastBarX = lastBarTime != null ? scale.timeToCoordinate(Math.floor(lastBarTime / 1000) as UTCTimestamp) : null`. End rays at `rayRight = lastBarX != null ? Math.min(pane.width, Math.round(lastBarX + 4)) : pane.width` (instead of `pane.width`), keeping pills in the reserved right margin when pills are active!
     - Settlement lines (`line.settlement === true`): stroke as `1px` dotted (`ctx.setLineDash([1, 3])` or `[2, 3]`) in `theme.levelNeutral` at `0.6` alpha (unless faint `0.3`).
     - If any level zone rectangles are drawn, omit their right border and fade alpha to `0` across their rightmost `24px` via a horizontal `CanvasGradient`.
   - Expose `maxPillWidthPx(): number` (or compute pure `pillColumnBars(maxChars, barSpacing): number`) so `TradeChart.tsx` knows how many bars of `rightOffset` to reserve when pills are shown.

4. **Reserve `rightOffset` in `components/TradeChart.tsx` (`LB-3`, `OD-55a`):**
   - Add pure helper `computeLevelRightOffsetBars(pillCount: number, pillWidthPx: number, barSpacing: number): number` (`pillCount > 0 && barSpacing > 0 ? Math.ceil((pillWidthPx + 8) / barSpacing) : 0`).
   - When `p.levels.length > 0` and pills are non-empty (`always` mode now; in `LB-B1` `tap` mode will pass `0` pills so `rightOffset` automatically becomes `0`!), apply `rightOffset` on `chart.timeScale().applyOptions({ rightOffset })` on draw, zoom (`subscribeVisibleLogicalRangeChange` if `barSpacing` changed significantly — guard against feedback loops!), and resize, **without shifting the trade's fitted entry/exit bars** (extend the right edge only).

5. **Update `scripts/check-session-levels.mjs` and `lib/__tests__/session-levels.test.ts`:**
   - Assert `zOrder() === "bottom"` on both views of `SessionLevelsPrimitive`.
   - Assert `levelLabelBgAlpha === 0.95` and WCAG contrast ratio `>= 4.5:1` of `levelLabelText` against composited `surface @ 0.95` over `chartBg` in both classic and `blue-orange` palettes.
   - Assert rays terminate at `lastBarX + 4` and settlement lines use dotted neutral `0.6` alpha.
   - Assert `computeLevelRightOffsetBars` reserves space when pills exist and returns `0` when no pills exist, leaving `fitWindow` trade bar share intact.

## 5. Verification Commands

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run check:file-length
node scripts/check-session-levels.mjs
```

## 6. Claim, Handoff & PR Steps

1. Claim atomically:
   ```bash
   git fetch origin
   git push origin origin/main:refs/heads/claim/LB-A
   ```
2. Write `notes/handoffs/2026-11-24-LB-A.md` with changed files, before/after line counts for `components/TradeChart.tsx` and `app/globals.css`, and real outputs of all 6 verification commands.
3. Commit, push, and open PR:
   ```bash
   git add components/SessionLevelsPrimitive.ts components/TradeChart.tsx lib/chart-levels.ts lib/theme.ts app/globals.css scripts/check-session-levels.mjs lib/__tests__/session-levels.test.ts notes/handoffs/2026-11-24-LB-A.md
   git commit -m "feat(LB-A): level pills behind candles, 0.95 alpha token, rightOffset, and quiet right edge"
   git push -u origin swarm/LB-A
   gh pr create --base main --title "[LB-A] Level labels behind candles, solid alpha, and quieter right edge" --body-file notes/handoffs/2026-11-24-LB-A.md
   ```

## 7. What NOT to Do & Out-of-Scope Rule

- Do **NOT** implement `tap` mode or `priceAxisViews` yet (`LB-B1` does that in Wave 5).
- Do **NOT** add component rules to `app/globals.css` (1 token line only).
- **STOP and leave a note** in the handoff if any out-of-scope file seems needed.

HARD RULES:
- Supabase: only `mogmine_`-prefixed objects. If a package truly needs a schema change, write the SQL migration file under `supabase/migrations/` in the PR, but DO NOT apply it yourself: NEVER run `supabase db push`, NEVER run `supabase migration repair`, never use psql against the project. Note "MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP)" at the top of the handoff and PR body; code must degrade gracefully (local mode) until it is applied. Never touch `showmob_` tables, auth site_url or disable_signup settings.
- No data dumps (no exporting tables/journals/backups, no printcode full dumps committed).
- Never print, log, commit or echo secrets (.env*, tokens, keys). Do not cat env files.
- Never modify, delete or re-create Chris's real trade records or accounts (no calls to the live /api/v1 with real tokens, no Supabase writes). Use fixtures and unit tests.
- Stay inside this package's scope and its listed writable files. Out-of-scope need = stop and write it in the handoff.
- Never edit BOARD.md, NOTES.md, DECISIONS.md. Never merge PRs, never push to main, never force-push other branches, never touch other worktrees.
