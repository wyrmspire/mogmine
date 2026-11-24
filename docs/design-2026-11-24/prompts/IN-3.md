# Package Prompt: `IN-3` — 200 EMA on Displayed Timeframe (Chart, HUD, Toggle, and Levels API)

- **Agent / Lane:** `swarm-3` (`L3 Chart look`) · **Wave:** `7` · **Branch:** `swarm/IN-3`
- **Depends on:** `IN-1` (W1), `IN-2` (W3), `LB-B2` (W6), `API-4` (W6)

## 1. Goal

Implement the reproducible 200 EMA (`03-indicators-and-levels.md` §6, `OD-18`, `D-G`): pure `lib/ema.ts` seeded by SMA(200) on closes of the displayed timeframe (`1m` → `1m` EMA, `5m` → `5m` EMA, etc.) with a `200 + 500 = 700`-bar warm-up, extra day-window loading for `5m` in `useTradeLevels.ts`, a `1px` `--ind-ema200` line series + crosshair HUD readout in `TradeChart.tsx`, a remembered `200 EMA` View toggle in `TradeDetail.tsx` (`prefs.ema200`, `<= 10` net lines), and point-in-time `ema200` output in `lib/agent/levels.ts`.

## 2. Read First (Required Context)

1. `AGENTS.md` (Invariant 5 CSS token `--ind-ema200` via `lib/theme.ts`, Guardrail 11 reproducible indicator code, §6.12 `TradeChart.tsx`, `TradeDetail.tsx`, `app/globals.css` line counts)
2. `docs/design-2026-11-24/03-indicators-and-levels.md` (§6 200 EMA table, §7)
3. `docs/design-2026-11-24/07-agent-api.md` (§3.4 `"The 200 EMA joins when IN-3 ships"`)
4. `docs/design-2026-11-24/90-work-packages.md` (`IN-3`)
5. `docs/design-2026-11-24/92-decisions-made-by-swarm.md` — **Chosen default locked for you (`D-G` / `OD-18`):**
   - Input: closes of the **displayed timeframe** (`1m` chart → `1m` EMA; `5m` chart → `5m` EMA; `15m` → `15m` EMA).
   - Formula: `alpha = 2 / (200 + 1)`, seeded with simple arithmetic mean of the first `200` closes.
   - Warm-up: draw points **only from index `700 - 1` (`699`, i.e. after `200 + 500 = 700` total bars)** so seed weight `< 0.7%`.
   - Gaps: compute bar-to-bar over existing bars; if the warm-up window misses `> 3%` of expected regular-session bars, set `approximate: true` (draw dashed line + `"≈"` in HUD and View menu). When `< 700` bars exist (or `1m` trade is `> 30` days old), return `points: []` with explicit `unavailableReason`.
   - Do **NOT** invent bands, weekly VWAP, or `"BE"`.

## 3. Writable Files (Strict Scope — Everything Else Read-Only)

- `lib/ema.ts` *(new)*
- `lib/session-indicators.ts` *(existing — re-export or integrate `ema200` cleanly if helpful)*
- `lib/chart-indicators.ts` *(existing)*
- `components/useTradeLevels.ts` *(existing — load prior sessions when `ema200` is enabled on `5m`/`15m` so `>= 700` bars of warm-up are available)*
- `components/TradeChart.tsx` *(existing, **grandfathered** — state before/after line counts)*
- `components/TradeDetail.tsx` *(existing, **grandfathered** — `<= 10` net lines for View toggle & status text; state before/after line counts)*
- `lib/agent/levels.ts` *(existing from `API-4` — include `ema200` at `as_of`)*
- `lib/theme.ts` *(existing — add `ema200: string` reading `--ind-ema200`)*
- `app/globals.css` *(existing, **grandfathered** — 1 token line `--ind-ema200` in `:root` and `[data-palette="blue-orange"]`; state before/after line counts)*
- `lib/__tests__/ema.test.ts` *(new)*

## 4. Step-by-Step Implementation Plan

1. **Add `--ind-ema200` token (`app/globals.css`, `lib/theme.ts`):**
   - Pick a calm, distinct cyan/sky-slate indicator hue that is neither gold (`#80`), VWAP pink (`#f472b6`), nor profit/risk (e.g. `--ind-ema200: #38bdf8;` in `:root` and `--ind-ema200: #a78bfa;` in `[data-palette="blue-orange"]` since blue means profit in `blue-orange`!). Read as `ema200` in `lib/theme.ts`.

2. **Create `lib/ema.ts` (pure, deterministic, versioned `calcVersion: "ema200-v1"`):**
   ```ts
   export const EMA_PERIOD = 200;
   export const EMA_WARMUP_EXTRA = 500;
   export const EMA_MIN_BARS = EMA_PERIOD + EMA_WARMUP_EXTRA; // 700

   export interface EmaPoint {
     time: number; // bar open time (chart display) or bar close time (API); document & convert cleanly!
     value: number;
   }

   export interface Ema200Result {
     calcVersion: "ema200-v1";
     timeframe: Timeframe;
     points: EmaPoint[];
     approximate: boolean;
     missingRatio: number;
     presentBars: number;
     unavailableReason: string | null;
   }

   export function computeEma200(bars: readonly Candle[], timeframe: Timeframe, symbol?: string): Ema200Result;
   ```
   - Deduplicate & sort `bars` by `time` ascending (aggregating from `1m` via `aggregateCandles` when `bars` are `1m` and `timeframe !== "1m"`, or taking native `5m` bars).
   - If `bars.length < 700`: return `{ ..., points: [], approximate: false, unavailableReason: \`Needs 700 \${timeframe} bars for warm-up (\${bars.length} available)\` }`.
   - Seed `ema = mean(bars[0..199].close)`, iterate `i = 200..bars.length - 1` with `ema = bars[i].close * (2 / 201) + ema * (199 / 201)`, and emit points starting at `i = 699` (`700th` bar)!
   - Measure expected regular-session bars across the warm-up span `[bars[0].time, bars[699].time + barMs]`; if `(expected - 700) / expected > 0.03`, set `approximate = true`.

3. **Load warm-up history in `components/useTradeLevels.ts` & wire chart/UI:**
   - When `ema200Enabled` is `true`:
     - On `1m`: prior session + today (`~1,380+` bars) already exceeds `700` bars! If trade is `> 30` days old and `1m` unavailable, report `"1m bars older than 30 days are unavailable from Yahoo"`.
     - On `5m` (and `15m`): fetch 2–3 prior regular trading session windows in `5m` (`loadDayCandles` / `/api/market-data` `5m`, Yahoo keeps 60 days) so `>= 700` `5m` bars (`~2.5` sessions) are available!
   - `TradeChart.tsx`: add `emaSeries` (`LineSeries`, `lineWidth: 1`, `lineStyle: emaApproximate ? LineStyle.Dashed : LineStyle.Solid`, `priceLineVisible: false`, `lastValueVisible: false`, `crosshairMarkerVisible: false`, `autoscaleInfoProvider: () => null` so a distant 200 EMA never squashes the trade!). Append `· 200 EMA ${emaApproximate ? "≈ " : ""}${formatPrice(emaAt.value, symbol)}` to the crosshair HUD readout when visible.
   - `TradeDetail.tsx` (`<= 10` net lines): add `200 EMA` toggle (`Off | On`, bound to `prefs.ema200` via `setPrefs`) in the View menu, showing `unavailableReason` or `"≈ gaps in warm-up"` inline when `prefs.ema200` is `true`.
   - `lib/agent/levels.ts`: include `ema200: { value, approximate, timeframe: "1m", calc_version: "ema200-v1", unavailable_reason }` at `as_of` (computed over the prior + current session 1m bars already loaded by `buildAgentLevels`!).

## 5. Tests to Write (`lib/__tests__/ema.test.ts`)

1. Constant price series (`7000.00` for `750` bars): returns `51` points (`indices 699..749`), all `7000.00`, `approximate: false`, `unavailableReason: null`.
2. Step function check: first 200 bars at `7000`, next 500 bars at `7100`: at bar `700` (`index 699`), residual weight of the `7000` seed is `(199/201)^500 ≈ 0.006738` (`value ≈ 7099.326`), proving the `< 0.7%` seed decay!
3. Short warm-up (`699` bars): returns `points: []` and clear `unavailableReason: "Needs 700 1m bars for warm-up (699 available)"`.
4. Warm-up gap `> 3%`: sets `approximate: true`; `<= 3%`: `approximate: false`.
5. Displayed-timeframe basis: `5m` `computeEma200` differs from `1m` `computeEma200` on trending data and matches `5m` closes.
6. `/api/v1/levels` response includes `ema200` cut strictly at `as_of`.

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
   git push origin origin/main:refs/heads/claim/IN-3
   ```
2. Write `notes/handoffs/2026-11-24-IN-3.md` with changed files, before/after line counts for `TradeChart.tsx`, `TradeDetail.tsx`, and `app/globals.css`, and real command outputs.
3. Commit, push, and open PR:
   ```bash
   git add lib/ema.ts lib/session-indicators.ts lib/chart-indicators.ts components/useTradeLevels.ts components/TradeChart.tsx components/TradeDetail.tsx lib/agent/levels.ts lib/theme.ts app/globals.css lib/__tests__/ema.test.ts notes/handoffs/2026-11-24-IN-3.md
   git commit -m "feat(IN-3): 200 EMA on displayed timeframe across chart, HUD, prefs, and /levels"
   git push -u origin swarm/IN-3
   gh pr create --base main --title "[IN-3] 200 EMA on displayed timeframe" --body-file notes/handoffs/2026-11-24-IN-3.md
   ```

## 8. What NOT to Do & Out-of-Scope Rule

- Do **NOT** let `emaSeries` affect chart price autoscale (`autoscaleInfoProvider: () => null`).
- Do **NOT** invent VWAP bands, weekly VWAP, or `"BE"`.
- **STOP and leave a note** in the handoff if any out-of-scope file seems needed.

HARD RULES:
- Supabase: only `mogmine_`-prefixed objects. If a package truly needs a schema change, write the SQL migration file under `supabase/migrations/` in the PR, but DO NOT apply it yourself: NEVER run `supabase db push`, NEVER run `supabase migration repair`, never use psql against the project. Note "MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP)" at the top of the handoff and PR body; code must degrade gracefully (local mode) until it is applied. Never touch `showmob_` tables, auth site_url or disable_signup settings.
- No data dumps (no exporting tables/journals/backups, no printcode full dumps committed).
- Never print, log, commit or echo secrets (.env*, tokens, keys). Do not cat env files.
- Never modify, delete or re-create Chris's real trade records or accounts (no calls to the live /api/v1 with real tokens, no Supabase writes). Use fixtures and unit tests.
- Stay inside this package's scope and its listed writable files. Out-of-scope need = stop and write it in the handoff.
- Never edit BOARD.md, NOTES.md, DECISIONS.md. Never merge PRs, never push to main, never force-push other branches, never touch other worktrees.
