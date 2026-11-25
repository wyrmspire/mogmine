# MOGMINE-BLUEPRINT.md — Canonical Project Map & Owner Directives

> **Read this after AGENTS.md, before BOARD.md.** This is the living map of what
> MogMine currently *is*: product identity, subsystem maturity, the authority
> hierarchy for conflicting documents, locked owner decisions, and the current
> release objective. Where an older document conflicts with this one on
> **current state, priorities, or the definition of R**, this document wins.
> Design detail still lives in the specs; settled choices still live in
> DECISIONS.md. Update this file when a work package changes a maturity level
> or a priority — a stale blueprint is worse than none.
>
> Established 2026-11-24 by the owner (Chris) from the deep project coherence
> audit of the 2026-11-24 snapshot (HEAD `9248cf9`). Maintained by Tappy
> (owner's agent) on the owner's instruction.

---

## 1. What MogMine is

MogMine is a **personal trading development system**, not just a trade logger.
Its parts are stages of one feedback loop:

**Prepare → Execute → Collect evidence → Reflect → Investigate → Feed back
into the next session.**

A conventional journal asks "how much money did I make?" MogMine asks: What
was I expecting? What did I actually do? What objectively happened in the
market? Where did my discretionary judgment help or hurt? Under which
conditions does this setup work? Am I improving as a trader?

Two separations define the product and must never be blurred:

- **Strategy quality vs execution quality** (Strategy Lab researches the
  market opportunity from historical data; Playbook Lab researches the
  trader's actual behavior from the journal).
- **Recorded facts vs derived facts vs visualization** (what the trader
  reported, what derivation establishes, what candles suggest, what the chart
  shows — see docs/15). A price observation is not an execution event.

Project-wide invariant: **MogMine must know the difference between what
happened, what was known at the time, and what was learned afterward.**
Planning revisions, mood timestamps, discretionary-call timestamps,
point-in-time levels, and Strategy Lab known-at rules all serve this.

## 2. Owner decisions locked 2026-11-24 — R and position sizing

These are the owner's own definitions, stated directly. They supersede any
older description of R anywhere in this repository (including older text in
AGENTS.md, DECISIONS.md, and the swarm decision documents).

1. **1R is the account's fixed risk unit. The owner's standard unit is $300.**
   It is a per-account setting and may change, but at any moment it is a
   single fixed dollar figure — it is *not* derived from any trade's stop.
2. **At entry, the trader declares a risk fraction** — full, half, quarter
   risk — based on setup quality (an A+ setup gets more of the unit, a C−
   setup gets less). The fraction is the trader's intent and is recorded.
3. **The system sizes the position from the fraction and the stop.**
   Target dollars = fraction × account unit. Contracts = target dollars ÷
   (stop distance in points × the instrument's dollars-per-point), rounded to
   the nearest whole contract. You cannot trade fractional contracts, so the
   *actual* dollars risked will differ slightly from the target — record the
   actual.
   - Worked example (owner's): quarter risk on a $300 unit = $75 target.
     A 15-point stop on MES (micro = $5/point) risks $75 on 1 micro → the
     trade is 1 micro, $75 actually risked, 0.25R consumed. That trade must
     run 4× its risk (60 points) to return +1R.
4. **Result R = trade P&L ÷ account unit.** Risk consumed = actual initial
   dollars risked ÷ account unit. The old stop-width multiple
   (`rMultiple()`, P&L ÷ that trade's initial risk) is a *different number
   answering a different question* and must not be presented as "R" anywhere.
5. **Dollars-per-point is per instrument — never hard-code $5.** MES micro =
   $5/pt; MNQ micro = $2/pt; other instruments differ again. Sizing requires
   an instrument spec table (point value, tick size, tick value) that every
   sizing calculation reads from.
6. **The R migration is one release boundary.** Every consumer must agree in
   the same release: trade detail, summaries, Trade Cards, Day Cards,
   challenges, playbook statistics, drills, daily reviews, selectors,
   AI descriptions (`lib/describe.ts`), and the agent house rules. A release
   where one surface says 2R and another says 0.5R for the same trade is a
   failed release — both numbers look plausible, which is what makes the
   split dangerous.

## 3. Current release objective: CONVERGENCE, not expansion

The audit's verdict: the vision is coherent (9/10) but integration is the
weak point (end-to-end integration 5.5/10, production readiness 4.5/10).
Individual systems are being built faster than the product is being
assembled, exercised, and reconciled. Until the priorities below are done,
**do not start new feature areas**. The next milestone is the whole machine
behaving like one machine, demonstrated by the acceptance scenario in §6.

Priority order:

1. **This blueprint / baseline reconciliation.** (Done — this document.
   Keep it current.)
2. **Financial and temporal truth.** Complete the R migration per §2 as one
   release boundary (the RS-* packages). Reconcile the overlapping evidence
   paths (`deriveTrade`, `observeTrade`, `buildMarks`, `excursions`,
   `validateTradeAgainstBars`, `buildHindsight`) so chart, statistics, and
   AI description cannot disagree about the same trade. Mind the fill-match
   edge case: a fill shifted to a matched bar's open must not admit that
   bar's whole range as sequenced evidence — 1-minute OHLC cannot establish
   which price came first.
3. **Permanent candle archive — start in parallel with #2, it is
   time-sensitive.** D-005 already decided this: candles persist when a
   trade is logged and are read from the database first. Yahoo history
   expires; unarchived evidence is unrecoverable later. Settle provider,
   retention, coverage records, and backfill behavior.
   - **Standing owner rule: PR #71 (Supabase candle archive) is NOT merged.**
     Its code is verified on `feat/m0-candle-archive`, but merging requires
     the owner's explicit tap, and the archive stays OFF until the owner
     personally completes the Supabase setup steps. No agent merges #71 or
     connects the archive without the owner saying so.
4. **Sync integrity.** `lib/persistence/store-sync.ts` is last-write-wins
   without `expectedUpdatedAt`; an agent write and a device write can
   silently overwrite each other (docs/26 §8.4 lists nine known gaps). The
   persistence contract already supports optimistic concurrency — use it in
   the sync path. Add full pagination to collection sync (recognizing the
   row cap is not the same as retrieving the whole history). Verify backup
   recovery end-to-end.
5. **Complete the AI operation contract.** The house rules
   (`lib/agent/house-rules.ts`) already reference `GET /api/v1/vocabulary`,
   `POST /api/v1/checks/trade`, and the `daily_reviews` collection — the
   dedicated vocabulary and check routes do not exist yet and daily reviews
   have not reached the remote adapter. **House rules must never advertise a
   capability the API does not have.** Either build the endpoint or remove
   the reference, in the same change. Principle: the AI interprets the
   trader's language; MogMine interprets the market and enforces the data
   contract — an agent should never have to invent a calculation the app can
   perform. Also reconsider House Rule 5: stop/trail exits do not always
   fill at the working stop (slippage); distinguish trigger price from
   actual execution price.
6. **Complete the daily trading loop.** Treat the *session* as the
   organizing unit: pre-market plan, trades, discretionary calls, mood,
   challenges, market conditions, and the daily review retrievable as one
   coherent package ("ask MogMine about Tuesday").
7. **Then expand analytical intelligence.** Playbook Lab and Strategy Lab in
   independently testable vertical slices. Strategy Lab: the registry
   currently holds zero concrete skills — validate one small end-to-end
   research workflow before adding breadth. Guard the known traps:
   exploratory subgroup results are not held-out validation; track how many
   conditions were searched; null skill outputs must not satisfy `!=`
   conditions; missing bars must make aggregate volume unavailable, not
   silently partial. Discretionary-call grades (Skip/Flip) are hypothetical
   market outcomes — keep them out of the realized P&L ledger.

**Temporarily deprioritized** (do not pull these forward): broker automation
(parked, D-009), additional card variations, additional indicator breadth,
more challenge types, a built-in multimodal AI engine, extensive Strategy
Lab skill libraries, additional major redesigns.

## 4. Subsystem maturity (audit snapshot, 2026-11-24)

Scale: 0 idea · 1 specified · 2 engine implemented · 3 integrated ·
4 verified end-to-end · 5 operational in deployed use.

| Subsystem | Level | Note |
|---|---|---|
| Manual trade journal | 3 | |
| Interactive charts, position boxes, markers | 3 | |
| Yahoo market data retrieval | 3 | |
| Device candle caching | 3 | |
| Permanent server candle archive | 1 | D-005 decided; PR #71 unmerged (see §3.3) |
| Accounts & running statistics | 3 | |
| Per-account fixed R | 2 | New model in `lib/r-size.ts`; consumers not migrated (§2) |
| Playbook editor & binder | 3 | |
| Playbook Lab | 1 | |
| Planning sessions & after-session review | 3 | |
| Dedicated daily reviews | 2 | Model + local storage; not in remote adapter |
| Mood system | 3 | |
| Challenges | 3 | Blocked on trustworthy R (§2) for correctness |
| Review drills | 3 | |
| Discretionary calls | 2 | Model + storage |
| Discretionary prompts | 2 | Engine implemented |
| Trade Cards | 3 | |
| Day Cards | 2 | Builder + renderer |
| Supabase persistence adapter | 3 | In source; live policies unverified by audit |
| Auth & agent keys | 3 | Hashed, revocable tokens |
| Agent CRUD API | 3 | |
| Agent market-aware validation | 2 | Vocabulary/check endpoints missing (§3.5) |
| Strategy Lab | 2 | Foundation only; zero registered skills; no route/UI |
| Multimodal AI coaching engine | 1 | Planned |
| Broker ingestion | 0 | Intentionally parked (D-009) |

## 5. Document authority hierarchy

When documents disagree, resolve in this order:

1. **MOGMINE-BLUEPRINT.md** — current state, priorities, R definitions.
2. **DECISIONS.md** — settled architectural/owner decisions (unless §2 or
   this blueprint explicitly supersedes).
3. **AGENTS.md** — how to work safely in this codebase.
4. **BOARD.md / NOTES.md** — current work order and handoffs.
5. **Numbered specs (docs/01–26), docs/playbook-design/,
   docs/design-2026-11-24/, swarm documents** — design detail. These contain
   superseded material; check dates and this blueprint before implementing
   from them. Known drift examples: package counts of 34 vs 35 vs 36 across
   swarm docs (the machine-readable `swarm-plan.json` has 36); older docs
   describing Supabase as "planned"; older R descriptions requiring a stop.

Large files are grandfathered over the 450-line guideline, but
`TradeDetail.tsx` and `lib/trades.ts` are integration hotspots — prefer
controlled extraction of a responsibility over piling new wiring into them,
and never whole-file-save over another agent's work.

## 6. End-to-end acceptance scenario (0 of 11 verified)

Feature percentages mean little until this whole workflow passes:

1. Create an account with fixed 1R — set $300 as the account's risk unit.
2. Prepare a trading session — record bias, levels, a watched playbook.
3. Log a trade through an AI agent — vocabulary, price, time, size, and
   initial stop all validated.
4. Confirm it on the phone — chart and stored record agree.
5. Move the stop — original stop preserved, movement recorded.
6. Close the trade — fills, account R, P&L, and post-entry excursions agree
   on every surface.
7. Edit from another device — simultaneous edits destroy nothing.
8. Complete the daily review — linked to the actual trades and the
   pre-session plan.
9. Export a Trade Card — figures agree with the journal; Shield works.
10. Investigate the playbook — real performance connected to market
    conditions.
11. Recover the journal — records and historical candle evidence restored
    on a fresh device.

## 7. A note on MogMine's database

MogMine migrations were applied to the shared `showmob-dev` Supabase project
with MogMine-prefixed objects and RLS. Prefixes and code rules are not full
isolation — before any move toward additional users, decide whether MogMine
gets its own dedicated Supabase project. The in-process rate limiter is
development-grade only; make it durable before the external API is broadly
accessible.
