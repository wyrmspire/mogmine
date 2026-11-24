# 06 — Daily review, review cards and moving between days

Source: FIELD-NOTES "Evening 11/23 voice session": *Gap: no native daily review record type*, *Idea: visual review cards for the day's trades* (portrait or landscape), *How review works today*, *Gap: no day navigation*. Related: docs/24 §4 (after-session review, `PS-4`), `OD-51` (planning sessions), docs/23 §2 (card frame) and §6 (Day card, "later cards"), `lib/day-card.ts` (`CD-4`, built, not wired to any screen), docs/05 §2C (review queue), docs/13 `BET-02` (day as the unit), docs/26 (persistence contract).

---

## 1. Where review stands (checked 11/23 and in code)

- **Per trade:** `review_status` is `new` → `tagged` (automatic once anything is captured) → `reviewed` (only by the trader, "Mark reviewed"). The Review tab queue (`components/ReviewScreen.tsx`) is every trade not yet reviewed, new first.
- **Per planning session:** the after-session review (`components/SessionReview.tsx`, `lib/session-review.ts`) is a view over one plan. It pulls trades whose entry falls between the plan's anchor (or `created_at`) and the next anchor or the close. Its only stored output is the plan's `lesson` (280 characters). It has no link to `review_status`.
- **Per day:** nothing. On 11/23 the agent stored the daily review as a plan with `preset: null`, the review text in `observations`, and trade ids typed into the text. A plan created after the close with no anchor caught **zero** trades, because the window started at `created_at`; it was patched to 07:00 CT by hand.
- **Day Card:** `lib/day-card.ts` builds the data and canvas for a day (trades, net R, rules %, playbook breakdown). No screen uses it yet.
- **Navigation:** Today shows the current session plus "Last trading day". After 17:00 CT the app rolls to the next session, so a Monday-evening review lands in "Last trading day". The Feed filters by status only. The Review queue has no day filter. Past session reviews are chips for the last 14 days (`components/PastSessionReviews.tsx`).

## 2. The daily review record

A new collection, `daily_reviews`. One record per session date per account scope.

```ts
// lib/daily-review.ts (new, pure)
interface DailyReview {
  id: string;                         // "review-2026-11-23" or "review-2026-11-23-sim-acct-eval-50k"
  user_id: string;                    // Invariant 7
  session_date: string;               // YYYY-MM-DD, the trading day (`sessionDate`, 17:00 CT rollover)
  account_id: string | null;          // null = every account that day
  trade_ids: string[];                // explicit links, in display order; the trader confirms them
  plan_ids: string[];                 // planning sessions of that day, if any (OD-51)
  points: ReviewPoint[];              // what went well, mistakes, observations
  lesson: string;                     // the one lesson for tomorrow; ≤ 500 characters
  status: "draft" | "done";
  recorded_at: string;                // wall-clock time the review was first written (AGENTS §6.5)
  updated_at?: string;                // set by the adapter
}

interface ReviewPoint {
  id: string;
  kind: "went_well" | "mistake" | "observation" | "next_time";
  text: string;                       // ≤ 500 characters; commentary only (HR-1)
  trade_id: string | null;            // a point may be about one trade
}
```

Rules:

1. **Trades are linked explicitly.** When a review is created, the trades whose `sessionDate(entry_time)` equals `session_date` (and whose account matches, when `account_id` is set) are proposed; the trader confirms or removes them. A trade logged later for the same day shows "1 new trade for this day: add it?" on the review. Trades are never linked by time window alone, so the anchor gotcha cannot happen.
2. **Totals are computed, never stored:** trade count, net result R ([04](04-r-size.md)), net points, money (hidden under Shield), wins/losses/scratches, rules %, playbook breakdown. Reuse `buildDayCardData` (`lib/day-card.ts`) with the linked trades.
3. **One lesson, many points.** The plan's 280-character `lesson` stays the lesson of one checkpoint (PS-4). The day's review has its own lesson (500) and any number of points. Nothing copies between them; the review screen shows the day's plan lessons read-only.
4. **`status: "done"`** is the trader's "I reviewed this day". It does not change any trade's `review_status`. The screen offers a separate button: "Also mark the 3 linked trades reviewed" (one tap, with Undo).
5. **Uniqueness:** one review per `(session_date, account_id)`. Creating a second returns the first (the command layer answers 409 with the existing id).
6. **Samples:** a review may link sample trades only when samples are shown; totals exclude samples as stats do.

### 2.1 Persistence (docs/26)

- Device: `mogmine-daily-reviews-v1` (localStorage), in the journal backup as `daily_reviews`; an older backup without it leaves the device's reviews untouched.
- Supabase: a new table `mogmine_daily_reviews` in the jsonb pattern of `20261123004734_mogmine_journal_v1.sql` (`record jsonb`, generated `session_date` and `account_id` columns, RLS owner policies, allow-list check, grants as in `..._journal_grants.sql`). **This is the only SQL migration in this design.** Workers write the migration file; Chris applies it (D-012 shared project rules).
- Registry (`lib/persistence/registry.ts`): `deletePolicy: "hard"`, `derivedNeverStored: ["totals", "cards"]`, parent none.
- Sync: the same store-sync pattern as plans (#192).
- Agent API: the collection appears in `/api/v1/records/daily_reviews` automatically through the registry. House rule HR-9 ([07](07-agent-api.md)) tells agents to use it instead of plans.

### 2.2 Moving the 11/23 review (design only)

`review-2026-11-23` exists as a plan on both accounts. A worker writes a dry-run script that prints the proposed `DailyReview` (session date, the three trade ids, the observations split into one `observation` point, the lesson). Chris confirms; apply creates the review and **leaves the plan in place** (deleting it is Chris's call). The trades it names are on the reliability-warning list: their prices and times are not touched by this script.

## 3. The day review screen

Route `/review/day/[date]` (with `?account=`). Entry points: a **Days** strip on the Review tab (last 14 trading days: no review / draft / done), the Today screen's "Review this day" button after the close, and the day header in the Feed.

```
‹ Mon, Nov 23 ›                      [All accounts ▾]
3 trades · −0.33R net · rules 7/9 · From your journal · gross
[ review card ][ review card ][ review card ]      ← §4
Plans today: Pre-market (lesson: …)                 ← read-only
Went well   + add
Mistakes    + add
Observations + add
Lesson for tomorrow  [ … 500 ]
[ Done for the day ]   [ Also mark 3 trades reviewed ]
```

- The date arrows step between **trading days** (skip weekends; holidays wait for `OD-35`).
- Points add in one tap per kind; each point can be tied to a card ("about this trade").
- Saving follows the sync labels from PR #204 ("Saved to your account", "will sync").
- States (docs/08 §4): no trades that day ("A day without trades is still a review"), loading, offline (draft kept on the device), trades whose candles are missing (card without chart, saying why), Shield on.

## 4. Review cards

One card per linked trade, so the whole day reads at a glance. A review card is a **layout on the shared frame** (docs/23 §2), not a new image system.

**Content:** a small chart of the fitted window (`buildMarks` + the `ReviewChart` component, levels off, VWAP off), and beside or below it:

| Line | Example | Shield |
| :--- | :--- | :--- |
| Side, size, playbook | `LONG 1 · ORB Reclaim` | size hidden |
| Entry → exit, reason | `7137.00 → 7260.00 · Trailed` | prices kept (not money) |
| Stop | `7119.50 → 7260.00 (moved 08:30)` or `… (time?)` | kept |
| Target | `7180.00` or `—` | kept |
| Result | `+2.05R` (account R), `+$615` | money hidden |
| Risk | `0.29R · said 0.25R` | dollars hidden |
| Hold, rules | `35m · rules 3/4` | kept |

**Orientation:** a toggle on the day screen, **Portrait** (one column, 4:5 cards, for scrolling on a phone) or **Landscape** (16:9 cards; two per row from 1024 px; for wider or shareable layouts). Remembered as a pref `reviewCardOrientation: "portrait" | "landscape"`, default portrait. Landscape adds a `16:9` layout table to `lib/shareCard.ts` next to `4:5`, `9:16` and `1:1` (`CD-1a`).

**Tap** a card to open the trade. **Export:** "Share day" renders the day sheet: the Day Card summary on top and the review cards below (portrait: one column; landscape: a 2-column grid), as one PNG on the shared frame, Shield on by default (`OD-46` a). The image is prepared before the Share tap (UX-70).

**The API:** no card concept is needed. An agent creates a `daily_reviews` record with `trade_ids`; the cards are derived from those trades.

## 5. Moving between days

- **Today** gains `‹ ›` arrows and a date picker next to the day header (`components/DayHeader.tsx`). A past day shows that day's plans, trades and review status, with a clear "Viewing Mon, Nov 23 · Back to today". The URL carries `?date=2026-11-23`, so the back button works.
- **Feed** filters from URL params: `date`, `account`, `playbook`, `tag` (`components/FeedScreen.tsx`). Shown as removable chips. The Playbook Lab ([01](01-playbook-lab.md)) links here with `playbook=` and `tag=`.
- **Review queue:** a day chip row ("All days · Mon 23 · Fri 20 …") filters the queue. The queue stays fixed once opened (today's rule), except when the day filter changes.
- **The 17:00 CT rollover stays.** After the close, Today shows a banner: "Session closed. Review Mon, Nov 23 →".

## 6. Fixes that belong here

- **Header vs account card counts** (field notes 11/23): the header's "1 trade this session" counts trades by entry session; account cards' "0 trades today" count closed trades by exit session (docs/21 §2). Same day, different rules. Use one helper and say which: header "1 trade today (0 closed)"; account card unchanged. Pure `dayTradeCounts(trades, date)`.
- **Review queue wording:** "12 open" vs the badge "1 needs tags". Use "12 to review · 1 needs tags".
- **Plan anchor gotcha:** keep `SessionReview` as is for checkpoints, but for a plan with no anchor whose `created_at` is after that session's close, window the whole session (18:00 ET prior day → 17:00 ET) instead of `created_at → close`, and say so ("Written after the close: showing the whole day").

## 7. Open questions

- Q-3: One daily review per day across accounts, or one per account? Recommended: per day, with an optional account scope (`account_id`), as modelled.
- Q-4: Should "Done for the day" also mark linked trades reviewed? Recommended: no, offer it as a separate tap.
- Q-5: Landscape ratio: 16:9 or 3:2? Recommended: 16:9 (matches desktop and most share targets).
