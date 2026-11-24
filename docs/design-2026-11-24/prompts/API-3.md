# Package Prompt: `API-3` — Agent API Candles and Pre-Save Trade Check Endpoints

- **Agent / Lane:** `swarm-5` (`L5 Agent API`) · **Wave:** `5` · **Branch:** `swarm/API-3`
- **Depends on:** `FB-1` (W1), `SM-1` (W2), `SM-2` (W3), `API-2b` (W4)

## 1. Goal

Add read-scoped `GET /api/v1/candles` (`lib/agent/candles.ts` + route) and `POST /api/v1/checks/trade` (`lib/agent/trade-check.ts` + route) so agents can inspect cleaned 1m/5m/15m candles with Central Time (`ct`) labels and verify draft trades against `matchFill`, post-entry `observeTrade`, stop-move rules, write-checks, and R sizing **before** saving anything (`HR-2`).

## 2. Read First (Required Context)

1. `AGENTS.md` (Invariant 3 `MES → MES=F` no fallback, Invariant 6 `MarketDataProvider` adapter only — **never import `yahoo-finance2` in routes**, Guardrail §3b-8 clean Yahoo bars & `200` empty on weekend/future, Guardrail `B-42`)
2. `docs/design-2026-11-24/07-agent-api.md` (§3.2 `GET /candles`, §3.3 `POST /checks/trade`, §5 security & upstream rate cap, §6)
3. `docs/design-2026-11-24/90-work-packages.md` (`API-3`)
4. `docs/design-2026-11-24/92-decisions-made-by-swarm.md` (`D-A`, `D-H`, `D-I`)

## 3. Writable Files (Strict Scope — Everything Else Read-Only)

- `lib/agent/candles.ts` *(new)*
- `lib/agent/trade-check.ts` *(new)*
- `app/api/v1/candles/route.ts` *(new)*
- `app/api/v1/checks/trade/route.ts` *(new)*
- `lib/agent/openapi.ts` *(existing)*
- `lib/__tests__/agent-candles-and-check.test.ts` *(new)*
- `lib/__tests__/agent-openapi.test.ts` *(existing)*

## 4. Step-by-Step Implementation Plan

1. **Create `lib/agent/candles.ts` + `app/api/v1/candles/route.ts` (`07` §3.2 & §5):**
   - Route through `MarketDataProvider` (`lib/market-data/yahoo.ts` / `lib/market-data/types.ts` — check how `app/api/market-data/route.ts` calls the provider and cleans/classifies `closed` vs `future` outcomes via `lib/market-data/outcome.ts` and `lib/market-data/coverage.ts`!).
   - Validate query params:
     - `symbol`: canonical symbol via `canonicalSymbol` (`MES → MES=F`, `MNQ → MNQ=F`, no `ES=F`/`NQ=F` fallback; `422 invalid` for unsupported symbol).
     - `timeframe`: `"1m" | "5m" | "15m"` (default `"1m"`; `422` otherwise).
     - `from`, `to`: valid UTC ISO strings with `from < to`; enforce range caps (`<= 26 * 3_600_000` ms for `1m`, `<= 7 * 86_400_000` ms for `5m`/`15m`; `422` when exceeded).
   - Clean bars (drop non-finite/null OHLC, drop `low > min(open, close)` or `high < max(open, close)`, drop bars outside `[fromMs, toMs)`).
   - Add an in-memory bounded LRU cache (`maxEntries = 64`, TTL `60_000` ms for recent windows, `10 * 60_000` ms for closed historical windows) + per-token upstream Yahoo rate limiter (`createRateLimiter({ limit: 15, windowMs: 60_000 })`) so cache misses exceeding 15/min return `429 rate_limited`!
   - Format each returned bar with `{ time: bar.time, iso: new Date(bar.time).toISOString(), ct: formatCt(bar.time), open, high, low, close, volume }` (where `ct` uses `Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hourCycle: "h23", hour: "2-digit", minute: "2-digit" })`, e.g. `"14:13"`), plus `timeframe`, `provider`, `reason?: "closed" | "future"`, and `coverage: { expected, present, gaps: [{ from, to, bars }] }`.

2. **Create `lib/agent/trade-check.ts` + `app/api/v1/checks/trade/route.ts` (`07` §3.3):**
   - **Read scope (`scope: "read"`)** despite being `POST` — writes **nothing** to any repository!
   - Accepts either `{ id: "<stored-trade-id>" }` (loads via `commands.read("trades", id)`) or a draft trade body.
   - Validates draft structure (returning structured `stop_moves` / validation errors when invalid, or `422` for malformed JSON), loads the 1m candle window around `[entry - 10m, (exit ?? entry) + 10m]` via `loadAgentCandles` (with injected `MarketDataProvider` for tests!), and returns exact §3.3 payload:
     - `fills`: entry (and exit when closed) with `role`, `stated`, `price`, `match` (`"stated" | "shifted" | "outside" | "no-bars"`), and when `shifted`: `matched` (UTC ISO), `offset_min`, and `message` (`"7263.00 did not trade in the 14:14 CT bar. It traded at 14:13 CT. Ask the trader."`).
     - `stop_moves`: per-move `{ time, price, ok, message? }` checking `[entry, exit]` bounds and tick grid.
     - `findings`: from post-entry `observeTrade` (`code`, `bar_ct`, `price`).
     - `warnings`: from `checkTradeWrite` (`playbook_missing`, `setup_tag_missing`, `notes_restate_fields`, etc.).
     - `derived`: `{ risk_cents, risk_r, result_r, r_size_cents, r_size_source, stated_risk_r }`.

3. **Document `/candles` and `/checks/trade` in `lib/agent/openapi.ts`.**

## 5. Tests to Write (`lib/__tests__/agent-candles-and-check.test.ts`)

All tests MUST mock `MarketDataProvider` (zero live Yahoo HTTP calls):
1. `GET /api/v1/candles`:
   - Maps `MES` → `MES=F` (never `ES=F`), rejects `27h` on `1m` (`422`), cleans out-of-window & NaN bars, computes `ct` (`"14:13"` for `2026-11-23T20:13:00Z`) and `coverage.gaps`.
   - Weekend window returns `200` `{ bars: [], reason: "closed" }`; future window returns `200` `{ bars: [], reason: "future" }`.
   - LRU cache hit avoids calling provider a second time; upstream rate cap returns `429` after limit.
2. `POST /api/v1/checks/trade` (with `read`-only key — proves write scope is NOT required, and repository remains empty after call):
   - Trade C draft (`7263` at `14:14 CT`, printed at `14:13 CT`) → `fills[0].match === "shifted"`, `offset_min === -1`, `matched === "2026-11-23T20:13:00.000Z"`.
   - Trade A draft (`07:55 CT` entry `7137`, stop `7119.50`, `07:55` bar low `7083.75`, later bars `>= 7125`, `$300` account, `stated_risk_r: 0.25`) → `findings` has **zero** `stop_traded_through`, `derived` has `risk_cents: 8750`, `r_size_cents: 30000`, `stated_risk_r: 0.25`.
   - Stop move outside hold → `stop_moves[0].ok === false`; missing `playbook_id` → `warnings` includes `playbook_missing`.

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
   git push origin origin/main:refs/heads/claim/API-3
   ```
2. Write `notes/handoffs/2026-11-24-API-3.md` with changed files, exported signatures, and real command outputs.
3. Commit, push, and open PR:
   ```bash
   git add lib/agent/candles.ts lib/agent/trade-check.ts app/api/v1/candles/route.ts app/api/v1/checks/trade/route.ts lib/agent/openapi.ts lib/__tests__/agent-candles-and-check.test.ts lib/__tests__/agent-openapi.test.ts notes/handoffs/2026-11-24-API-3.md
   git commit -m "feat(API-3): /api/v1/candles and /api/v1/checks/trade endpoints"
   git push -u origin swarm/API-3
   gh pr create --base main --title "[API-3] Agent API candles and trade check endpoints" --body-file notes/handoffs/2026-11-24-API-3.md
   ```

## 8. What NOT to Do & Out-of-Scope Rule

- Do **NOT** import `yahoo-finance2` directly in route files (Invariant 6: always go through `MarketDataProvider`).
- Do **NOT** write candles to Supabase in `/api/v1/candles`.
- **STOP and leave a note** in the handoff if any out-of-scope file seems needed.

HARD RULES:
- Supabase: only `mogmine_`-prefixed objects. If a package truly needs a schema change, write the SQL migration file under `supabase/migrations/` in the PR, but DO NOT apply it yourself: NEVER run `supabase db push`, NEVER run `supabase migration repair`, never use psql against the project. Note "MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP)" at the top of the handoff and PR body; code must degrade gracefully (local mode) until it is applied. Never touch `showmob_` tables, auth site_url or disable_signup settings.
- No data dumps (no exporting tables/journals/backups, no printcode full dumps committed).
- Never print, log, commit or echo secrets (.env*, tokens, keys). Do not cat env files.
- Never modify, delete or re-create Chris's real trade records or accounts (no calls to the live /api/v1 with real tokens, no Supabase writes). Use fixtures and unit tests.
- Stay inside this package's scope and its listed writable files. Out-of-scope need = stop and write it in the handoff.
- Never edit BOARD.md, NOTES.md, DECISIONS.md. Never merge PRs, never push to main, never force-push other branches, never touch other worktrees.
