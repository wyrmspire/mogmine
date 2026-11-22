# 25 — Discretionary Calls

How the trader records judgement: the moments they leave the setup, the signal or the plan on purpose, and why. The owner asked for this on 2026-11-22: "here's my setup, but I'm not taking it because…", "I'm getting a short entry but I'm taking a long, and here's why", "here's why I'm cutting this trade", "here's why my stop is here", "here's why I'm taking profit early".

> [!NOTE]
> **Status: proposal (`OD-52`).** The owner asked for ideas and a plan, not a settled design. Names, colours and chips below are proposals. The pure model in `lib/calls.ts` is the first slice (`DC-1`); nothing is drawn or stored yet.

It builds on [03 §2](03-trade-cards-and-note-taking.md#2-simple-vs-advanced-note-taking) (Simple and Advanced notes), [11 §3](11-product-workflows-and-api-context.md#3-notes-attach-to-market-objects) (anchored comments), [15](15-trade-document-and-render-grammar.md) (trade document, hindsight), [24](24-planning-sessions-and-after-session-review.md) (planning sessions and review) and the hindsight block (issue #37, `lib/hindsight.ts`).

---

## 1. The idea: a call is a decision, not a note

A note says what happened. A **call** says *what I chose instead of the default, and why*. The default is whatever the system would have done: the playbook's entry, the planned stop, the target, the full size. Recording the call separately lets the app answer the question every discretionary trader has and almost none can answer: **is my discretion making me money or costing me money?**

Three rules make calls worth having:

1. **Fast to make.** One tap for the kind, one or two chips for the reason, optional text or voice. Under ten seconds, like Simple Mode ([03 §2A](03-trade-cards-and-note-taking.md#a-simple-mode-mobile--in-session--target-under-10-seconds)).
2. **Honest about time.** A call records when the decision was made (`made_at`) and when it was written down (`recorded_at`). One written after the trade closed is marked **after the fact**, the same rule as planning-session edits (LV-15, [24 §2](24-planning-sessions-and-after-session-review.md#2-a-planning-session-is-a-pre-x-checkpoint-proposal-od-51)). A reason written after you know the outcome is a story, not evidence.
3. **Graded by code, later.** Candles decide whether the call paid, never the model and never the trader's mood (guardrail 11, B-62). The grade is hindsight and always labelled that way; it never changes R, P&L or stats (B-63, UX-52).

## 2. The seven kinds

| Kind | Glyph | Prompt | What "the default" was | Graded against |
| :--- | :---: | :--- | :--- | :--- |
| **Skip** | `⊘` | "Setup's here. Why not?" | Taking the setup | The not-taken plan's hindsight (`observeTrade`, `OD-50`) |
| **Flip** | `⇅` | "Signal says one way. Why the other?" | Trading the signal's direction | The signal's direction with the same stop distance |
| **Cut** | `✂` | "Why out before stop or target?" | Holding to stop or target | `buildHindsight`: which level came first after the exit |
| **Early take** | `◎` | "Why bank it before target?" | Holding to target | Same as Cut, in profit |
| **Stop here** | `⊢` | "Why is the stop at this price?" | The playbook's stop rule | Nearest planned level in ticks; whether price came within 2 ticks and turned |
| **Hold** | `→` | "Why still in past target / time?" | Exiting at target or time stop | Where it exited versus the target |
| **Size** | `±` | "Why more or less than normal?" | The account's normal size | R and $ difference at the normal size |

Cut and Early take are separate on purpose: cutting a loser and banking a winner come from different feelings and need different stats. "Cut Early" already exists as an execution chip ([03 §2A](03-trade-cards-and-note-taking.md#a-simple-mode-mobile--in-session--target-under-10-seconds)); a Cut call is the reasoned version of it and does not replace the chip.

## 3. Reasons: chips first, words second

Each kind offers its own short chip set, ordered by the trader's use (like the setup chips today). All kinds share a few: `Gut`, `News soon`, `Tired / tilted`, `Daily limit close`.

| Kind | Proposed chips |
| :--- | :--- |
| Skip | `Late in move` · `No room to level` · `Against HTF` · `NQ not confirming` · `Chop` · `Already hit target for the day` · `Spread / speed` |
| Flip | `Failed breakout` · `Trapped traders` · `NQ diverging` · `Level held` · `Absorption` · `HTF says other way` |
| Cut | `Thesis broken` · `Stalled at level` · `NQ turned` · `Time stop` · `Volume dried up` · `Scared` |
| Early take | `Into a level` · `Momentum fading` · `Spike / wick` · `Locked the day` · `Scared` |
| Stop here | `Behind level` · `Behind swing` · `ATR / ADR` · `Fixed ticks` · `Round number` · `Below liquidity` |
| Hold | `Trend day` · `No opposing level` · `Trailing` · `NQ leading` |
| Size | `A+ setup` · `Low conviction` · `Near loss limit` · `After a loss` · `Playing with profit` |

`Scared`, `After a loss` and `Tired / tilted` are honest chips. They feed Mood Shape ([18](18-mood-shape.md)) as evidence, never as a score (OD-39).

Then optional: one line of text or a voice memo, and **conviction** — three dots, low / normal / high. Conviction lets the review ask "do my high-conviction calls pay better than my low ones?"

## 4. Colours

Calls need one colour family that is not profit, loss, gold, the plan fills or the candles, so a glance tells "this is *me* deciding" apart from "this is the market" and "this is the plan". Text and glyph always carry the meaning; colour only helps (UX-80).

| Token | Default | Colour-blind theme | Use |
| :--- | :--- | :--- | :--- |
| `--call-ink` | `#9ad1ff` ice blue | `#e5e7eb` silver | Glyph, chip outline, chart pin for any call |
| `--call-ink-soft` | `--call-ink` at 16% | same | Chip fill, note card left rule |
| `--call-against` | `var(--warn-amber)` | `var(--warn-amber)` | Flip and Skip, the calls that go against the setup |
| `--call-paid` | `var(--profit-text)` | `var(--profit-text)` | Hindsight grade "Paid" |
| `--call-cost` | `var(--loss-text)` | `var(--loss-text)` | Hindsight grade "Cost" |

- Ice blue reads as "cool head" against the warm gold of the app and is clear of the teal and purple that D-010 and OD-23 retired from boxes. In the colour-blind theme blue already means profit, so calls switch to silver.
- **Gold stays the app's.** A call is never gold; gold is for plan and brand (Invariant 5).
- **Grades are words first:** `Paid +1.4R`, `Cost −0.8R`, `Even`, `Can't tell yet`. The colour follows the word.

## 5. Where calls live on screen

### During the session (phone, thumb zone)

- **Call button** in the open-trade bar next to Close: one tap opens a sheet with the seven kind glyphs as 48 px tiles (two rows, the right-hand side first for the thumb). The sheet pre-picks the likely kind: Cut or Early take if the trade is open and in loss or profit, Skip if no trade is open.
- **Skip from the plan.** On a planning session ([24](24-planning-sessions-and-after-session-review.md)) each watched playbook row gets a `⊘ Skip` action. A Skip with a time and price becomes a not-taken plan, so the observer can grade it.
- **Flip from the add-trade form.** When the trade's direction is opposite the playbook's direction (or the user taps "Signal was the other way"), the form adds one line: *"Flip — why?"* with its chips.
- Saving follows the note rules: save on type, "Saved on this device", nothing lost offline (UX-30–UX-39).

### On the chart

- A call with a time and price is a small `--call-ink` pin with its glyph, drawn by the Canvas primitive (Invariant 1, D-004), anchored to a bar by B-23 snapping and to a fill where it has one ([11 §3](11-product-workflows-and-api-context.md#3-notes-attach-to-market-objects)).
- A **Stop here** call draws nothing extra; it labels the existing stop line's price-axis tag with `⊢`.
- A **Skip** with a plan shows the plan's faint fills (D-010) with a dashed `--call-against` outline, so a not-taken plan never looks like a trade.
- Tapping a pin opens the call in the panel below the chart, not over it. A text list of calls is always available (UX-80).

### After the session

- **Calls ledger** on the after-session review ([24 §4](24-planning-sessions-and-after-session-review.md#4-after-session-review)): every call of the session in time order, each with its reasons, conviction, grade and an after-the-fact badge if any.
- **Discretion score** card on Review: per kind, how many calls, how many paid, and the net R the calls made or cost against the default. Example: *"Cuts: 9 calls, 6 paid, +2.1R saved. Early takes: 7, 2 paid, −3.4R left on the table."* Code computes every number. Calls made after the fact are counted separately, never mixed in.
- **Reason leaderboard:** which chips come before calls that pay ("`Into a level` early takes paid 5 of 6") and which come before calls that cost ("`Scared` cuts paid 1 of 7"). This is the payoff of the whole feature.
- **Drill cards** ([23 §4](23-card-system.md)): a call becomes a flash card. Front: chart to the decision bar, "What would you do?". Back: what you did, why, and the grade.

## 6. Grading by code (hindsight)

Grades are hindsight. They use only bars after `made_at`, stop at the session close, and are labelled "Hindsight" wherever shown (issue #37).

- **Cut / Early take.** Reuse `buildHindsight` on the trade's own stop and target. Stop reached first → **Paid** (the cut saved the distance from exit to stop). Target first → **Cost** (it left exit to target). Same bar → **Can't tell**. Neither by session close → **Even** at the exit; neither in partial bars → **Can't tell yet**. The R amount is computed in integer ticks against the initial risk; no stop on record means no R (guardrail 4).
- **Skip.** Reuse the not-taken plan hindsight (`observeTrade` → `not_taken_plan`, `OD-50`). Plan would have stopped → Paid. Would have hit target → Cost.
- **Flip.** Grade the mirror trade: the signal direction from the same entry with the same stop distance. Needs `DC-3`.
- **Stop here, Hold, Size.** Graded in later slices (§8). Until then they show **Not graded**.

The model may describe a call ("you cut into a stall at VWAP"); it may not compute or restate a grade number it was not given (guardrail 11).

## 7. Record shape (proposal, `OD-52`)

Local-first in `mogmine-calls-v1` with backup, like playbooks and challenges ([22](22-development-mode-and-backend-boundary.md)). Every record has `user_id` (Invariant 7).

- `id`, `user_id`, `kind`, `made_at` (ISO, UTC), `recorded_at` (ISO, UTC).
- `trade_id` (nullable: a Skip has no trade), `plan_session_id` (nullable, `OD-51`), `playbook_id` (nullable).
- `price` (nullable; the stop price for Stop here, the plan entry for Skip) and `price_ticks` with it (guardrail 4).
- `signal_direction` (Flip and Skip only).
- `reasons[]` (chip ids), `note` (text), `conviction`: `1 | 2 | 3 | null`.
- `after_the_fact` is **derived**, never stored: true when `recorded_at` is more than five minutes after `made_at` (`isAfterTheFact`). A Cut written down a minute after the exit is fine; the same Cut written that evening is flagged.
- Grades are **derived**, never stored (docs/15 §3.3).

## 8. Build slices

| Slice | What | Needs |
| :--- | :--- | :--- |
| `DC-1` | **Done (this change).** Pure model: kinds, chips, validation, after-the-fact rule, Cut / Early take grading from `buildHindsight`. `lib/calls.ts`, tests. CSS tokens in `app/globals.css`. | — |
| `DC-2` | Store `mogmine-calls-v1`, backup round-trip, `user_id`. | `DC-1` |
| `DC-3` | Call sheet (seven tiles, chips, conviction, note) from the open-trade bar and Trade Detail. Flip line on the add-trade form. Skip from the plan screen. | `DC-2`, `PS-2` for Skip |
| `DC-4` | Calls list under the chart; pins on the chart in `PositionBoxPrimitive`. | `TD-3` |
| `DC-5` | Skip and Flip grading; calls ledger in the after-session review. | `PS-4` |
| `DC-6` | Discretion score card and reason leaderboard on Review. | `DC-5` |
| `DC-7` | Drill cards from calls. | `CD-2` |

These sit after the `D-011` slices in the queue unless the owner moves them up.

## 9. Ideas not yet in scope

- **Pre-commit a call.** Before entry, say "I'll cut if NQ makes a lower low". If you then cut, it is a planned call, not a discretionary one. The review shows planned versus improvised calls.
- **Second opinion timer.** Holding the Cut button for 2 s shows the trade's distance to stop and target in R before you confirm the reason. A speed bump, not a block, and it never sends an order (guardrail B-01: the app never trades).
- **"Would you make this call again?"** asked blind the next morning, like the blind review (BET-03).
- **Voice call.** "Cutting, NQ turned" parsed into kind + chip, offered as a suggestion that never overwrites (UX-33).
