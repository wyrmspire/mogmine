# Package Prompt: `NAV-1` — Move Between Days and Feed Filters

- **Agent / Lane:** `swarm-4` (`L4 Review & days`) · **Wave:** `2` · **Branch:** `swarm/NAV-1`
- **Depends on:** None (runs in Wave 2; must land before `RS-3a` and `PL-1` in Wave 3)

## 1. Goal

Extend Feed URL/chip filters (`lib/selectors.ts`, `components/FeedScreen.tsx`) with `date`, `account`, `playbook`, and `tag`, add trading-day stepping (`‹ ›` arrows, date picker, `?date=YYYY-MM-DD`, `"Back to today"`, and post-`17:00 CT` close banner) to `components/TodayScreen.tsx` + `components/DayHeader.tsx`, and add a day-filter chip row to `components/ReviewScreen.tsx`.

## 2. Read First (Required Context)

1. `AGENTS.md` (Guardrail §3b-5 session math, §4 `390×844` mobile layout & `>= 44px` tap targets)
2. `docs/design-2026-11-24/06-daily-review-and-review-cards.md` (§5)
3. `docs/design-2026-11-24/01-playbook-lab.md` (§7 Feed filter links)
4. `docs/design-2026-11-24/90-work-packages.md` (`NAV-1`)
5. `docs/design-2026-11-24/92-decisions-made-by-swarm.md`

## 3. Writable Files (Strict Scope — Everything Else Read-Only)

- `lib/selectors.ts` *(existing, ~329 lines — keep `<= 450` lines)*
- `components/FeedScreen.tsx` *(existing)*
- `components/TodayScreen.tsx` *(existing, ~110 lines)*
- `components/DayHeader.tsx` *(existing, ~28 lines)*
- `components/ReviewScreen.tsx` *(existing, ~162 lines)*
- `lib/__tests__/nav-filters.test.ts` *(new)*

## 4. Step-by-Step Implementation Plan

1. **Extend `lib/selectors.ts` (`FeedFilters` + trading-day steppers):**
   ```ts
   export interface FeedFilters {
     status: StatusFilter;
     date?: string | null;      // YYYY-MM-DD sessionDate(trade.entry_time)
     account?: string | null;   // account_id, or "unassigned" for account_id === null
     playbook?: string | null;  // playbook_id, or "none" for playbook_id === null
     tag?: string | null;       // exact string in trade.quick_tags, or "no-setup-tag"
   }

   export function parseFilters(params: { get(name: string): string | null }): FeedFilters;
   export function filtersToQuery(filters: Partial<FeedFilters>): string;
   export function matchesFeedFilters(trade: TradeRecord, filters: FeedFilters): boolean;
   export function applyFilters(trades: TradeRecord[], filters: FeedFilters): TradeRecord[];
   export function describeFilters(
     filters: FeedFilters,
     lookup?: { playbookName?: (id: string) => string | null; accountName?: (id: string) => string | null },
   ): string;
   export function stepRegularSessionDate(date: string, delta: -1 | 1): string; // skips Sat/Sun in UTC calendar arithmetic
   ```
   - Ensure `parseFilters(new URLSearchParams())` returns `{ status: "all", date: null, account: null, playbook: null, tag: null }` and `filtersToQuery({ status: "all" })` still returns `""` so all existing callers remain backward-compatible!
   - Support `playbook: "none"` (`trade.playbook_id == null`) and `tag: "no-setup-tag"` (no `SETUP_TAGS` on trade) so `PL-1` / `PL-2b` Gaps links (`/feed?playbook=none`, `/feed?tag=no-setup-tag`) match exact Lab counts!

2. **Update `components/FeedScreen.tsx`:**
   - Read `parseFilters(searchParams)` and render removable active filter chips (`date`, `account`, `playbook`, `tag`, each button `minHeight: 44`) plus `"Clear filters"`, updating the URL via `filtersToQuery`.

3. **Update `components/TodayScreen.tsx` and `components/DayHeader.tsx`:**
   - Read `?date=YYYY-MM-DD` from `useSearchParams()` (validating `YYYY-MM-DD` and falling back to `todayDate`).
   - Add `‹` (previous trading day, skipping weekends via `stepRegularSessionDate(viewedDate, -1)`), native `<input type="date">`, and `›` (next trading day, disabled when `viewedDate >= todayDate`) controls (`minHeight: 44, minWidth: 44`).
   - When `viewedDate !== todayDate`, show `"Viewing Mon, Nov 23 · Back to today"` banner/header link (`href="/"`), and show that viewed day's `PlanCard`, `DaySummary`, trades, and daily-review link (`/review/day/${viewedDate}`).
   - After the `17:00 CT` rollover (when `todayDate > sessionDate(now - 7 * 3_600_000)` / evening session has rolled forward and `previous` trading day exists while viewing `todayDate`), show a clear banner: `"Session closed. Review ${formatSessionDate(previousDate)} →"` linking to `/?date=${previousDate}` (and `/review`).
   - In `DayHeader.tsx`: add a subtle link on the date heading to `/?date=${group.date}` (or `/review/day/${group.date}` once built) while keeping `sticky` and layout clean.

4. **Update `components/ReviewScreen.tsx`:**
   - Add a horizontal scrollable day-chip row (`"All days"`, plus up to 14 unique session dates with unreviewed trades, newest first, e.g. `"Mon 23"`, `"Fri 20"`).
   - Keep the existing rule that tagging a trade does NOT jump the queue, **except** when the trader taps a different day chip, which rebuilds `ids` for that selected day (`setPosition(0)`).

## 5. Tests to Write (`lib/__tests__/nav-filters.test.ts`)

1. `parseFilters` ↔ `filtersToQuery` round-trip for `status`, `date`, `account`, `playbook` (including `"orb-reclaim"` and `"none"`), and `tag` (including URL-encoded `"Level Sweep"` → `/feed?playbook=orb-reclaim&tag=Level+Sweep` or `%20`).
2. `applyFilters` on fixture trades: deep link `/feed?playbook=orb-reclaim&tag=Level%20Sweep` returns the exact matching subset; `date` matches `sessionDate(entry_time)`.
3. `stepRegularSessionDate`: Friday `+1` → Monday; Monday `-1` → Friday; Wed `+1` → Thu; Tue `-1` → Mon.
4. `describeFilters` produces readable descriptions (`"ORB Reclaim · Level Sweep"`, `"All trades"`).

## 6. Verification Commands

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run check:file-length
```
Also verify zero horizontal page overflow at `390×844` on `/`, `/?date=2026-11-20`, `/feed?playbook=orb-reclaim&tag=Level%20Sweep`, and `/review`.

## 7. Claim, Handoff & PR Steps

1. Claim atomically:
   ```bash
   git fetch origin
   git push origin origin/main:refs/heads/claim/NAV-1
   ```
2. Write `notes/handoffs/2026-11-24-NAV-1.md` with changed files, exported functions in `lib/selectors.ts`, and real command outputs.
3. Commit, push, and open PR:
   ```bash
   git add lib/selectors.ts components/FeedScreen.tsx components/TodayScreen.tsx components/DayHeader.tsx components/ReviewScreen.tsx lib/__tests__/nav-filters.test.ts notes/handoffs/2026-11-24-NAV-1.md
   git commit -m "feat(NAV-1): trading-day navigation on Today/Review and URL filters on Feed"
   git push -u origin swarm/NAV-1
   gh pr create --base main --title "[NAV-1] Move between days and Feed filters" --body-file notes/handoffs/2026-11-24-NAV-1.md
   ```

## 8. What NOT to Do & Out-of-Scope Rule

- Do **NOT** switch `rMultiple` in `lib/selectors.ts` (`RS-3a` does that in Wave 3).
- Do **NOT** build `/review/day/[date]` (`DR-2` builds it in Wave 5).
- **STOP and leave a note** in the handoff if any out-of-scope file seems needed.

HARD RULES:
- Supabase: only `mogmine_`-prefixed objects. If a package truly needs a schema change, write the SQL migration file under `supabase/migrations/` in the PR, but DO NOT apply it yourself: NEVER run `supabase db push`, NEVER run `supabase migration repair`, never use psql against the project. Note "MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP)" at the top of the handoff and PR body; code must degrade gracefully (local mode) until it is applied. Never touch `showmob_` tables, auth site_url or disable_signup settings.
- No data dumps (no exporting tables/journals/backups, no printcode full dumps committed).
- Never print, log, commit or echo secrets (.env*, tokens, keys). Do not cat env files.
- Never modify, delete or re-create Chris's real trade records or accounts (no calls to the live /api/v1 with real tokens, no Supabase writes). Use fixtures and unit tests.
- Stay inside this package's scope and its listed writable files. Out-of-scope need = stop and write it in the handoff.
- Never edit BOARD.md, NOTES.md, DECISIONS.md. Never merge PRs, never push to main, never force-push other branches, never touch other worktrees.
