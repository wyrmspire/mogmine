# 07 — Agent API: house rules at discovery, real vocabularies, candles, levels and checks

Source: FIELD-NOTES: *API gaps* (11/22 simulation), *Gap: no candles or computed levels/VWAP through the API*, *SOP: notes on API-created trades*, *Gap: API-created trades had no setup*, *Fill-to-bar matching* SOP, *Idea: inject usage guidance into tool/API discovery* and its *stated R* continuation, the archived-accounts quirk, and the **reliability warning** (11/23 API records contain errors: wrong bar, wrong stop, invented playbook names "News Impulse" and "VWAP Hold", R text in notes, a false SL touch). Related: #185 (agent API: `185a` tokens and records, `185b` OpenAPI and `/.well-known/mogmine.json`), docs/11 §5 (assistant API rules), `OD-19`, docs/16 `R-06`, docs/26 §6–7, Invariant 6 (adapters), guardrail 11.

Every rule below exists because an agent got it wrong on 11/23. The point of this design is that the API itself teaches the rules and hands over the real lists, so the next agent does not depend on a field-notes file it may never read.

---

## 1. What exists

- `/api/v1/me`, `/api/v1/records/{type}` (list, create), `/api/v1/records/{type}/{id}` (get, patch, delete), `/archive`, `/api/v1/singletons/{key}`. Bearer agent keys with `read` and `write` scopes, rate limit, audit (`lib/agent/*`). Writes go through the journal command layer (`lib/commands/journal-commands.ts`), which validates and refuses derived fields (`net_pnl`, `r_multiple`, …).
- `/api/v1/openapi.json` (`lib/agent/openapi.ts`): paths and types, but record bodies are `additionalProperties: true`, with no field documentation.
- `/.well-known/mogmine.json`: base URL, spec URL, auth and scopes. No guidance.
- **Bug:** `parseListQuery` (`lib/agent/http.ts:83`) passes `includeArchived: undefined` when the parameter is absent, and the contract's default is `true` (`lib/persistence/contract.ts` `ListQuery`). The OpenAPI text says the default is `false`. So archived accounts come back from `GET /records/accounts` (field notes, QA clean-up). Fix: the HTTP layer defaults both `includeArchived` and `includeSamples` to `false`, as documented.
- No candles, no computed levels, no VWAP, no derived values (P&L, R, hold) on read, no list filters except `parentId`, no batch create.

## 2. House rules, served at discovery

### 2.1 One source

`lib/agent/house-rules.ts` (new, pure data plus a renderer). Each rule has an id, the rule, why, a bad and a good example, and `version`. The same list is rendered into:

1. `/.well-known/mogmine.json`: `house_rules` (id + one line each), `house_rules_version`, `guide_url`, `vocabulary_url`.
2. `/api/v1/openapi.json`: `info.description` (markdown list) and `x-mogmine-house-rules` (structured). Trade and plan operation descriptions repeat the rules that apply to them (HR-2, HR-4, HR-5 on trades).
3. `GET /api/v1/guide` (read scope): the full rules with examples, plus step-by-step **workflows** (§2.3).
4. The **setup block** on the agent keys page (`setupBlock` in `lib/agent/openapi.ts`): one line, "Before writing anything, read {guide_url}."

A test asserts that every rule id appears in all three machine outputs, so they cannot drift.

### 2.2 The rules

| Id | Rule | Why (11/23) |
| :--- | :--- | :--- |
| HR-1 | **Notes are commentary only.** `note`, `pre_trade_thesis`, `management_notes`, `post_exit_notes` and review points hold reasoning, mistakes, lessons and what to do differently. Never restate entry, stop, stop distance, target, exit price or time, risk dollars, R or size. | trade-20261123-c repeated the 12-pt stop, the $75 / 0.25R risk and the entry |
| HR-2 | **Verify every stated time against the 1-minute candles** before saving: the fill price must trade in that minute's bar. If it does not, look ±5 minutes and propose the matching minute to the trader. Use `POST /api/v1/checks/trade`. | C's entry was put on the 14:14 bar; 7263 printed at 14:13 |
| HR-3 | **Playbook, setup tags and execution tags come from `GET /api/v1/vocabulary` only.** Never invent a name. Ask the trader, or propose the best match and get a yes. Never leave them blank silently. | "News Impulse" and "VWAP Hold" playbooks do not exist; three trades had no setup |
| HR-4 | **Record stop moves with times** in `stop_moves` (`[{price, time}]`). `initial_stop_price` is the first stop, `stop_loss_price` the last. Never set `initial_stop_set_at` to stand in for a move time. | A's trailed stop was treated as live from the entry → false SL touch |
| HR-5 | **`exit_reason` changes the chart:** `stop` and `trail` mean the exit filled at the working stop; `target` at the target; `breakeven` at the entry; `manual` at market. Pick the one that happened; the exit price must agree. | |
| HR-6 | **R is measured against the account's R size** (`r_size` in the vocabulary's accounts), never the stop width. Do not write R anywhere; the app computes it. | risk was shown as 1R instead of 0.29R of $300 |
| HR-7 | **Stated vs actual risk.** When the trader says ".25R", write `stated_risk_r: 0.25`. Never replace it with stop math, and never "correct" the stop to match it. The app shows both. | the $75 = 0.25R sizing ended up only in notes |
| HR-8 | **Times are UTC ISO-8601 in the API.** The trader speaks Central Time (`America/Chicago`). The session date rolls at 17:00 CT (18:00 ET): an evening trade belongs to the next day's session. | |
| HR-9 | **Daily reviews go in `daily_reviews`** with explicit `trade_ids`, not in `plans`. Plans are pre-session checkpoints. | review-2026-11-23 was stored as a plan with a hand-patched anchor |
| HR-10 | **Never write derived values** (`net_pnl`, `r_multiple`, `hold_seconds`, `mae_price`, `mfe_price`, `risk_cents`). Read them with `?include=derived`. | |
| HR-11 | **Read back after every write** (GET and compare) and report differences to the trader. | |
| HR-12 | **Ask before deleting.** Accounts and playbooks archive; they are never deleted. | |

HR-6 and HR-7 depend on [04](04-r-size.md) (the fields `r_size_cents`, `stated_risk_r`). Until that ships, the guide says "R size: not yet stored; do not write risk or R into notes".

### 2.3 Workflows in the guide

`log_trade`: (1) GET vocabulary; (2) collect symbol, side, qty, entry/exit prices and times in CT, initial stop, stop moves with times, target, exit reason, stated risk, account; (3) propose playbook and tags from the vocabulary and get a yes; (4) `POST /checks/trade` with the draft and resolve every `shifted` or `outside` time with the trader; (5) create; (6) read back; (7) add notes last, commentary only.
`review_day`: (1) list the day's trades (`?session_date=`); (2) create a `daily_reviews` record with their ids; (3) add points; (4) read back.
`plan_session`: create a plan with a preset and anchor; levels from `GET /levels` are computed, so only add typed levels the trader states.

## 3. New read endpoints

All read scope, same auth, rate limit and audit as today. Market data goes through `MarketDataProvider` (Invariant 6), never `yahoo-finance2` from a route.

### 3.1 `GET /api/v1/vocabulary`

```jsonc
{
  "house_rules_version": "2026-11-24.1",
  "playbooks": [{ "id": "orb-reclaim", "name": "ORB Reclaim", "rules": ["…"], "archived": false }],
  "setup_tags": ["SMT Divergence", "Pushed w/ NQ", "Level Sweep", "VWAP Hold", "Opening Drive"],
  "execution_tags": ["A+ Patience", "Chased Entry", "Cut Early", "Moved Stop", "Revenge"],
  "accounts": [{ "id": "sim-acct-eval-50k", "name": "SIM Eval 50K", "r_size_cents": 30000, "r_size_source": "account" }],
  "default_r_size_cents": 25000,
  "exit_reasons": [{ "value": "trail", "label": "Trailed", "effect": "Exit filled at the working (moved) stop." }],
  "symbols": [{ "symbol": "MES", "tick_size": 0.25, "point_value_usd": 5 }],
  "plan_presets": [{ "preset": "pre_market", "name": "Pre-market (New York)", "anchor_ct": "08:30" }],
  "time": { "display_zone": "America/Chicago", "session_zone": "America/New_York", "session_rollover_et": "18:00" }
}
```

- Playbooks are the owner's live list (active first; archived flagged so old trades still resolve). Accounts are active only.
- Tags come from `lib/playbooks.ts` today, or the tag registry if `PL-3` ships ([01](01-playbook-lab.md) §5). Note "VWAP Hold" is a **setup tag**, not a playbook; the 11/23 agent confused the two.

### 3.2 `GET /api/v1/candles?symbol=MES&from=…&to=…&timeframe=1m`

- Symbol mapping per Invariant 3 / `OD-15` (`MES` → `MES=F`, no `ES=F` fallback). `from`/`to` are UTC ISO; the range is at most 26 h for 1m (the `/api/market-data` day-mode limit), 7 days for 5m and 15m.
- Response: cleaned bars (guardrail §3b-8: no null prices, nothing outside the window), `timeframe`, `provider`, and `coverage: { expected, present, gaps: [{from, to, bars}] }`. Empty weekend windows answer `200` with no bars and `reason: "closed"`; a future window `reason: "future"` (as PR #205 does).
- Times in the payload are UTC ms and ISO, with a `ct` string for each bar (`"14:13"`) because agents speak to the trader in CT.
- Server cache: an in-memory LRU per instance until the archive (`#70`, `R-04`) exists. Nothing is written to Supabase by this endpoint.
- Never in list responses (B-42).

### 3.3 `POST /api/v1/checks/trade` (read scope; saves nothing)

Body: a draft trade (same shape as create) or `{ "id": "…" }` for a stored one. Response:

```jsonc
{
  "fills": [
    { "role": "entry", "stated": "2026-11-23T20:14:00Z", "price": 7263, "match": "shifted", "matched": "2026-11-23T20:13:00Z", "offset_min": -1,
      "message": "7263.00 did not trade in the 14:14 CT bar. It traded at 14:13 CT. Ask the trader." },
    { "role": "exit", "match": "stated" }
  ],
  "stop_moves": [{ "time": "…", "ok": true }],
  "findings": [{ "code": "stop_traded_through", "bar_ct": "08:05", "price": 7119.5 }],
  "warnings": [{ "code": "playbook_missing", "message": "No playbook. Ask the trader or propose one from /vocabulary." }],
  "derived": { "risk_cents": 8750, "risk_r": 0.29, "r_size_cents": 30000, "stated_risk_r": 0.25 }
}
```

It reuses `matchFill` ([05](05-stops-mae-fills.md) §4), `observeTrade` with the post-entry rule (§1), the stop-move validation (§3.1) and the R helpers ([04](04-r-size.md)). Being a POST that writes nothing, it is safe to call repeatedly.

### 3.4 `GET /api/v1/levels?symbol=MES&session_date=2026-11-23&as_of=2026-11-23T13:55:00Z`

- Computed levels from `LV-1` (`lib/levels.ts`): PDH, PDL, PDC, RTH open/high/low, 3 PM close, Globex open, ONH, ONL, week high/low; each with value, `formed_at`, coverage, and **withheld reasons** (PR #201's `withheldReasons`) instead of a value when withheld.
- Planned levels from the trader's plans for that date, as they stood at `as_of` (`planStateAsOf`), with plan name and revision.
- Session VWAP (RTH and Globex) at `as_of`, with the coverage and the `≈` flag from [03](03-indicators-and-levels.md) §5. The 200 EMA joins when `IN-3` ships.
- Provenance on every value: provider, timeframe, calculation version (docs/11 §4).
- `as_of` defaults to now; values after `as_of` are never used (point-in-time, B-14).
- **No snapshot is stored on trades** in this design. docs/12 `OD-20` proposes freezing `levels_at_entry`; that stays an open decision (Q-8).

### 3.5 Reading derived values and filtering lists

- `GET /records/trades/{id}?include=derived` and on lists: adds `derived: { pnl_cents, result_r, risk_cents, risk_r, r_size_cents, r_size_source, stated_risk_r, hold_seconds, session_date }`. Computed on read; never stored (except `risk_cents`, see [04](04-r-size.md) §3.3).
- List filters for trades: `session_date`, `from`, `to` (entry time), `account_id`, `playbook_id`. For `daily_reviews`: `session_date`. Implemented in the command layer on top of `list`, using the generated columns already on `mogmine_trades` (`entry_time`, `account_id`, `playbook_id`).
- Account read with `?include=derived`: balance from the journal (docs/21), labelled `from_journal_gross: true`.

## 4. Write-time checks: refuse or warn

Write responses gain `warnings: [{ code, message }]`. Warnings never block. Refusals are 422 with a plain message (the current style, which the 11/22 simulation found good).

| Condition | Result |
| :--- | :--- |
| `playbook_id` not in the owner's playbooks | **422**, listing valid ids and names |
| `account_id` not an owner account | **422** |
| A `quick_tags` value not in the vocabulary | **422** listing valid tags *(Decision Q-9: refuse, or warn and keep custom tags. Recommended: refuse until a tag registry exists.)* |
| No `playbook_id` on create | warning `playbook_missing` |
| No setup tag | warning `setup_tag_missing` |
| Notes contain a number equal to the entry, stop, target or exit price, or an R / dollar risk pattern (`0.25R`, `$75`) | warning `notes_restate_fields` (HR-1) |
| `stop_loss_price ≠ initial_stop_price` and no `stop_moves` | warning `stop_moved_without_time` (HR-4) |
| `exit_reason` `stop`/`trail` and exit more than 2 ticks from the working stop | warning `exit_reason_mismatch` |
| `stated_risk_r` and actual risk R differ | warning `stated_risk_differs` (informational; HR-7) |
| Entry time more than 5 minutes in the future | **422** *(field notes: "maybe reject future-dated"; recommended yes, decision Q-10)* |
| Entry or exit price outside the day's traded range by more than 1% (when bars are cached on the server) | warning `price_out_of_range` |
| `risk_cents` differs from the computed value | **422** |

Fill-time matching is **not** run on create (it needs candles and would make writes slow and flaky); agents call `/checks/trade` first (HR-2).

## 5. Security and limits (docs/11 §5, `OD-19`)

- New endpoints are read scope. `/checks/trade` is read scope although it is a POST.
- Candle and levels calls count against the same per-key rate limit, plus a per-key cap on upstream Yahoo calls per minute.
- Nothing in house rules or responses comes from journal text (docs/11 §5 item 7: journal text is untrusted).
- Server code stays read-only against any broker (guardrail §3b-1); nothing here touches one.

## 6. Tests

- House rules: every id in well-known, OpenAPI and `/guide`; version string matches.
- Vocabulary: real playbook list from a mocked repository; archived playbooks flagged; archived accounts absent.
- `includeArchived` default false on lists (regression for the field-notes quirk).
- Candles: symbol mapping, range limits, cleaning, coverage gaps, weekend and future windows, provider mocked.
- Checks: the trade C pattern (`shifted −1`), the trade A pattern (no SL touch from the entry bar), a stop move outside the hold (error), a missing playbook (warning).
- Levels: as-of cut, withheld reasons, planned levels as of the time, VWAP `≈`.
- Write checks: each row of §4.
