# Package Prompt: `DR-3` — Review Cards, Portrait/Landscape Orientation, and Day Sheet PNG Export

- **Agent / Lane:** `swarm-4` (`L4 Review & days`) · **Wave:** `6` · **Branch:** `swarm/DR-3`
- **Depends on:** `DR-2` (W5), `IN-1` (W1), `RS-3a` (W3)

## 1. Goal

Add per-trade visual `<ReviewCard />` cards to `components/DayReviewScreen.tsx` with a persistent **Portrait (`4:5`) | Landscape (`16:9`)** orientation toggle (`prefs.reviewCardOrientation`), add the `16:9` layout table to `lib/shareCard.ts`, and implement `"Share day"` combined PNG export (`lib/day-sheet.ts`: Day Card summary on top + review cards below, Shield on by default, PNG pre-encoded before the Share tap per `UX-70`).

## 2. Read First (Required Context)

1. `AGENTS.md` (Invariant 5 tokens, `OD-8` Canvas composition — no `html-to-image`, `UX-70` pre-built PNG before Share tap, §4 `390×844` mobile & `tabular-nums`, §6.12 `lib/shareCard.ts` & `DayReviewScreen.tsx` line counts)
2. `docs/design-2026-11-24/06-daily-review-and-review-cards.md` (§4 Review cards table, orientation, and Share day export)
3. `docs/design-2026-11-24/90-work-packages.md` (`DR-3`)
4. `docs/design-2026-11-24/92-decisions-made-by-swarm.md` — **Chosen defaults locked for you:**
   - **Q-5:** Landscape card size is **`"16:9"`** (`1920×1080` in `CARD_LAYOUT_TABLE`), remembered in `prefs.reviewCardOrientation` (`"portrait" | "landscape"`, default `"portrait"`).
   - **D-A:** Result R and risk R on review cards use account R (`resultR`, `riskComparison`).

## 3. Writable Files (Strict Scope — Everything Else Read-Only)

- `components/ReviewCard.tsx` *(new — keep `<= 450` lines)*
- `lib/shareCard.ts` *(existing, **~627 lines — grandfathered**: add `"16:9"` to `CardSize`, `CARD_SIZES`, and `CARD_LAYOUT_TABLE`; state before/after line counts)*
- `lib/day-sheet.ts` *(new — pure data builder + Canvas 2D composer for `"Share day"`, keep `<= 450` lines)*
- `components/DayReviewScreen.tsx` *(existing — mount orientation toggle, `<ReviewCard />` grid, and `"Share day"` sheet/action; keep `<= 450` lines!)*
- `lib/__tests__/review-cards-and-sheet.test.ts` *(new)*

## 4. Step-by-Step Implementation Plan

1. **Add `"16:9"` to `lib/shareCard.ts` (`Q-5`):**
   - Extend `export type CardSize = "4:5" | "9:16" | "1:1" | "16:9";`.
   - Add `"16:9": { width: 1920, height: 1080, aspectRatio: "16/9" }` to `CARD_SIZES` and proportional `CardLayoutDimensions` in `CARD_LAYOUT_TABLE["16:9"]` (chart `main` height ~56%–60% of 1080, e.g. `height: 616`).

2. **Create `components/ReviewCard.tsx` (`06` §4):**
   - Export pure `buildReviewCardCopy(trade: TradeRecord, rSize: ResolvedRSize, shield: boolean, zone: string): ReviewCardCopy` producing exact §4 fields:
     - `header`: Non-Shield `"LONG 1 · ORB Reclaim"`, Shield `"LONG · ORB Reclaim"` (size hidden; `"No setup"` when `playbook_id == null`).
     - `fills`: `"7137.00 → 7260.00 · Trailed"` (or `"7137.00 → Open"` for open trade; prices kept under Shield).
     - `stop`: `"7119.50 → 7260.00 (moved 08:30)"` or `"7119.50 → 7260.00 (time?)"` (untimed) or `"7119.50"` or `"—"`.
     - `target`: `"7180.00"` or `"—"`.
     - `result`: Non-Shield `"+2.05R · +$615"`, Shield `"+2.05R"` (zero `$` signs).
     - `risk`: Non-Shield `"0.29R ($87.50) · said 0.25R"` (or `"0.25R ($75)"` when `!differs`), Shield `"0.29R · said 0.25R"` (zero `$` signs).
     - `holdAndRules`: `"35m · rules 3/4"` (or `"35m"` when ungraded).
   - Component `<ReviewCard trade={trade} orientation={orientation} shield={shield} zone={zone} onSnapshotReady={...} />`:
     - Mounts `<ReviewChart trade={trade} sealed={false} zone={zone} privacy={shield} />` (levels off, VWAP off; gracefully renders `"Candles unavailable"` placeholder when bars are missing per `06` §3 states!).
     - Portrait (`4:5`): chart stacked above details, 1 column on `390×844`.
     - Landscape (`16:9`): chart beside details on wide screens, 2 columns per row at `>= 1024px` (1 column stacked cleanly at `390px` with zero horizontal overflow).
     - Tapping the card title/link navigates to `/trades/${trade.id}`.

3. **Create `lib/day-sheet.ts` (`06` §4 `"Share day"`):**
   - Pure `buildDaySheetModel(sessionDate, linkedTrades, orientation, shield, opts)` + Canvas 2D renderer `renderDaySheetCanvas(ctx, model, snapshotsByTradeId, theme)` on the shared obsidian/specular-gold frame (`renderDayCardCanvas` header/summary band on top + 1-column portrait or 2-column landscape grid of trade review cards below).
   - Export `daySheetFileName(sessionDate, orientation)` (safe filename, zero `$` or account IDs).

4. **Wire into `components/DayReviewScreen.tsx`:**
   - Add `Portrait | Landscape` segmented toggle (`minHeight: 44`) bound to `prefs.reviewCardOrientation` (`setPrefs({ reviewCardOrientation })`).
   - Replace the Wave 5 trade placeholder list with the `<ReviewCard />` grid.
   - Add `"Share day"` modal/sheet (Shield **on by default** per `OD-46a`!) that pre-renders the PNG `Blob` as soon as the sheet opens / toggles change so `navigator.share` / Download fires synchronously on tap (`UX-70`). Keep `DayReviewScreen.tsx <= 450` lines!

## 5. Tests to Write (`lib/__tests__/review-cards-and-sheet.test.ts`)

1. `CARD_LAYOUT_TABLE["16:9"]` dimensions (`1920×1080`, main band 55%–60% height) and `shareCardFileName(..., "16:9")`.
2. `buildReviewCardCopy` across all 7 rows of `06` §4:
   - Timed stop move (`"(moved 08:30)"`) vs untimed stop move (`"(time?)"`) vs unmoved stop vs no stop.
   - Shield privacy sweep (`shield: true`): asserts zero `$` characters and zero contract quantity leaks across `header`, `result`, `risk`, and `buildDaySheetModel`, while keeping prices, points, and account R!
3. `renderDaySheetCanvas` (using fake/mocked 2D canvas context like `lib/__tests__/day-card.test.ts`): renders cleanly in both `"portrait"` and `"landscape"`, including 0-trade day and missing-snapshot trade fallback.

## 6. Verification Commands

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run check:file-length
```
Also verify `/review/day/2026-11-20` in both Portrait and Landscape at `390×844` (1 column, zero overflow) and `1280px` (2 columns in Landscape).

## 7. Claim, Handoff & PR Steps

1. Claim atomically:
   ```bash
   git fetch origin
   git push origin origin/main:refs/heads/claim/DR-3
   ```
2. Write `notes/handoffs/2026-11-24-DR-3.md` with changed files, `lib/shareCard.ts` before/after line counts, `DayReviewScreen.tsx` / `ReviewCard.tsx` / `day-sheet.ts` line counts (`<= 450` each), and real command outputs.
3. Commit, push, and open PR:
   ```bash
   git add components/ReviewCard.tsx lib/shareCard.ts lib/day-sheet.ts components/DayReviewScreen.tsx lib/__tests__/review-cards-and-sheet.test.ts notes/handoffs/2026-11-24-DR-3.md
   git commit -m "feat(DR-3): portrait/landscape ReviewCard grid, 16:9 card layout, and Share day PNG"
   git push -u origin swarm/DR-3
   gh pr create --base main --title "[DR-3] Review cards, orientation toggle, and day sheet export" --body-file notes/handoffs/2026-11-24-DR-3.md
   ```

## 8. What NOT to Do & Out-of-Scope Rule

- Do **NOT** use `html-to-image` (`OD-8`).
- Do **NOT** add any card endpoint to `/api/v1` (`06` §4: cards are derived UI/export views over `daily_reviews`).
- **STOP and leave a note** in the handoff if any out-of-scope file seems needed.

HARD RULES:
- Supabase: only `mogmine_`-prefixed objects. If a package truly needs a schema change, write the SQL migration file under `supabase/migrations/` in the PR, but DO NOT apply it yourself: NEVER run `supabase db push`, NEVER run `supabase migration repair`, never use psql against the project. Note "MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP)" at the top of the handoff and PR body; code must degrade gracefully (local mode) until it is applied. Never touch `showmob_` tables, auth site_url or disable_signup settings.
- No data dumps (no exporting tables/journals/backups, no printcode full dumps committed).
- Never print, log, commit or echo secrets (.env*, tokens, keys). Do not cat env files.
- Never modify, delete or re-create Chris's real trade records or accounts (no calls to the live /api/v1 with real tokens, no Supabase writes). Use fixtures and unit tests.
- Stay inside this package's scope and its listed writable files. Out-of-scope need = stop and write it in the handoff.
- Never edit BOARD.md, NOTES.md, DECISIONS.md. Never merge PRs, never push to main, never force-push other branches, never touch other worktrees.
