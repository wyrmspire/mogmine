# Package Prompt: `API-4` — Agent API Point-in-Time Levels and VWAP Endpoint

- **Agent / Lane:** `swarm-5` (`L5 Agent API`) · **Wave:** `6` · **Branch:** `swarm/API-4`
- **Depends on:** `API-3` (W5), `IN-2` (W3)

## 1. Goal

Add read-scoped `GET /api/v1/levels?symbol=MES&session_date=YYYY-MM-DD&as_of=<ISO>` (`lib/agent/levels.ts` + `app/api/v1/levels/route.ts`) returning point-in-time computed session levels (`LV-1` + `withheldReasons`), active planned levels as of `as_of` (`planStateAsOf`), and both RTH and Globex Session VWAP values at `as_of` (using `IN-2`'s `"globex-tolerant"` gap policy and `approximate` flag), with full calculation provenance (`provider`, `timeframe`, `calc_version`) and strict `as_of` look-ahead prevention (`B-14`).

## 2. Read First (Required Context)

1. `AGENTS.md` (Invariant 3 `MES → MES=F`, Invariant 6 `MarketDataProvider` via `lib/agent/candles.ts`, Guardrail `B-14` zero look-ahead after `as_of`)
2. `docs/design-2026-11-24/07-agent-api.md` (§3.4 `GET /api/v1/levels`, §5, §6)
3. `docs/design-2026-11-24/90-work-packages.md` (`API-4`)
4. `docs/design-2026-11-24/92-decisions-made-by-swarm.md` — **Chosen defaults locked for you:**
   - **D-F:** Globex VWAP uses `gapPolicy: "globex-tolerant"` (`<= 3%` missing, longest gap `<= 15m`, `0` missing bars in RTH) and reports `approximate: true | false`.
   - **Q-8 (`OD-20`):** Levels and VWAP are computed point-in-time on read; do NOT store a `levels_at_entry` snapshot on trades.

## 3. Writable Files (Strict Scope — Everything Else Read-Only)

- `lib/agent/levels.ts` *(new)*
- `app/api/v1/levels/route.ts` *(new)*
- `lib/agent/openapi.ts` *(existing)*
- `lib/__tests__/agent-levels.test.ts` *(new)*
- `lib/__tests__/agent-openapi.test.ts` *(existing)*

## 4. Step-by-Step Implementation Plan

1. **Create `lib/agent/levels.ts` (pure over injected candle loader + `JournalCommands`):**
   ```ts
   export interface AgentLevelsQuery {
     symbol: string;        // MES or MNQ (validated via canonicalSymbol; 422 if unsupported by LV-1)
     sessionDate: string;   // YYYY-MM-DD
     asOfIso?: string;      // defaults to nowIso; never uses bars closing after asOfMs!
   }

   export async function buildAgentLevels(
     query: AgentLevelsQuery,
     commands: JournalCommands,
     loadCandles: (symbol: string, fromMs: number, toMs: number, tf: "1m") => Promise<{ bars: Candle[]; provider: string }>,
     nowMs?: number,
   ): Promise<PersistResult<AgentLevelsPayload>>;
   ```
   - **Point-in-time cutoff (`B-14`):** `asOfMs = query.asOfIso ? Date.parse(query.asOfIso) : (nowMs ?? Date.now())`. Filter every loaded bar strictly to `bar.time + 60_000 <= asOfMs` (only completed bars known by `asOfMs`!).
   - **Computed levels:** reuse `lib/levels.ts` / `lib/chart-levels.ts` (`tradeLevelWindows`, `computeSessionLevels` / `withheldReasons` from `lib/level-withheld.ts`) over the prior regular session and `[today.open, Math.min(today.close, asOfMs)]`. Return `computed: [{ key, label, value, formed_at, coverage }]` for available levels AND `withheld: [{ key, label, reason }]` for withheld levels (never omitting or inventing withheld values!).
   - **Planned levels as of `as_of`:** list owner's `plans` for `session_date === query.sessionDate` via `commands.listFiltered("plans", ..., { session_date: query.sessionDate })`, run `planStateAsOf(plan, asOfIso)` (from `lib/plans.ts`), and return active levels for matching `symbol` with `{ plan_id, plan_name, revision_id, label, price, price_low, price_high, role }`.
   - **Session VWAP at `as_of`:** run `computeSessionIndicators` (`lib/session-indicators.ts`) for `anchor: "rth"` (`gapPolicy: "complete"`) and `anchor: "globex"` (`gapPolicy: "globex-tolerant"`), returning `{ rth: { value, approximate: false, coverage, unavailable_reason }, globex: { value, approximate, coverage, unavailable_reason } }`.
   - **Provenance:** attach `{ provider, timeframe: "1m", levels_calc_version: "lv-1", indicators_calc_version: "session-indicators-v1", as_of: new Date(asOfMs).toISOString(), session_date: query.sessionDate }`.

2. **Create `app/api/v1/levels/route.ts` and update `lib/agent/openapi.ts`:**
   - Wrap with `handleAgentRequest` (`scope: "read"`), sharing `API-3`'s LRU candle loader and per-token upstream Yahoo rate limiter!
   - Document `GET /levels` parameters (`symbol`, `session_date`, `as_of`) and response in `lib/agent/openapi.ts`.

## 5. Tests to Write (`lib/__tests__/agent-levels.test.ts`)

1. **Strict `as_of` cutoff proof (`07` §6 & `90` `API-4` acceptance):**
   - Construct a session where a new RTH high (`7420.00`) prints in the `10:15–10:16 ET` bar (`open = 10:15 ET`, `close = 10:16 ET`):
   - Calling `buildAgentLevels` at `as_of = 10:15:30 ET` (1 bar / half-bar earlier, before `10:16 ET` close) does **NOT** include the `7420.00` high; moving `as_of` forward 1 bar to `10:16:00 ET` updates `rth_high` to `7420.00`!
2. **Withheld reasons:** missing overnight bars withhold `ONH`/`ONL`/`PDH`/`PDL` with explicit `withheld` entries while still returning Globex VWAP with `approximate: true` when within `IN-2`'s `<= 3%` / `<= 15m` tolerance!
3. **Planned levels `as_of`:** a plan revision saved at `09:45 ET` is excluded when `as_of = 09:35 ET` and included when `as_of = 09:50 ET`.
4. Rejects invalid `symbol`, invalid `session_date`, or malformed `as_of` with `422 invalid`.

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
   git push origin origin/main:refs/heads/claim/API-4
   ```
2. Write `notes/handoffs/2026-11-24-API-4.md` with changed files, exported signatures, and real command outputs.
3. Commit, push, and open PR:
   ```bash
   git add lib/agent/levels.ts app/api/v1/levels/route.ts lib/agent/openapi.ts lib/__tests__/agent-levels.test.ts lib/__tests__/agent-openapi.test.ts notes/handoffs/2026-11-24-API-4.md
   git commit -m "feat(API-4): point-in-time /api/v1/levels endpoint with withheld reasons and VWAP"
   git push -u origin swarm/API-4
   gh pr create --base main --title "[API-4] Agent API point-in-time levels and VWAP endpoint" --body-file notes/handoffs/2026-11-24-API-4.md
   ```

## 8. What NOT to Do & Out-of-Scope Rule

- Do **NOT** store level snapshots onto `TradeRecord` (`Q-8`).
- Do **NOT** make live Yahoo requests in unit tests.
- **STOP and leave a note** in the handoff if any out-of-scope file seems needed.

HARD RULES:
- Supabase: only `mogmine_`-prefixed objects. If a package truly needs a schema change, write the SQL migration file under `supabase/migrations/` in the PR, but DO NOT apply it yourself: NEVER run `supabase db push`, NEVER run `supabase migration repair`, never use psql against the project. Note "MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP)" at the top of the handoff and PR body; code must degrade gracefully (local mode) until it is applied. Never touch `showmob_` tables, auth site_url or disable_signup settings.
- No data dumps (no exporting tables/journals/backups, no printcode full dumps committed).
- Never print, log, commit or echo secrets (.env*, tokens, keys). Do not cat env files.
- Never modify, delete or re-create Chris's real trade records or accounts (no calls to the live /api/v1 with real tokens, no Supabase writes). Use fixtures and unit tests.
- Stay inside this package's scope and its listed writable files. Out-of-scope need = stop and write it in the handoff.
- Never edit BOARD.md, NOTES.md, DECISIONS.md. Never merge PRs, never push to main, never force-push other branches, never touch other worktrees.
