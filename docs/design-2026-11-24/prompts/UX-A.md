# Package Prompt: `UX-A` — Copy, Session-Count, Review-Queue, and Late-Plan Window Fixes

- **Agent / Lane:** `swarm-4` (`L4 Review & days`) · **Wave:** `7` · **Branch:** `swarm/UX-A`
- **Depends on:** `UX-D` (W6), `NAV-1` (W2)

## 1. Goal

Resolve the three copy/counting mismatches from the 11/23 session (`06-daily-review-and-review-cards.md` §6, `02-ux.md` `UX-04`..`UX-06`): unify Today's trade-count header via pure `dayTradeCounts` (`lib/day-counts.ts`) so `"1 trade today (0 closed)"` never contradicts account cards, align Review queue wording (`"12 to review · 1 needs tags"`, plus a link to `/playbooks/lab` in Review's `"All caught up"` state per `Q-1`), and make an unanchored plan written after the session close window the entire session (`18:00 ET → 17:00 ET`) with a clear note (`lib/session-review.ts`, `components/SessionReview.tsx`).

## 2. Read First (Required Context)

1. `AGENTS.md` (Guardrail §3b-5 `America/New_York` session bounds, §4 `390×844` mobile & `tabular-nums`)
2. `docs/design-2026-11-24/06-daily-review-and-review-cards.md` (§6 Fixes that belong here — all 3 bullets)
3. `docs/design-2026-11-24/02-ux.md` (`UX-04`, `UX-05`, `UX-06`)
4. `docs/design-2026-11-24/90-work-packages.md` (`UX-A` — **Note planner spot-check:** `"1 trade this session"` and `"12 open"` live in `components/TodayScreen.tsx` lines 56 & 97, NOT `components/AppShell.tsx`!)
5. `docs/design-2026-11-24/92-decisions-made-by-swarm.md` (`Q-1`: link `/playbooks/lab` from Review `"All caught up"` state)

## 3. Writable Files (Strict Scope — Everything Else Read-Only)

- `lib/day-counts.ts` *(new)*
- `components/TodayScreen.tsx` *(existing)*
- `components/ReviewScreen.tsx` *(existing)*
- `lib/session-review.ts` *(existing)*
- `components/SessionReview.tsx` *(existing)*
- `lib/__tests__/day-counts.test.ts` *(new)*
- `lib/__tests__/session-review.test.ts` *(existing)*

*(Do NOT edit `components/AppShell.tsx` — `PL-3` owns `AppShell.tsx` in Wave 7, and the session trade count text is in `components/TodayScreen.tsx`!)*

## 4. Step-by-Step Implementation Plan

1. **Create `lib/day-counts.ts` (`06` §6 bullet 1 & bullet 2):**
   ```ts
   import type { TradeRecord } from "./trades.ts";

   export interface DayTradeCounts {
     entered: number;      // sessionDate(trade.entry_time) === date
     closed: number;       // trade.exit_time != null && sessionDate(trade.exit_time) === date
     openEntered: number;  // entered on `date` and still open
   }

   export function dayTradeCounts(trades: readonly TradeRecord[], date: string): DayTradeCounts;
   export function formatDayTradeHeader(counts: DayTradeCounts, marketClosedForWeekend: boolean): string;
   export function formatReviewQueueSummary(unreviewedCount: number, needsTagsCount: number): string;
   ```
   - `dayTradeCounts`: exclude `is_sample` when real trades exist on that day (matching `groupByDay` rule); count `entered` by `sessionDate(entry_time) === date` and `closed` by `exit_time != null && sessionDate(exit_time) === date`.
   - `formatDayTradeHeader`:
     - Weekend (`marketClosedForWeekend && entered === 0 && closed === 0`): `"Markets are closed for the weekend."`
     - `entered === 0 && closed === 0`: `"No trades yet today"`
     - `entered === closed`: `\`\${entered} \${entered === 1 ? "trade" : "trades"} today\``
     - `entered !== closed` (e.g. 1 open trade entered today, 0 closed today): `\`\${entered} \${entered === 1 ? "trade" : "trades"} today (\${closed} closed)\``!
   - `formatReviewQueueSummary`:
     - `unreviewedCount === 0`: `""`
     - `needsTagsCount > 0`: `\`\${unreviewedCount} to review · \${needsTagsCount} \${needsTagsCount === 1 ? "needs" : "need"} tags\``
     - `needsTagsCount === 0`: `\`\${unreviewedCount} to review\``

2. **Update `components/TodayScreen.tsx` and `components/ReviewScreen.tsx`:**
   - `TodayScreen.tsx`: replace `"X trades this session"` with `formatDayTradeHeader(dayTradeCounts(trades, viewedDate), closed && viewedDate === todayDate)`, and replace `"${unreviewed} open"` in the Review queue aside with `formatReviewQueueSummary(unreviewed, needsTags)` (never `"open"`, which conflicted with open positions!).
   - `ReviewScreen.tsx`: show `formatReviewQueueSummary(...)` in the queue subtitle/meta so queue counts and the nav badge (`needs tags`) always agree, and add `<Link className="btn-secondary" href="/playbooks/lab">Playbook Lab</Link>` (`minHeight: 44`) in the `"All caught up"` empty-state actions (`Q-1`).

3. **Fix late unanchored plan window in `lib/session-review.ts` and `components/SessionReview.tsx` (`06` §6 bullet 3):**
   - In `lib/session-review.ts` (`reviewWindow(plan)`):
     - Check `bounds = equityIndexSessionBounds(plan.session_date)`.
     - When `plan.anchor_time_utc == null` AND `Date.parse(plan.created_at) >= bounds.close` (the plan was written **after** that session's `17:00 ET` close with no anchor): return `{ from: bounds.open, to: bounds.close, writtenAfterClose: true }` instead of `{ from: created_at, to: close }` (which caught 0 trades on 11/23!).
     - Expose `writtenAfterClose: boolean` on `SessionReviewResult`.
   - In `components/SessionReview.tsx`: when `review.writtenAfterClose` is `true`, display muted line `"Written after the close: showing the whole day"` under the time range in `.sheet-head`.

## 5. Tests to Write (`lib/__tests__/day-counts.test.ts` + `lib/__tests__/session-review.test.ts`)

1. `dayTradeCounts` & `formatDayTradeHeader`:
   - 1 open trade entered today, 0 closed → `"1 trade today (0 closed)"` (matches account card's `"0 trades today"` without contradiction!).
   - 3 trades entered & closed today → `"3 trades today"`.
   - Overnight trade entered yesterday, closed today → `entered: 0, closed: 1` → `"0 trades today (1 closed)"`.
2. `formatReviewQueueSummary`: `unreviewed = 12, needsTags = 1` → `"12 to review · 1 needs tags"`; `unreviewed = 5, needsTags = 0` → `"5 to review"`.
3. `session-review.test.ts`:
   - Plan for `2026-11-23` with `anchor_time_utc: null` and `created_at: "2026-11-24T01:30:00Z"` (`19:30 CT` after `17:00 ET` close): `reviewWindow` spans `[2026-11-22T23:00:00Z, 2026-11-23T22:00:00Z]` (`18:00 ET` Sun → `17:00 ET` Mon), catches all 3 Monday trades, and sets `writtenAfterClose: true`!
   - Plan with explicit `anchor_time_utc` or `created_at` before `17:00 ET` close keeps exact existing window with `writtenAfterClose: false`.

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
   git push origin origin/main:refs/heads/claim/UX-A
   ```
2. Write `notes/handoffs/2026-11-24-UX-A.md` with changed files and real command outputs.
3. Commit, push, and open PR:
   ```bash
   git add lib/day-counts.ts components/TodayScreen.tsx components/ReviewScreen.tsx lib/session-review.ts components/SessionReview.tsx lib/__tests__/day-counts.test.ts lib/__tests__/session-review.test.ts notes/handoffs/2026-11-24-UX-A.md
   git commit -m "fix(UX-A): clarify session trade counts, review queue wording, and after-close plan window"
   git push -u origin swarm/UX-A
   gh pr create --base main --title "[UX-A] Copy, counting, and after-close plan window fixes" --body-file notes/handoffs/2026-11-24-UX-A.md
   ```

## 8. What NOT to Do & Out-of-Scope Rule

- Do **NOT** edit `components/AppShell.tsx` (`PL-3` owns `AppShell.tsx` in Wave 7).
- Do **NOT** edit `components/ChallengeCard.tsx` (`UX-B` already fixed the challenge room label in Wave 4).
- **STOP and leave a note** in the handoff if any out-of-scope file seems needed.

HARD RULES:
- Supabase: only `mogmine_`-prefixed objects. If a package truly needs a schema change, write the SQL migration file under `supabase/migrations/` in the PR, but DO NOT apply it yourself: NEVER run `supabase db push`, NEVER run `supabase migration repair`, never use psql against the project. Note "MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP)" at the top of the handoff and PR body; code must degrade gracefully (local mode) until it is applied. Never touch `showmob_` tables, auth site_url or disable_signup settings.
- No data dumps (no exporting tables/journals/backups, no printcode full dumps committed).
- Never print, log, commit or echo secrets (.env*, tokens, keys). Do not cat env files.
- Never modify, delete or re-create Chris's real trade records or accounts (no calls to the live /api/v1 with real tokens, no Supabase writes). Use fixtures and unit tests.
- Stay inside this package's scope and its listed writable files. Out-of-scope need = stop and write it in the handoff.
- Never edit BOARD.md, NOTES.md, DECISIONS.md. Never merge PRs, never push to main, never force-push other branches, never touch other worktrees.
