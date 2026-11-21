# 17 — Challenges: Drawdown Defender and Clean Run

The design for roadmap step `R-09` in [16 — Floor Roadmap](16-floor-roadmap.md). The owner reviewed a wider "Trading Challenges" proposal on 2026-11-16 and asked for the best of it on the roadmap. This is that cut. The evaluator and device store are implemented in R-09a and R-09b. The open choices are `OD-37` in [DECISIONS.md](../DECISIONS.md).

A challenge is a goal the trader trades through, scored by code from the trader's own logged trades. It must make discipline engaging **without rewarding more trades, bigger size or recovery trading**.

---

## 1. What is in, what is out

**The first version has two challenges and no more.**

| Challenge | Rewards | Unit | Why first |
| :--- | :--- | :--- | :--- |
| **Drawdown Defender** | Not giving money back | Gross dollars | A loss boundary rewards restraint, and Topstep's own limits are in dollars. |
| **Clean Run** | Trading the plan, win or lose | Trades by the rules | It is what the owner asked for ("match the setups, get impeccable") and uses the checklist and tags that already exist. |

Both run **live on the device**, from the trades in `mogmine-trades-v3`. Active progress is **recomputed from the trades**. Settings are frozen at start, and the result is saved when the attempt ends. So this does not wait for Supabase (`R-05`).

**Deferred, each with the thing it waits for:**

| Deferred | Waits for |
| :--- | :--- |
| Any challenge scored in R | A stop captured at entry and frozen (`R-10`). Today the entry form has no stop field and the stop is editable, so R can change after the fact. |
| Profit-target challenges (Mini Combine, Consistency, Protect the Peak) | An owner decision that outcome targets are wanted at all. They reward the result, against UX-66, and Mini Combine repeats the combine Topstep already scores. |
| Fixed-Risk Run | `R-10` (frozen initial risk). |
| Beat Your Baseline | `R-08` (stats across days) and enough history. |
| Custom challenge builder | Two working presets and real use. |
| Practice run on past trades | A journal with real history. On 2026-11-16 the journal is sample trades only. |
| Challenges that follow you across devices | `R-05`. |
| Net-of-fees results, per-account scope | Fee data. Accounts now exist ([21](21-accounts-and-running-totals.md)), and Drawdown Defender uses the same engine. |

**Never:** broker rule enforcement, order control, a claim that a prop evaluation was passed, leaderboards, AI-computed scores (guardrails 1 and 11).

## 2. Rules that hold for every challenge

1. **Real, closed trades only.** `is_sample` trades never count. An open trade (`isOpen`) has no result and never counts as one (`OD-38`).
2. **In scope** means: a real trade whose `entry_time` is at or after the challenge's `started_at`. A trade that was already open when the challenge started is out of scope, and the detail screen says so.
3. **A trade lands on the session it closed in:** `sessionDate(trade.exit_time)` from `lib/session.ts`. Do not write new session math, and do not reuse `groupByDay`, which groups by entry.
4. **Order** is by `exit_time`, then by `id` for ties.
5. **Missing is not zero.** A trade that cannot be scored blocks a pass and is listed by name. It is never skipped quietly and never counted as `0`.
6. **Gross, and labelled gross.** Fees are not in the data. The word "net" never appears.
7. **Settings are frozen when the challenge starts.** To change a rule, end the attempt and start a new one. Ended attempts are kept and never silently reset.
8. **Money is integer cents inside the evaluator.** Compare unrounded; round only to display.
9. **Informational only.** A failed challenge changes nothing about any trade.

## 3. Drawdown Defender

> Trade `N` sessions without giving back more than `$L` from your high point.

**Settings:** `sessions` (default 20, 1–60), `max_drawdown_cents` (the trader types dollars; no default, they must choose).

**Math,** over the in-scope closed trades in order:

```
equity = 0, peak = 0                       // both in cents; the start counts as a peak
for each trade:  equity += pnl_cents
                 peak    = max(peak, equity)
                 drawdown = peak - equity
                 max_drawdown = max(max_drawdown, drawdown)
                 if drawdown >= max_drawdown_cents → FAILED at this trade, stop
```

- `pnl_cents = Math.round(tradePnl(trade) * 100)`. `tradePnl` is already computed in integer ticks and cents.
- **Failed** at the first trade where `drawdown >= limit`. Equal counts as a breach. The scored path and its money totals stop at the breach. Later trades remain in the journal.
- **Active sessions** = distinct `sessionDate(exit_time)` values with at least one in-scope closed trade. A day with no trades is neutral: it neither counts nor breaks anything.
- **Passed** when all of these hold: active sessions `>= sessions`; the last counted session is over (`now > sessionCloseUtc(...)` of its last trade); no breach; no in-scope open trade; nothing in the needs-data list.
- This is **closed-trade** drawdown. It does not see how far a trade went against you while it was open. The detail screen says that in one line.

**Golden cases** (limit `$300.00`; build the tests from these numbers, not from the code). Every amount is a whole number of `MES` ticks at `$1.25`, so each can be made from real prices:

| # | Trade results in order | Equity | Peak | Drawdown | Max DD | State |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `+200, +200, −100, −150` | `+150` | `400` | `250` | `250` | Active, `$50.00` left |
| 2 | case 1, then `−50` | `+100` | `400` | `300` | `300` | **Failed** at the `−50` trade (equal is a breach) |
| 3 | `−100, −100, −98.75` | `−298.75` | `0` | `298.75` | `298.75` | Active, `$1.25` left (the start is the peak) |
| 4 | `−300` | `−300` | `0` | `300` | `300` | **Failed** at the first trade |
| 5 | `+500, −298.75, +400, −298.75` | `+302.50` | `601.25` | `298.75` | `298.75` | Active: the peak moved up, so the second loss is measured from `601.25` |
| 6 | case 2, then `+1000` | — | — | — | `300` | Still **Failed** at the `−50` trade |

## 4. Clean Run

> Take `N` trades in a row by the rules. Losing trades count.

**Settings:** `target_trades` (default 10, 3–50), `playbook_ids` (which playbooks count; default: every playbook except `no-setup`).

**How each in-scope closed trade is read,** in this order:

| Read | When | Effect on the run |
| :--- | :--- | :--- |
| **Broken** | `playbook_id === "no-setup"`, or `processRead(trade) === "broken"` (a rule left unchecked, or a tag in `VIOLATION_TAGS`) | Run goes back to `0` |
| **Off-plan** | Has a playbook, but not one of `playbook_ids` | Run goes back to `0` |
| **Ungraded** | No playbook, or `processRead(trade) === null` (no checklist filled in) | Run does not move. Listed as "needs grading". Blocks a pass. |
| **Clean** | In `playbook_ids` and `processRead(trade) === "clean"` | Run `+1` |

- `run` = clean trades since the last Broken or Off-plan trade. `best_run` = the highest it has been.
- **Passed** when `run >= target_trades` and no in-scope trade is Ungraded or still open.
- **There is no failed state.** A broken trade resets the count; the challenge stays active until the trader ends it. That is the point: come back and do it again.
- **P&L is not an input.** The evaluator for Clean Run must not call `tradePnl`. A clean loss counts exactly like a clean win.
- Ungraded trades block a pass so that not grading a bad trade cannot protect the run.

**Golden cases** (target 5; `C` clean, `B` broken, `U` ungraded, `O` off-plan):

| # | Trades in order | Run | Best | State |
| :--- | :--- | :--- | :--- | :--- |
| 1 | `C C C` | 3 | 3 | Active |
| 2 | `C C B C` | 1 | 2 | Active |
| 3 | `C C C C C` | 5 | 5 | **Passed** |
| 4 | `C C U C C C` | 5 | 5 | Active, 1 needs grading (not passed) |
| 5 | case 4 after the `U` trade is graded clean | 6 | 6 | **Passed** |
| 6 | case 4 after the `U` trade is graded broken | 3 | 3 | Active |
| 7 | `C C O C` | 1 | 2 | Active |
| 8 | `C C C C` + a `no-setup` trade | 0 | 4 | Active |

## 5. Code contract

One new pure module, `lib/challenges.ts`. No React, no storage, no `Date.now()` inside: `now` is a parameter. Tests in `lib/__tests__/challenges.test.ts`.

```ts
export const CHALLENGE_CALC_VERSION = 1;

export type ChallengeRules =
  | { kind: "drawdown"; sessions: number; max_drawdown_cents: number }
  | { kind: "clean_run"; target_trades: number; playbook_ids: string[] };

export interface ChallengeDefinition {
  id: string;                 // crypto.randomUUID()
  user_id: string;            // DEFAULT_OWNER_USER_ID (invariant 7)
  rules: ChallengeRules;      // frozen at start
  started_at: string;         // UTC ISO
  ended_at: string | null;    // set when the trader ends it, or on pass/fail
  calc_version: number;
  /** Written once when the attempt ends, so a later edit to a trade cannot rewrite history. */
  final?: ChallengeResult;
}

export type ChallengeIssue =
  | { trade_id: string; reason: "open" }
  | { trade_id: string; reason: "unpriceable" }     // tradePnl returned null
  | { trade_id: string; reason: "undated" }         // invalid exit date
  | { trade_id: string; reason: "ungraded" };       // Clean Run only

export interface ChallengePoint {                    // one per scored trade, in order
  trade_id: string;
  closed_at: number;                                 // ms
  session: string;                                   // YYYY-MM-DD
  equity_cents?: number; peak_cents?: number; drawdown_cents?: number;   // drawdown
  read?: "clean" | "broken" | "off_plan"; run?: number;                 // clean_run
}

export interface ChallengeResult {
  state: "active" | "passed" | "failed";
  /** True while an in-scope trade is open or cannot be scored: numbers are estimates. */
  provisional: boolean;
  issues: ChallengeIssue[];
  points: ChallengePoint[];
  decided_by: string | null;                         // trade id that failed or passed it
  excluded_before_start: number;                     // count, for the disclosure line
  // drawdown
  equity_cents?: number; peak_cents?: number; drawdown_cents?: number;
  max_drawdown_cents?: number; remaining_cents?: number;
  sessions_done?: number;
  // clean_run
  run?: number; best_run?: number;
}

export function evaluateChallenge(definition: ChallengeDefinition, trades: TradeRecord[], now: number): ChallengeResult;
```

- An `unpriceable` trade is left out of the drawdown path, sets `provisional`, and blocks a pass. A breach on the trades that can be priced is still shown, as an estimate in the scored path, and the state stays `active` until the trade is fixed.
- An in-scope trade with an invalid exit date is listed as `undated` and omitted from the scored path. It keeps either challenge provisional, including a Drawdown Defender breach estimate, until the trade has a valid exit date (OD-47).
- `evaluateChallenge` on an ended attempt is never called for display: show `definition.final`. If recomputing as of the saved end time gives a different answer, the detail screen adds one line: "A trade was edited after this ended. Today's numbers differ." Both are shown; the saved one is not replaced.

**Storage,** in a small `lib/challenge-store.ts` shaped like `lib/prefs.ts`:
- `localStorage` key `mogmine-challenges-v1`, an array of `ChallengeDefinition`.
- At most **one active challenge of each kind**. Ended attempts stay in the array.
- Backup: add an optional `challenges?: ChallengeDefinition[]` to `JournalBackup` in `lib/store.ts`. Keep `version: 1`; an old backup without the field restores as "no challenges". A restore never drops trades because of a bad challenges field. A backup with a valid challenge can be restored even if its trade list is empty. If the file includes conflicting active attempts, keep the first valid one of each kind.
- Storage blocked or full: the challenge still works for the session and the card says "Not saved on this device", the same way the journal header does.

## 6. Screens

All of it follows [AGENTS.md §4](../AGENTS.md#4-mobile-first-verification-checklist) at `390×844`: 44px targets, `tabular-nums` on every number, theme tokens only, no sideways scroll.

### Today card

One card under the day summary in `components/TodayScreen.tsx`. One row per active challenge, two at most. R-09d makes the whole row a link to the detail screen, with in-row trade links and actions as separate targets. R-09c shows the latest passed or failed attempt of each kind when there is no active attempt of that kind. When neither row is available, Today links to the latest manually ended attempt of that kind, whose detail links to earlier attempts.

```
┌──────────────────────────────────────────────┐
│ DRAWDOWN DEFENDER                 8 / 20 days │
│ $187.50 left of $300.00                       │
│ ████████░░░░░░░░░░░░░░   38% used             │
├──────────────────────────────────────────────┤
│ CLEAN RUN                           best 6    │
│ 4 / 10 by the rules                           │
│ ● ● ● ● ○ ○ ○ ○ ○ ○                           │
└──────────────────────────────────────────────┘
```

| State | What the card shows |
| :--- | :--- |
| No challenge | One quiet line: "Start a challenge" (a link, not a banner). Nothing else. |
| Active | As drawn. |
| Estimate | The numbers, then "· estimate, 1 trade needs a price". Never a bare number that looks final. |
| Needs grading (Clean Run) | "4 / 10 by the rules · 2 need grading", linking to those trades. |
| Over 75% of the limit used | Bar and text turn amber, with the word "close". Text as well as colour (UX-80). |
| Failed (Drawdown) | "Limit reached on Tue 17 Nov" with a ✕ icon, and "Start again". No red flood. |
| Passed | "Done: 20 days inside $300.00" or "Done: 10 in a row by the rules" with a ✓. No confetti, sound or animation (UX-66). |
| Shield on | Every dollar figure is hidden. Drawdown shows only the bar and "38% of limit used". Clean Run is unchanged (it has no dollars). |
| Only sample trades | The card is not offered. Samples never feed a challenge. |

**Colour.** Gold is for good process only (#80), so **Clean Run's filled dots are gold** and Drawdown Defender uses the neutral text colour, amber when close, the risk colour at a breach. Nothing uses red or green alone.

**Copy.** Never "streak" for money. Never a line that counts trades as an achievement ("3 trades today!"). Never "you need $X more".

### Setup sheet

A bottom sheet like `AddTradeSheet`, opened from "Start a challenge".

1. Pick one: **Drawdown Defender** or **Clean Run**, each with its one-line rule from §3 and §4.
2. Settings: two fields. Drawdown: sessions, and the dollar limit (required, no default). Clean Run: how many in a row, and which playbooks count (checkboxes).
3. **A plain sentence of the frozen rule, built from the fields,** before the button: "From now, trade 20 sessions without giving back $300.00 from your high point. Gross, fees not included. Trades already open do not count."
4. Button: `Start challenge`. Invalid settings disable it and say why.

### Detail screen

Route `/challenges/[id]`. Reached only from the Today card; **no new tab in the bottom dock**.

- **Headline:** the same numbers as the card, larger.
- **Path.** Drawdown: a small step line of equity per trade with the floor (`peak − limit`) drawn under it, as inline SVG. It is not a price chart and does not use `lightweight-charts`. Clean Run: the dots, one per trade, with broken and off-plan trades marked by shape as well as colour.
- **Trade list:** every scored trade in order, newest first, each a link to `/trades/[id]`. The trade that decided a fail or a pass is labelled.
- **Needs attention:** the `issues` list, each a link to the trade to fix.
- **Fine print, always visible:** "Gross: fees are not included. Closed trades only: this does not see how far a trade went against you while it was open. From your own log, not from your broker." Plus "N trades were already open at the start and are not counted" when `excluded_before_start > 0`.
- **End challenge:** a quiet button with a confirm. Ending keeps the attempt in the past list.
- **Past attempts:** a short list under the active one.

## 7. Build order

Each is one PR, with the four checks from [docs/16 §0](16-floor-roadmap.md#0-rules-for-every-step).

| Step | Build | Done when |
| :--- | :--- | :--- |
| `R-09a` | `lib/challenges.ts` and its tests. No UI. | Every golden case in §3 and §4 passes, plus: a sample trade is ignored; an open trade makes it provisional; an unpriceable trade blocks a pass; a trade entered before `started_at` is excluded and counted; a trade closing after 18:00 New York lands on the next session; two trades with the same exit time order by `id`; the Clean Run evaluator gives the same answer when every P&L is flipped. |
| `R-09b` | `lib/challenge-store.ts`, the backup field, restore. | A backup made with a challenge restores it; an old backup still restores; a second active challenge of the same kind is refused. |
| `R-09c` | Today card and setup sheet. | Every row of the state table in §6 can be shown, checked at `390×844`, Shield on and off. |
| `R-09d` | Detail screen. | The decided-by trade is labelled, every issue links to its trade, and an ended attempt shows its saved result. |



## 8. What the owner still decides (`OD-37`)

The design above is the recommendation and the interim rule. To confirm or change:

1. **One active challenge of each kind** (two cards at most), or only one at a time?
2. **Clean Run resets and continues** on a broken trade, or should a broken trade end the attempt as failed?
3. **A `no-setup` trade breaks a Clean Run.** Right?
4. **Are profit-target challenges wanted at all?** If yes, they come after `R-10` and need UX-66 reworded.
