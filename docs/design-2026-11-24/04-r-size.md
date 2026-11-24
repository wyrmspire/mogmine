# 04 — Per-account R size, stated vs actual risk

Source: FIELD-NOTES "Evening 11/23 voice session": *Gap: no fixed R size*, *Design: per-account R size (~8:08 PM CT)*, and the *stated R vs stop-distance R* continuation (~8:17 PM CT). Related records: `OD-10` (R definition, open), guardrail AGENTS §3b-4, docs/09 `B-32`, docs/16 `R-10`, docs/21 (accounts), docs/12 `LV-17` (sizing defaults), handoff `notes/handoffs/2026-11-23-levels-chart-opus.md` §3 (R on the initial stop).

Status: design only. Nothing here is built. The 11/23 build attempt was stopped before any push (field notes, "Process failure").

---

## 1. What Chris asked for

- **1R is a fixed dollar amount per account.** It does not depend on stop width. SIM Eval 50K: 1R = $300.
- **Each account has its own R size.** The Tune "Risk budget" (`prefs.riskBudgetUsd`, default $250) is used only for trades whose account has no R size, and for trades with no account.
- **R = dollars ÷ account R size.**
  - Risk R = actual dollars risked ÷ R size. Actual dollars risked = |entry − initial stop| × $/pt × qty.
  - Result R = dollar P&L ÷ R size.
- **Store the dollar risk on each trade.**
- **Stated R is what Chris says, as a share of the account R size.** ".25R" = 0.25 × $300 = $75. It is not the stop-width risk (trade A: 17.5 pt × $5 = $87.50). Record both when they differ, and never overwrite the stated value with stop math.
- This replaces the workaround of writing "$75 / 0.25R" into notes (SOP: notes are commentary only, see [07](07-agent-api.md) HR-1).

Worked check (from the field notes; the 11/23 trade records themselves are unreliable, so tests must use these numbers as stated, not the live records):

| Trade | Actual risk | Risk R at $300 | Stated | Result R |
| :--- | ---: | ---: | ---: | ---: |
| A | $87.50 (17.5 pt × $5 × 1) | 0.29R | 0.25R | +2.05R (P&L +$615) |
| B | $75.00 | 0.25R | 0.25R | −0.25R (P&L −$75) |
| C | $60.00 (12 pt × $5 × 1) | 0.20R | 0.25R | −0.13R (P&L −$40) |

## 2. What the code does today

- `lib/trades.ts` `rMultiple` = captured ticks ÷ risk ticks to `riskStopPrice` (the initial stop when it is on the risk side, otherwise the current stop; PR #202). That is "stop-width R": every trade with a stop risks exactly 1R.
- `initialRiskUsd` computes the dollar risk from the same stop. Nothing stores it.
- `prefs.riskBudgetUsd` ($250) is read only by `components/RiskChips.tsx` (offers stops at 0.5×, 1× and 2× the budget when a trade has no stop) and the Tune screen. It does not affect R.
- `TradingAccount` (`lib/accounts.ts`) has no R size. Records are jsonb documents in Supabase (`mogmine_accounts.record`, `mogmine_trades.record`), so new fields need sanitizer changes, not SQL migrations.
- `rMultiple` and the functions built on it are called from 16 files: `lib/selectors.ts`, `lib/day-card.ts`, `lib/shareCard.ts`, `lib/drills.ts`, `lib/mood.ts`, `lib/describe.ts`, `lib/exit-efficiency.ts`, `lib/plan-vs-actual.ts`, `lib/partials.ts`, `lib/trade-document.ts`, `lib/rstrip.ts`, `components/TradeDetail.tsx`, `TradeRow.tsx`, `ReviewScreen.tsx`, `DrillScreen.tsx` and `AddTradeSheet.tsx`.

## 3. The model

### 3.1 Two kinds of number, two names

| Name in code | Meaning | Needs a stop? | Shown as |
| :--- | :--- | :--- | :--- |
| `resultR` | Dollar P&L ÷ R size | No | `+2.05R` |
| `riskR` | Actual dollars risked ÷ R size | Yes, or a stated risk | `Risk 0.29R` |
| `statedRiskR` | What the trader said | No (stated) | `said 0.25R` |
| `riskMultiple` (renamed from today's `rMultiple`) | Captured ticks ÷ the trade's own risk ticks | Yes | `2.0× risk` or `R:R 2:1`, never "R" |

- **Everything labelled "R" is account R.** The stop-width ratio stays in code, because the chart geometry needs it (R ruler spacing, scratch threshold, plan reward:risk). It is never labelled "R" in the UI again.
- `resultR` is defined for any closed trade with a computable P&L, **including trades without a stop**. This changes guardrail §3b-4 ("`R` is `null` without a stop"). The rule becomes: *risk R is `null` without a stop or a stated risk, never 0; result R is `null` only when P&L cannot be computed.* Integrator: edit AGENTS.md §3b-4 and docs/09 `B-32` once Chris decides ([00](00-overview.md) decision D-A).

### 3.2 Where the R size comes from

```ts
// lib/r-size.ts (new, pure)
type RSizeSource = "trade" | "account" | "prefs";
interface ResolvedRSize { cents: number; source: RSizeSource; account_id: string | null }

function resolveRSize(trade, accounts, prefs): ResolvedRSize
// 1. trade.r_size_cents when set (a frozen snapshot, §3.3)
// 2. the trade's account `r_size_cents` when the account has one
// 3. prefs.riskBudgetUsd × 100 (the fallback; always present, default 25 000 cents)
```

- The source travels with every number, so the UI can say "R from SIM Eval 50K ($300)" or "R from your default ($250); set an R size on this account".
- `prefs.riskBudgetUsd` keeps its storage key. Only its label changes: **"Default R size"**, with the hint "Used for accounts without their own R size". `RiskChips` reads the resolved R size, not the raw pref.

### 3.3 New fields

**`TradingAccount`** (`lib/accounts.ts`, sanitizer in the accounts store, docs/21 §1):

```ts
/** Dollars that make 1R in this account, integer cents. Null: use the default R size (prefs). */
r_size_cents: number | null;   // 100 ≤ x ≤ 10 000 000; whole cents
```

**`TradeRecord`** (`lib/trades.ts`, `normalizeTrade` defaults all three to null for older records):

```ts
/** R size frozen when the trade was saved (from its account, else the default). Null on old records until backfilled. */
r_size_cents: number | null;
/** Risk the trader said, as a share of R, e.g. 0.25. Never computed. Null when not stated. */
stated_risk_r: number | null;
/** |entry − initial stop| × $/pt × qty in cents. Computed by code on every write; a client value is refused. */
risk_cents: number | null;
```

Rules:

1. **Freeze the R size on the trade** (`r_size_cents`) when the trade is created, and again only when the trade's account changes. Changing an account's R size later does not rewrite past trades. This mirrors R-10's frozen initial stop. *(Decision D-B: freeze, or always read the live account value?)*
2. **`risk_cents` is computed, then stored.** Chris asked for the dollar risk to be stored per trade. It is a number code can compute (guardrail 11), so code recomputes it in `normalizeTrade` (or a write hook in the command layer) whenever entry, initial stop or quantity changes. The command layer refuses a client-supplied `risk_cents` that differs from the computed value. This is a "materialized derived field", which docs/26 does not have yet: integrator, add a row to docs/26 §4 and **do not** list it in `derivedNeverStored` (that list forbids storage).
3. **`stated_risk_r`** is free input (0 < x ≤ 10, two decimals). It is never back-filled from stop math. The UI shows its dollar value as `stated_risk_r × r_size`.
4. **Partials and scale-ins** (`lib/partials.ts`): `risk_cents` is the sum over entry fills of |fill − initial stop| × $/pt × lot qty; result R uses the total P&L. This is `OD-10`'s "R = P&L ÷ initial risk $" with the account R size as the denominator. *(Decision D-A covers `OD-10`.)*

### 3.4 Stated vs actual

```ts
function riskComparison(trade, rSize): {
  actual_r: number | null;        // risk_cents / rSize.cents
  stated_r: number | null;        // trade.stated_risk_r
  differs: boolean;               // |actual − stated| ≥ 0.02R or ≥ 1 tick × qty in dollars, whichever is larger
}
```

- Trade Detail risk line: `Risk $87.50 · 0.29R of $300` and, when `differs`: `· you said 0.25R ($75)`.
- Under Shield (UX-64): `Risk 0.29R · you said 0.25R`, no dollars and no R size in dollars.
- Stats use **actual** risk. Stated risk appears only in the trade's risk line, the review card and a later "sizing discipline" stat (stated vs actual drift; not in this design's packages).

### 3.5 Who switches to account R

| Consumer | Today | After |
| :--- | :--- | :--- |
| Trade header, feed row, review queue, Today stats, running stats (`lib/selectors.ts`), day card, share card, drills, mood vs outcome, `describe` | `rMultiple` | `resultR` |
| Challenges (docs/17) | `lib/challenges.ts` uses dollars (`tradePnl`) and the checklist only | unchanged |
| Exit efficiency (`lib/exit-efficiency.ts`) | R of MFE vs R kept | The ratio is unit-free and stays. The summary text shows account R: "kept +2.05R of +2.6R available" |
| Plan vs actual (`lib/plan-vs-actual.ts`) | differences in stop-width R | differences in account R; the plan's reward:risk shows as `R:R 2:1` |
| `plannedR` | reward ÷ risk | renamed `plannedRewardRisk`; shown as `R:R` |
| R ruler on the chart (`M3`, `lib/trade-marks.ts`) | a line at each whole stop-width R | **lines at each whole multiple of the trade's own risk, labelled in account R** (risk 0.25R → lines labelled +0.25R, +0.5R, +0.75R …). Spacing stays readable, labels are true. |
| R strip (`lib/rstrip.ts`) | stop-width axis | the same spacing, labels in account R |
| Scratch threshold (`isScratch`, `D-010` "0.1R or 2 ticks") | stop-width R | **stays on the trade's own risk.** 0.1 account R on a 0.25R trade would be 40% of its risk. Integrator: reword D-010 to "0.1 × the trade's risk" once Chris agrees (decision D-C) |
| `RiskChips` (no stop recorded) | budget × 0.5, 1, 2 | R size × 0.25, 0.5, 1 (labelled `0.25R $75`) |

## 4. Entry and editing

- **Add-trade form** (`components/AddTradeSheet.tsx`, docs/20): an optional **Risk** row after the stop with chips `0.25R · 0.5R · 1R · other`. A chip sets `stated_risk_r`. When the stop is empty, a chip also offers the matching stop price, as `RiskChips` does today. With a stop typed, the row shows the actual risk next to it: `Stop 7119.50 → $87.50 (0.29R) · you said 0.25R`.
- **Account sheet** (`components/AccountSheet.tsx`): an **R size** field ("1R in this account, $"). Empty means the default.
- **Trade Detail**: the risk line (§3.4). It is tappable to set or change `stated_risk_r`.
- **Tune**: the "Default R size" relabel (§3.2).

## 5. Recompute and migration (design only; do not run)

Nothing is rewritten silently. A worker builds the script, and Chris runs it.

1. **Set the account R size.** Chris sets SIM Eval 50K to $300 in the account sheet, or through `PATCH /api/v1/records/accounts/sim-acct-eval-50k` once `r_size_cents` is accepted. Both his accounts (Gmail and Proton) need it.
2. **Dry run.** `scripts/r-size-backfill.mjs --dry-run` (the default) reads every real trade through the command layer and prints one row per trade: id, account, resolved R size and source, computed `risk_cents`, old stop-width R, new result R, new risk R, and a **proposed** `stated_risk_r` found in the notes by pattern (`0.25R`, `.25 R`, `$75 = 0.25R`). It writes a CSV next to the script output (git-ignored). Samples are skipped.
3. **Chris reviews the CSV.** He confirms or edits the proposed stated values. Pattern matches from notes are proposals only (guardrail 11, UX-33: AI or code suggestions never overwrite what the user entered).
4. **Apply.** `--apply <csv>` writes only `r_size_cents`, `risk_cents` and the confirmed `stated_risk_r`, each with `expectedUpdatedAt` so a concurrent edit fails instead of being overwritten. It is idempotent: a second run changes nothing.
5. **Notes clean-up is manual.** The script lists notes that still contain risk or R text ("$75 / 0.25R"). It never edits notes.
6. **Backups.** Old backup files without the new fields restore with nulls. `r_size_cents` then resolves from the account at read time until the trade is saved again. A restore never overwrites a trade's frozen `r_size_cents` with null (same pattern as `keepInitialStop`).

The 11/23 trades (trade-20261123-a/b/c on both accounts) have known errors (field notes reliability warning). Their prices, times and stops must be checked against 1-minute candles before the apply step, using the bar check in [05](05-stops-mae-fills.md) §4.

## 6. Tests the packages must carry

- Golden: A, B and C from §1 at $300 (risk R, result R, stated vs actual `differs` true for A and C, false for B).
- Source fallback: account without R size → prefs; no account → prefs; trade snapshot wins over a later account change.
- No stop: result R present, risk R null, risk line says "No stop recorded".
- Shield: no dollars in any string.
- Partials: two entry fills at different prices, one stop: summed risk.
- `riskMultiple` keeps today's values on every existing fixture (it is today's `rMultiple`, renamed).
- Command layer: `risk_cents` from a client that differs from the computed value → 422; `stated_risk_r` out of range → 422.
- Backfill script: dry-run makes no writes (mocked repositories record zero puts); apply is idempotent.

## 7. Open questions (also in [00](00-overview.md))

- D-A: Account R replaces stop-width R everywhere "R" is shown, and guardrail §3b-4 is reworded. Recommended: yes.
- D-B: Freeze the R size on each trade. Recommended: yes.
- D-C: The scratch threshold stays on the trade's own risk. Recommended: yes.
- Q-12: Should a trade with no account use the default R size, or show "R size not set"? Recommended: the default, labelled with its source.
- Q-13: Does the stated R belong to the trade only, or also to a planning session ("today I risk 0.25R per trade")? Recommended: trade only for now.
