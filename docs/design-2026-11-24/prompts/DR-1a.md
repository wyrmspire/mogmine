# Package Prompt: `DR-1a` — Daily Review Model, Local Store, and Backup

- **Agent / Lane:** `swarm-4` (`L4 Review & days`) · **Wave:** `1` · **Branch:** `swarm/DR-1a`
- **Depends on:** None (Wave 1 baseline)

## 1. Goal

Create the pure `DailyReview` domain model (`lib/daily-review.ts`), sanitizer (`lib/daily-review-sanitize.ts`), and local device store (`lib/daily-review-store.ts`, key `mogmine-daily-reviews-v1`), and wire `daily_reviews` into journal backup/restore (`lib/journal-backup.ts`, `components/TuneScreen.tsx`) and app hydration (`components/AppShell.tsx`). Supabase persistence and command-layer wiring follow in `DR-1b`.

## 2. Read First (Required Context)

1. `AGENTS.md` (Invariant 7 `user_id`, §6.5 `recorded_at` integrity, §6.12 file-length rule for `components/TuneScreen.tsx`)
2. `docs/design-2026-11-24/06-daily-review-and-review-cards.md` (§1, §2 rules 1–6, §2.1 device/backup)
3. `docs/design-2026-11-24/90-work-packages.md` (`DR-1a`)
4. `docs/design-2026-11-24/92-decisions-made-by-swarm.md` — **Chosen defaults locked for you:**
   - **Q-3:** One `DailyReview` per `(session_date, account_id)` where `account_id: string | null` (`null` = all accounts that day).
   - **Q-4:** Setting `status: "done"` on a `DailyReview` never mutates any trade's `review_status`.

## 3. Writable Files (Strict Scope — Everything Else Read-Only)

- `lib/daily-review.ts` *(new)*
- `lib/daily-review-sanitize.ts` *(new)*
- `lib/daily-review-store.ts` *(new)*
- `lib/journal-backup.ts` *(existing, ~237 lines)*
- `components/AppShell.tsx` *(existing, ~94 lines — add `hydrateDailyReviews()` in `useLayoutEffect`)*
- `components/TuneScreen.tsx` *(existing, **474 lines — over 450-line target, grandfathered**: 2–3 lines pass-through only for backup export/restore; state before/after line counts in handoff)*
- `lib/__tests__/daily-review.test.ts` *(new)*

## 4. Step-by-Step Implementation Plan

1. **Create `lib/daily-review.ts` (pure, no DOM/React/storage):**
   ```ts
   import type { DayCardData } from "./day-card.ts";
   import type { PlanningSession } from "./plans.ts";
   import type { TradeRecord } from "./trades.ts";

   export type ReviewPointKind = "went_well" | "mistake" | "observation" | "next_time";
   export type DailyReviewStatus = "draft" | "done";

   export interface ReviewPoint {
     id: string;
     kind: ReviewPointKind;
     text: string;             // <= 500 chars
     trade_id: string | null;
   }

   export interface DailyReview {
     id: string;               // e.g. "review-2026-11-23" or "review-2026-11-23-<account_id>"
     user_id: string;          // Invariant 7 (DEFAULT_OWNER_USER_ID on device)
     session_date: string;     // YYYY-MM-DD (17:00 CT / 18:00 ET rollover)
     account_id: string | null;
     trade_ids: string[];      // explicit ordered trade ids
     plan_ids: string[];       // explicit planning session ids for that day
     points: ReviewPoint[];
     lesson: string;           // <= 500 chars
     status: DailyReviewStatus;
     recorded_at: string;      // wall-clock ISO when first written (AGENTS §6.5)
     updated_at?: string;
   }

   export const DAILY_REVIEW_LIMITS = { pointText: 500, lesson: 500 } as const;

   export function dailyReviewId(sessionDateStr: string, accountId: string | null): string;
   export function dailyReviewScopeKey(sessionDateStr: string, accountId: string | null): string; // `${sessionDateStr}|${accountId ?? "*"}`
   export function proposeTradeIds(
     trades: readonly TradeRecord[],
     sessionDateStr: string,
     accountId: string | null,
     opts?: { includeSamples?: boolean },
   ): string[];
   export function unlinkedDayTradeIds(
     review: Pick<DailyReview, "session_date" | "account_id" | "trade_ids">,
     trades: readonly TradeRecord[],
     opts?: { includeSamples?: boolean },
   ): string[];
   export function proposePlanIds(plans: readonly PlanningSession[], sessionDateStr: string): string[];
   export function findExistingDailyReview(
     reviews: readonly DailyReview[],
     sessionDateStr: string,
     accountId: string | null,
   ): DailyReview | undefined;
   export function dailyReviewTotals(
     review: Pick<DailyReview, "session_date" | "trade_ids">,
     trades: readonly TradeRecord[],
     shield: boolean,
   ): DayCardData;
   export function makeDailyReview(input: {
     id?: string;
     user_id?: string;
     session_date: string;
     account_id?: string | null;
     trade_ids?: string[];
     plan_ids?: string[];
     points?: ReviewPoint[];
     lesson?: string;
     status?: DailyReviewStatus;
     recorded_at: string;
   }): DailyReview;
   ```
   - `proposeTradeIds`: filter trades where `sessionDate(trade.entry_time) === sessionDateStr`, `(accountId == null || trade.account_id === accountId)`, and `(opts?.includeSamples ? true : !trade.is_sample)`, sorted chronologically by `entry_time` ascending (then `id`).
   - `dailyReviewTotals`: lookup linked `review.trade_ids` in order, **exclude `trade.is_sample` from totals** (`06` §2 rule 6: *"totals exclude samples as stats do"*), and delegate to `buildDayCardData(review.session_date, realLinkedTrades, shield)` from `lib/day-card.ts`.

2. **Create `lib/daily-review-sanitize.ts`:**
   - Export `sanitizeReviewPoint(raw: unknown): ReviewPoint | null`, `sanitizeDailyReview(raw: unknown): DailyReview | null`, `sanitizeDailyReviews(raw: unknown): DailyReview[]`, and `sanitizeDailyReviewsBackup(raw: unknown): DailyReview[] | null`.
   - Enforce `YYYY-MM-DD` `session_date`, valid ISO `recorded_at`, `lesson.slice(0, 500)` (or reject `> 500` in strict parser helper `validateDailyReviewInput` for `DR-1b`), valid `ReviewPointKind`, deduplicated `(session_date, account_id)` in `sanitizeDailyReviews` (first wins), and `user_id` defaulting to `DEFAULT_OWNER_USER_ID`.

3. **Create `lib/daily-review-store.ts`:**
   - Mirror `lib/plans-store.ts` (`STORAGE_KEY = "mogmine-daily-reviews-v1"`): `hydrateDailyReviews()`, `useDailyReviewsStore()`, `getDailyReviewsState()`, `upsertDailyReview(review)` (enforcing `(session_date, account_id)` uniqueness — if one exists with a different `id`, update/return the existing one rather than creating a duplicate), `updateDailyReview(id, patch)` (never overwriting `recorded_at`), `removeDailyReview(id)`, `getDailyReviewsBackup()`, `restoreDailyReviews(reviews)`, `resetDailyReviewsForTests()`.
   - *(Do NOT wire `createCollectionSync` yet; `DR-1b` adds `"daily_reviews"` to `CollectionKey` and wires remote sync.)*

4. **Update `lib/journal-backup.ts`, `components/AppShell.tsx`, and `components/TuneScreen.tsx`:**
   - `lib/journal-backup.ts`: add optional `daily_reviews?: DailyReview[]` to `JournalBackup` and `ParseBackupResult`; accept optional `dailyReviews?: DailyReview[]` as the 10th parameter of `buildBackup` (omitting key if empty so existing backup shape tests stay clean, just like `calls`); allow a backup containing only `daily_reviews` to pass the non-empty check in `parseBackupFile`.
   - `components/AppShell.tsx`: call `hydrateDailyReviews()` in `useLayoutEffect`.
   - `components/TuneScreen.tsx`: pass `getDailyReviewsBackup()` into `buildBackup(...)`, and in `confirmRestore` call `if (pending.daily_reviews) restoreDailyReviews(pending.daily_reviews)` (leaving existing device reviews untouched when restoring an older backup where `pending.daily_reviews === undefined`, per `06` §2.1!).

## 5. Tests to Write (`lib/__tests__/daily-review.test.ts`)

Write `node:test` tests covering all 6 rules of `06` §2 + backup:
1. Rule 1: `proposeTradeIds` matches `sessionDate(entry_time)` (including an evening `18:30 ET` Globex trade rolling to next session date) and filters by `account_id` when non-null; `unlinkedDayTradeIds` surfaces a newly logged trade on the same day.
2. Rule 2 & 6: `dailyReviewTotals` computes counts, net R, points, and rules adherence via `buildDayCardData` and excludes sample trades even if linked.
3. Rule 3 & 4: `lesson` and `ReviewPoint.text` up to 500 chars; marking `status: "done"` never mutates any `TradeRecord.review_status`.
4. Rule 5: uniqueness per `(session_date, account_id)` — `2026-11-23` + `null` and `2026-11-23` + `"sim-acct-eval-50k"` can both exist, while creating a second `2026-11-23` + `null` returns the existing review.
5. `recorded_at` wall-clock timestamp is preserved across `updateDailyReview`.
6. Backup round-trip (`buildBackup` → `parseBackupFile` → `restoreDailyReviews`) and legacy backup without `daily_reviews` leaves existing device reviews untouched.

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
   git push origin origin/main:refs/heads/claim/DR-1a
   ```
2. Write `notes/handoffs/2026-11-24-DR-1a.md` with changed files, exported signatures, `components/TuneScreen.tsx` before/after line counts (`474` before), and real command output.
3. Commit, push, and open PR:
   ```bash
   git add lib/daily-review.ts lib/daily-review-sanitize.ts lib/daily-review-store.ts lib/journal-backup.ts components/AppShell.tsx components/TuneScreen.tsx lib/__tests__/daily-review.test.ts notes/handoffs/2026-11-24-DR-1a.md
   git commit -m "feat(DR-1a): daily review model, local store, and backup support"
   git push -u origin swarm/DR-1a
   gh pr create --base main --title "[DR-1a] Daily review model, local store, and backup" --body-file notes/handoffs/2026-11-24-DR-1a.md
   ```

## 8. What NOT to Do & Out-of-Scope Rule

- Do **NOT** edit `lib/persistence/*`, `lib/commands/journal-commands.ts`, or `supabase/migrations/` (`DR-1b` owns those in Wave 3).
- Do **NOT** build `/review/day/[date]` UI here (`DR-2` in Wave 5).
- **STOP and leave a note** in the handoff if any out-of-scope file seems needed.

HARD RULES:
- Supabase: only `mogmine_`-prefixed objects. If a package truly needs a schema change, write the SQL migration file under `supabase/migrations/` in the PR, but DO NOT apply it yourself: NEVER run `supabase db push`, NEVER run `supabase migration repair`, never use psql against the project. Note "MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP)" at the top of the handoff and PR body; code must degrade gracefully (local mode) until it is applied. Never touch `showmob_` tables, auth site_url or disable_signup settings.
- No data dumps (no exporting tables/journals/backups, no printcode full dumps committed).
- Never print, log, commit or echo secrets (.env*, tokens, keys). Do not cat env files.
- Never modify, delete or re-create Chris's real trade records or accounts (no calls to the live /api/v1 with real tokens, no Supabase writes). Use fixtures and unit tests.
- Stay inside this package's scope and its listed writable files. Out-of-scope need = stop and write it in the handoff.
- Never edit BOARD.md, NOTES.md, DECISIONS.md. Never merge PRs, never push to main, never force-push other branches, never touch other worktrees.
