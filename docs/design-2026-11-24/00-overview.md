# Design pass 2026-11-24: follow-ups from the 11/23 session

**Author:** Claude (Opus 5.5), designer, step 1 of Chris's plan: (1) Claude designs → (2) Gemini 4 plans a five-agent swarm from this → (3) Codex 5.6 and Claude 3.8 Flash build.
**Base:** `main` at `c539bb6` (PRs #200–#206 landed: merged level pills, withheld-level copy, R on the initial stop, efficiency fixes, sync labels, graceful market data).
**Status:** design only. No code, tests, config or data changed. Nothing here is decided until Chris says so; every decision is listed in §4.

**Sources:** the field notes kept on the VM (`FIELD-NOTES.md`, not in git; mainly "Evening 11/23 voice session"), AGENTS.md, BOARD.md, NOTES.md, DECISIONS.md, docs/01–26, docs/playbook-design/, open issues and PRs #153–#206, the 11/23 Opus handoffs, and the code at `c539bb6`.

> **Reliability warning, carried from the field notes.** The trades and review an agent created through the API on 11/23 (`trade-20261123-a/b/c`, `review-2026-11-23`, on both the Gmail and Proton accounts) contain errors: wrong bar placement, wrong stop values, invented playbook names, R text in notes, wrong R, a false SL touch. In this design they are **examples of failure modes**, not ground truth. Any fixture built from them must first be checked against Yahoo `MES=F` 1-minute bars.

---

## 1. Documents

| Doc | Area | Packages ([90](90-work-packages.md)) |
| :--- | :--- | :--- |
| [01 — Playbook Lab](01-playbook-lab.md) | A page to explore playbooks, trade types and tags: what exists, how they relate, counts, examples, gaps | `PL-1`, `PL-2a`, `PL-2b`, `PL-3` (gated) |
| [02 — UX improvements](02-ux.md) | Index of every rough edge from 11/22–11/23, plus small designs: challenge floor label, challenges per account, future dates, "no setup", notes placeholders, initial stop time | `UX-A`–`UX-D` |
| [03 — Levels and indicators](03-indicators-and-levels.md) | Labels behind candles and more solid, a quiet right edge, tap a level to read it, remembered VWAP, Globex VWAP with small gaps, 200 EMA proposal | `IN-1`, `LB-A`, `LB-B1`, `LB-B2`, `IN-2`, `IN-3` (gated) |
| [04 — Per-account R size](04-r-size.md) | 1R = a fixed dollar amount per account; stated vs actual risk; stored dollar risk; recompute and migration plan | `RS-1`–`RS-4` |
| [05 — Stops, MAE and fills](05-stops-mae-fills.md) | Touches and MAE only after the entry; untimed and timed stop moves; ±5-minute fill-to-bar matching | `SM-1`–`SM-3`, `FB-1`, `FB-2` |
| [06 — Daily review and review cards](06-daily-review-and-review-cards.md) | A real daily review record, the day review screen, portrait/landscape review cards, moving between days | `DR-1a`, `DR-1b`, `DR-2`, `DR-3`, `NAV-1`, `UX-A` |
| [07 — Agent API](07-agent-api.md) | House rules at discovery, live vocabularies, candles, a trade check, levels, derived values, write-time warnings | `API-1`, `API-2a`, `API-2b`, `API-3`, `API-4` |
| [90 — Work packages](90-work-packages.md) | 34 packages in 5 lanes and 7 waves (8 wait on a decision from Chris), shared-file order, spec write-backs | — |

## 2. Goals

1. **Logging a trade by voice or by agent produces a correct record the first time.** The API teaches its own rules, returns the real playbooks/tags/accounts, and checks times against the bars before saving (07, 05).
2. **R means what Chris means.** 1R is the account's fixed dollar size; stated and actual risk are both kept (04).
3. **The chart tells the truth about the trade.** No stop touch or MAE from before the fill, no stop move invented at the entry, fills drawn on the minute the price actually traded (05).
4. **The chart is calm.** Levels sit behind candles, the right edge is clear, names appear on tap; chosen indicators stay chosen (03).
5. **A day is a unit of review.** A daily review record, review cards for the day's trades, and a way to step between days (06).
6. **The vocabulary is visible.** The Playbook Lab shows which setups and tags exist and how they are used (01).

## 3. Non-goals

- No broker work, no TopstepX listener or sync (`D-009`).
- Not the candle archive (`#70`, `R-04`), not the `5m` level fallback (`OD-55` b), not stored trade documents (`OD-30`).
- No level snapshot stored on trades (`OD-20`; Q-8 below).
- No AI review features (docs/04), no discretionary-call UI (`OD-52`), no playbook chart examples (docs/playbook-design/03).
- No new bottom-nav item (Q-1).
- No changes to running data: the R backfill, the daily-review move and the Supabase migration are designed as scripts and files that Chris runs.

## 4. Decisions needed from Chris

Each has a recommended default. Packages marked "gated" in [90](90-work-packages.md) wait for the matching answer; the rest proceed on the default.

| Id | Question | Recommended | Doc | Gates |
| :--- | :--- | :--- | :--- | :--- |
| **D-A** | Everything labelled "R" becomes account R (P&L ÷ account R size), and the stop-width ratio is shown as "× risk" or "R:R". This also answers `OD-10` (gross) and rewords guardrail §3b-4: result R no longer needs a stop. | Yes | 04 §3.1, §3.5 | `RS-3a`, `RS-3b` |
| **D-B** | Freeze the R size on each trade when it is saved, so changing an account's R size later does not rewrite history | Yes | 04 §3.3 | — |
| **D-C** | The scratch threshold (`D-010`: "0.1R or 2 ticks") stays on the trade's own risk, not account R | Yes | 04 §3.5 | — |
| **D-D** | Tap mode: drop always-on level labels, show at most 3 price-only axis tags. Supersedes two `LV-09` cells. | Yes, 3 tags | 03 §3 | `LB-B1` |
| **D-E** | Trade Card PNG keeps up to 4 labelled level groups (a popover cannot be exported) | Yes | 03 §3 LB-7 | `LB-B2` |
| **D-F** | Globex VWAP draws with "≈" when ≤ 3% of bars are missing, the longest gap ≤ 15 min and no gap after 09:30 ET | Yes | 03 §5 | `IN-2` |
| **D-G** | 200 EMA on the displayed timeframe (the 200 on the 1m chart is a 1m EMA), 500-bar warm-up. Needs `OD-18` too. | Yes | 03 §6 | `IN-3` |
| **D-H** | When the entry bar traded past the stop before the fill, show a muted Data notes line explaining why it is not a touch | Show it | 05 §1.2 | — |
| **D-I** | When a fill is matched to a nearby minute (±5), MAE and touch checks use the matched bar without waiting for "Use 14:13" | Yes | 05 §4.3 | — |

## 5. Open questions

| Id | Question | Recommended | Doc |
| :--- | :--- | :--- | :--- |
| Q-1 | Add Playbooks as a fifth bottom-nav item? | Not yet; link from Tune and Review | 01 §2 |
| Q-2 | What are "trade types"? A family field on playbooks (reversal, continuation, breakout, impulse)? | Show playbooks and computed shape facts now; add `family` after the real playbook list exists (`OD-26`) | 01 §3 |
| Q-3 | One daily review per day across accounts, or per account? | Per day, optional account scope | 06 §7 |
| Q-4 | Should "Done for the day" also mark the day's trades reviewed? | No; a separate one-tap button | 06 §7 |
| Q-5 | Landscape review cards: 16:9 or 3:2? | 16:9 | 06 §7 |
| Q-6 | Tags as editable data (a tag registry) now, or constants until the real list is supplied? | Build it with the Lab | 01 §5 |
| Q-7 | "Settlements" in the voice note ("sediments"): PDC, 3 PM close and similar? | Yes | 03 |
| Q-8 | Store a snapshot of levels/VWAP at entry on each trade (`OD-20` `levels_at_entry`)? | Not now; the levels endpoint computes point-in-time | 07 §3.4 |
| Q-9 | API: refuse unknown tags, or warn and keep them? | Refuse until a tag registry exists | 07 §4 |
| Q-10 | Refuse future-dated entries (form and API)? Warn on prices far from the day's range? | Refuse; warn | 02 §2.3 |
| Q-11 | Clock allowance for "future": 5 minutes? | 5 minutes | 02 §2.3 |
| Q-12 | A trade with no account: use the default R size, or say "R size not set"? | Default, labelled | 04 §7 |
| Q-13 | Stated R on planning sessions too ("0.25R per trade today")? | Trade only for now | 04 §7 |
| Q-14 | A faster "moved my stop" chip in the close-trade sheet? | Not packaged; Chris to say | 05 §3.3 |

## 6. Conflicts with recorded decisions and specs

This design proposes changes to things already written down. None of them is overridden here; each needs Chris's yes, then an integrator edit ([90](90-work-packages.md) §6).

| Recorded | Conflict | Proposal |
| :--- | :--- | :--- |
| AGENTS §3b-4 "`R` is `null` without a stop, never `0`" | Account R gives a result R without a stop | Split into risk R (needs a stop or stated risk) and result R (needs P&L). D-A |
| `OD-10` (open), docs/09 `B-32` "R = P&L ÷ initial risk $" | Denominator becomes the account R size | D-A |
| docs/16 `R-10` "do not change what `rMultiple` returns … a separate decision"; PR #202 note "pending owner confirmation" | `rMultiple` is renamed `riskMultiple` and "R" moves to account R | D-A |
| `D-010` scratch "0.1R or 2 ticks" | Which R? | Trade's own risk. D-C |
| docs/12 §5 `LV-09` label at the right edge, never shrink; axis tags off by default | Tap mode, axis tags on | D-D, D-E |
| `OD-55` (a) reserve a right offset | Done in `LB-A` (only when text labels show) | Closes (a) |
| `OD-18` (open) VWAP and 200 EMA definitions | Tolerance rule for Globex VWAP; EMA timeframe and warm-up | D-F, D-G; formulas stay with `OD-18` |
| `OD-28` nearby snap (3 bars / 30 min, missing bars) | Adds a ±5 min **price** match | Both rules kept; they answer different cases |
| docs/26 `derivedNeverStored` | `risk_cents` is computed and stored | A new "materialized derived" category |
| docs/24 §4 one lesson (280) on a plan | A daily review has its own lesson and points | Plans keep theirs; nothing copies |
| `OD-26` (placeholders for playbooks and tags) | The Lab and the agent vocabulary make the placeholders visible | Q-6; the Lab works with any list |
| `OD-20` levels frozen on trades | Not built; levels endpoint is point-in-time | Q-8 |

No conflict found with the seven invariants. Notes on the ones touched: Invariant 1 (the level card is UI chrome inside the chart frame, not a position box, and stays out of screenshots); Invariant 3 (the candles and levels endpoints map `MES` → `MES=F` with no fallback); Invariant 5 (the 0.82 pill alpha becomes a token); Invariant 6 (the server candle loader goes through `MarketDataProvider`); Invariant 7 (`daily_reviews` carries `user_id`).

## 7. For the swarm planner (Gemini 4)

- Start with wave 1 in [90](90-work-packages.md) §2: `RS-1`, `SM-1`, `IN-1`, `DR-1a`, `API-1`. They share no files except the two noted in §4 of that doc.
- Gated packages: `RS-3a`/`RS-3b` (D-A), `LB-B1` (D-D), `LB-B2` (D-E), `IN-2` (D-F), `IN-3` (`OD-18`, D-G), `UX-C` (Q-10), `PL-3` (Q-6). If Chris has not answered by their wave, give that lane its next ungated package.
- Hot spots: `components/TradeDetail.tsx` (seven packages, ≤ 10 net lines each), `lib/trades.ts`, `lib/trade-marks.ts`, `lib/commands/journal-commands.ts`, `components/ReviewScreen.tsx`. The order is in [90](90-work-packages.md) §4.
- Use git worktrees per lane (AGENTS §6.2) and canonical claim branches (§6.6).
- Workers must not run the backfill or daily-review scripts against real accounts, and must not apply the Supabase migration.
