# Package Prompt: `DR-2` — Day Review Screen, Days Strip, and 11/23 Review Migration Script

- **Agent / Lane:** `swarm-4` (`L4 Review & days`) · **Wave:** `5` · **Branch:** `swarm/DR-2`
- **Depends on:** `DR-1a` (W1), `DR-1b` (W3), `RS-3b` (W4), `PL-2a` (W4)

## 1. Goal

Build the `/review/day/[date]` screen (`app/review/day/[date]/page.tsx`, `components/DayReviewScreen.tsx`, `app/review-day.css`), mount the 14-trading-day status strip on `components/ReviewScreen.tsx`, and provide the dry-run CLI helper `scripts/migrate-1123-daily-review.mjs` (`06` §2.2) tested on fixtures only.

## 2. Read First (Required Context)

1. `AGENTS.md` (§4 `390×844` mobile, `>= 44px` tap targets, `tabular-nums`, §6.12 keep every new file `<= 450` lines)
2. `docs/design-2026-11-24/06-daily-review-and-review-cards.md` (§2 rules 1–6, §2.2, §3 Day review screen & states)
3. `docs/design-2026-11-24/90-work-packages.md` (`DR-2`)
4. `docs/design-2026-11-24/92-decisions-made-by-swarm.md` — **Chosen defaults locked for you:**
   - **Q-3:** Per-day review with optional `?account=<id>` scope selector (`All accounts` = `null` or a specific account).
   - **Q-4:** `"Done for the day"` sets `DailyReview.status = "done"` ONLY and never alters any trade's `review_status`. A separate button `"Also mark N linked trades reviewed"` marks the linked unreviewed trades `reviewed` in one tap with an `Undo` toast restoring each trade's previous `review_status`!

## 3. Writable Files (Strict Scope — Everything Else Read-Only)

- `app/review/day/[date]/page.tsx` *(new)*
- `components/DayReviewScreen.tsx` *(new — keep `<= 450` lines!)*
- `components/ReviewScreen.tsx` *(existing — mount 14-day Days strip)*
- `app/review-day.css` *(new)*
- `app/layout.tsx` *(existing — add `import "./review-day.css";`)*
- `scripts/migrate-1123-daily-review.mjs` *(new — dry-run default; **NEVER run against real accounts!**)*
- `lib/__tests__/day-review-screen.test.ts` *(new)*

## 4. Step-by-Step Implementation Plan

1. **Create `app/review-day.css` and import in `app/layout.tsx`:**
   - Style the 14-day Days strip (horizontal scroll inside its own container, status dot/pill for `none` / `draft` / `done`, `min-height: 44px`), the `/review/day/[date]` header, trade link rows (placeholder slot where `DR-3` will mount `<ReviewCard />` grid in Wave 6!), categorized points (`went_well`, `mistake`, `observation`, `next_time`), lesson textarea, and action bar (`390×844` zero overflow).

2. **Create `components/DayReviewScreen.tsx` + `app/review/day/[date]/page.tsx` (`06` §3):**
   - Header: `‹ Mon, Nov 23 ›` stepping trading days via `stepRegularSessionDate(date, -1 | 1)` (skipping weekends) + `[All accounts ▾]` scope selector updating `?account=`.
   - Summary line (`tabular-nums`, Shield-aware via `dailyReviewTotals`): `"3 trades · −0.33R net · rules 7/9 · From your journal · gross"` (hides `$` under Shield).
   - Explicit trade links (`06` §2 rule 1):
     - Before a review is saved, propose `proposeTradeIds(trades, date, accountId)` with confirm/remove toggles; once saved, if `unlinkedDayTradeIds` finds a newly logged trade for that day, show banner `"1 new trade for this day: Add it?"`.
     - Render linked trades cleanly (`TradeRow` or compact trade summary list — `DR-3` upgrades this slot to `<ReviewCard />` portrait/landscape cards in Wave 6).
   - Read-only `"Plans today"` block showing that session date's `PlanningSession` names and `lesson` texts (`06` §2 rule 3 — nothing copied automatically).
   - Four point groups (`Went well`, `Mistakes`, `Observations`, `Next time`): `+ Add` (`minHeight: 44`), inline text (`<= 500` chars, commentary placeholder per `HR-1`), optional `"about trade"` dropdown (`trade_id`), and delete button.
   - `"Lesson for tomorrow"` `<textarea maxLength={500}>` with live character count + sync save status (`useInlineSaveText` from `components/useSaveLabel.ts`).
   - Footer actions (`Q-4`):
     - `[ Done for the day ]` (toggles `status` `"draft"` ↔ `"done"` without touching `TradeRecord.review_status`).
     - `[ Also mark N trades reviewed ]` (shown when `> 0` linked trades have `review_status !== "reviewed"`; captures prior statuses in closure and shows `showToast("Marked N trades reviewed", { label: "Undo", run: ... })`).
   - States (`06` §3): loading skeleton, zero-trade day (`"A day without trades is still a review"` — allows writing observations and lesson!), offline indicator, Shield mode.

3. **Mount Days strip on `components/ReviewScreen.tsx`:**
   - Render the **Days** strip (last 14 regular trading days up to `todayDate`, showing `done ✓` / `draft` / `—`, linking to `/review/day/${d}`).

4. **Create `scripts/migrate-1123-daily-review.mjs` (`06` §2.2):**
   - Export pure `proposeDailyReviewFromPlan(plan, trades)` + `migratePlanReview(commands, planId, { apply })` (dry-run default: prints proposed `DailyReview` from a legacy review-in-plan record without modifying or deleting the plan; `--apply` creates `daily_reviews` record and leaves the plan untouched). **Never execute against live data.**

## 5. Tests to Write (`lib/__tests__/day-review-screen.test.ts`)

1. Last-14-trading-days generator skips Saturdays/Sundays and pairs each date with `"none" | "draft" | "done"` status.
2. `"Done for the day"` action helper sets `status: "done"` while leaving linked trades' `review_status` (`"new"`, `"tagged"`) completely unchanged (`Q-4`).
3. `"Also mark linked trades reviewed"` helper sets linked trades to `"reviewed"` and its `undo()` callback restores exact prior statuses (`"new"` vs `"tagged"`).
4. Zero-trade day creates and saves a valid `DailyReview` (`trade_ids: []`) with points and a 500-char lesson.
5. `migrate-1123-daily-review.mjs` dry-run makes zero writes on mocked repos; `--apply` creates `daily_reviews` and leaves the source `plans` record intact.

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
   git push origin origin/main:refs/heads/claim/DR-2
   ```
2. Write `notes/handoffs/2026-11-24-DR-2.md` with changed files, line counts (`DayReviewScreen.tsx <= 450`), and real command outputs.
3. Commit, push, and open PR:
   ```bash
   git add app/review/day/\[date\]/page.tsx components/DayReviewScreen.tsx components/ReviewScreen.tsx app/review-day.css app/layout.tsx scripts/migrate-1123-daily-review.mjs lib/__tests__/day-review-screen.test.ts notes/handoffs/2026-11-24-DR-2.md
   git commit -m "feat(DR-2): /review/day/[date] screen, 14-day Review strip, and dry-run migration helper"
   git push -u origin swarm/DR-2
   gh pr create --base main --title "[DR-2] Day review screen and Days strip" --body-file notes/handoffs/2026-11-24-DR-2.md
   ```

## 8. What NOT to Do & Out-of-Scope Rule

- **NEVER** run `scripts/migrate-1123-daily-review.mjs` against real accounts or `/api/v1`!
- Do **NOT** build `16:9` PNG export or `ReviewCard.tsx` here (`DR-3` builds them in Wave 6).
- **STOP and leave a note** in the handoff if any out-of-scope file seems needed.

HARD RULES:
- Supabase: only `mogmine_`-prefixed objects. If a package truly needs a schema change, write the SQL migration file under `supabase/migrations/` in the PR, but DO NOT apply it yourself: NEVER run `supabase db push`, NEVER run `supabase migration repair`, never use psql against the project. Note "MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP)" at the top of the handoff and PR body; code must degrade gracefully (local mode) until it is applied. Never touch `showmob_` tables, auth site_url or disable_signup settings.
- No data dumps (no exporting tables/journals/backups, no printcode full dumps committed).
- Never print, log, commit or echo secrets (.env*, tokens, keys). Do not cat env files.
- Never modify, delete or re-create Chris's real trade records or accounts (no calls to the live /api/v1 with real tokens, no Supabase writes). Use fixtures and unit tests.
- Stay inside this package's scope and its listed writable files. Out-of-scope need = stop and write it in the handoff.
- Never edit BOARD.md, NOTES.md, DECISIONS.md. Never merge PRs, never push to main, never force-push other branches, never touch other worktrees.
