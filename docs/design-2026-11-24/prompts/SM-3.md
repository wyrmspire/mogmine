# Package Prompt: `SM-3` — Timed Stop Moves: Validation and Stop Facts

- **Agent / Lane:** `swarm-2` (`L2 Trade truth`) · **Wave:** `5` · **Branch:** `swarm/SM-3`
- **Depends on:** `SM-2` (W3), `RS-1` (W1), `RS-3b` (W4), `UX-B` (W4)

## 1. Goal

Enforce timed `stop_moves` invariants in `lib/commands/journal-commands.ts` (move times inside `[entry_time, exit_time]`, last move equals `stop_loss_price`, stable same-minute ordering, and defaulting missing `initial_stop_set_at` to `entry_time` per `02-ux.md` §2.6), and compute + display `widestRisk`, `lockedR` (`lib/stop-facts.ts`, `components/StopFacts.tsx` mounted in `TradeDetail.tsx`), and exit-vs-working-stop slippage notes (`lib/data-notes.ts`).

## 2. Read First (Required Context)

1. `AGENTS.md` (Guardrail 4 integer ticks/cents, §6.12 `TradeDetail.tsx` `<= 10` net lines)
2. `docs/design-2026-11-24/05-stops-mae-fills.md` (§3.1 validation table, §3.2 what stop moves feed table)
3. `docs/design-2026-11-24/02-ux.md` (§2.6 Initial stop time for API trades `UX-19`)
4. `docs/design-2026-11-24/90-work-packages.md` (`SM-3`)
5. `docs/design-2026-11-24/92-decisions-made-by-swarm.md` (`D-A`: `widestRisk` and `lockedR` expressed in account R!)

## 3. Writable Files (Strict Scope — Everything Else Read-Only)

- `lib/commands/journal-commands.ts` *(existing)*
- `lib/stop-facts.ts` *(new)*
- `lib/data-notes.ts` *(existing)*
- `components/StopFacts.tsx` *(new)*
- `components/TradeDetail.tsx` *(existing, **grandfathered** — `<= 10` net lines; state before/after line counts)*
- `lib/__tests__/stop-facts.test.ts` *(new)*
- `lib/__tests__/journal-commands.test.ts` *(existing)*

## 4. Step-by-Step Implementation Plan

1. **Update `lib/commands/journal-commands.ts` (`05` §3.1 & `02` §2.6):**
   - **`UX-19` default initial stop time:** in `parseTrade`, if `raw.initial_stop_price != null && raw.initial_stop_set_at == null`, default `initial_stop_set_at` to `trade.entry_time` BEFORE the pair check (and record a metadata flag or let `API-2b`/callers detect it; combined with `SM-2`'s removal of `pickStopMoveTime`, defaulting `initial_stop_set_at` to `entry_time` never triggers false SL touches!). Keep rejecting when `initial_stop_price == null && initial_stop_set_at != null`.
   - **Timed `stop_moves` validation (`05` §3.1):**
     1. Every `move.time` must satisfy `Date.parse(move.time) >= entryAt` and (when closed) `Date.parse(move.time) <= exitAt`; otherwise return `bad("A stop move must fall between entry and exit.")` (`422`).
     2. When `trade.stop_moves && trade.stop_moves.length > 0`, the last move's price (`trade.stop_moves.at(-1)!.price`) MUST equal `trade.stop_loss_price` (`toTicks` equal); otherwise return `bad(\`The working stop must equal the last stop move (\${lastPrice.toFixed(2)}).\`)` (`422`).
     3. Two moves at the exact same timestamp keep their input order (JS `Array.prototype.sort` in ES2019+ is guaranteed stable — verify with a test!).

2. **Create `lib/stop-facts.ts` (`05` §3.2):**
   ```ts
   import type { ResolvedRSize } from "./r-size.ts";
   import type { TradeRecord } from "./trades.ts";

   export interface ExitStopMismatch {
     exitPrice: number;
     workingStopPrice: number;
     diffTicks: number;
   }

   export function workingStopAtExit(trade: TradeRecord): number | null;
   export function widestRisk(trade: TradeRecord, rSize: ResolvedRSize | number): { cents: number; r: number } | null;
   export function lockedR(trade: TradeRecord, rSize: ResolvedRSize | number): { cents: number; r: number } | null;
   export function checkExitStopConsistency(trade: TradeRecord): ExitStopMismatch | null;
   ```
   - `widestRisk`: only when `hasWidenedStop(trade)` is `true` — find the maximum risk distance across `initial_stop_price` and all `stop_moves` (or `stop_loss_price`), compute integer `cents` (`maxRiskTicks * tickValueCents * quantity`), and return `{ cents, r: cents / rSizeCents }`. Otherwise return `null`.
   - `lockedR`: check the working stop at exit (`stop_moves?.at(-1)?.price ?? (stop_loss_price !== initial_stop_price ? stop_loss_price : stop_loss_price)`): when it sits strictly on the profit side of `entry_price` (`(workingStop - entry) * sign > 0`, or `>= 0` if breakeven `+0.00R`; per `05` §3.2 *"on the profit side of entry"* → `(workingStopTicks - entryTicks) * sign > 0`), compute locked profit `cents` and `r = cents / rSizeCents`. Otherwise `null`.
   - `checkExitStopConsistency`: when `trade.status === "closed"` and `(trade.exit_reason === "stop" || trade.exit_reason === "trail")` and `workingStop != null` and `Math.abs(exitTicks - workingStopTicks) > 2`, return `{ exitPrice: trade.exit_price!, workingStopPrice: workingStop, diffTicks: Math.abs(exitTicks - workingStopTicks) }`.

3. **Update `lib/data-notes.ts`, `components/StopFacts.tsx`, and `components/TradeDetail.tsx`:**
   - `lib/data-notes.ts`: accept optional `exitStopMismatch?: ExitStopMismatch | null` on `DataNoteInput`, emitting quiet note `"Exit 7255.00 is 5 ticks past the working stop 7260.00 (slippage?)"`.
   - `components/StopFacts.tsx`: render compact `tabular-nums` chips/lines when non-null:
     - Widened: `"Stop widened: largest risk 0.40R"` (Shield-safe: uses R only!).
     - Locked: `"Stop locked +0.12R"`.
   - Mount `<StopFacts trade={trade} rSize={rSize} />` and pass `exitStopMismatch={checkExitStopConsistency(trade)}` into `collectDataNotes` in `TradeDetail.tsx` (`<= 10` net lines).

## 5. Tests to Write (`lib/__tests__/stop-facts.test.ts` + `lib/__tests__/journal-commands.test.ts`)

Test every row of `05-stops-mae-fills.md` §3.1 and §3.2:
1. Move before `entry_time` → `422 invalid`; move after `exit_time` → `422 invalid`.
2. Off-tick move price → `422 invalid`.
3. `stop_moves: [{ price: 7260, time: ... }]` with `stop_loss_price: 7250` → `422 invalid` (`"The working stop must equal the last stop move (7260.00)."`).
4. Two moves at the exact same minute preserve input order.
5. `initial_stop_price: 7119.5` sent with `initial_stop_set_at` omitted → defaults `initial_stop_set_at` to `entry_time` and succeeds (`02` §2.6).
6. `widestRisk` on widened stop (`$120` max risk at `$300` R size → `0.40R`); `null` when never widened; `resultR` and `riskR` remain strictly on `initial_stop_price`!
7. `lockedR` when stop trailed into profit (`+$36` at `$300` R size → `+0.12R`); `null` when stop still on risk side or at entry.
8. `checkExitStopConsistency`: `exit_reason: "trail"`, working stop `7260.00`, exit `7258.75` (`5` ticks away) → emits quiet `"Exit 7258.75 is 5 ticks past the working stop 7260.00 (slippage?)"`; `2` ticks away → `null`.

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
   git push origin origin/main:refs/heads/claim/SM-3
   ```
2. Write `notes/handoffs/2026-11-24-SM-3.md` with changed files, `TradeDetail.tsx` before/after line counts, and real command outputs.
3. Commit, push, and open PR:
   ```bash
   git add lib/commands/journal-commands.ts lib/stop-facts.ts lib/data-notes.ts components/StopFacts.tsx components/TradeDetail.tsx lib/__tests__/stop-facts.test.ts lib/__tests__/journal-commands.test.ts notes/handoffs/2026-11-24-SM-3.md
   git commit -m "feat(SM-3): timed stop-move validation, widestRisk, lockedR, and slippage note"
   git push -u origin swarm/SM-3
   gh pr create --base main --title "[SM-3] Timed stop moves: validation and stop facts" --body-file notes/handoffs/2026-11-24-SM-3.md
   ```

## 8. What NOT to Do & Out-of-Scope Rule

- Do **NOT** change `riskR` or `resultR` to use moved stops (risk R is strictly on `initial_stop_price` per `R-10`).
- Do **NOT** edit `components/StopMovesEditor.tsx` (`FB-2` touches it in Wave 7).
- **STOP and leave a note** in the handoff if any out-of-scope file seems needed.

HARD RULES:
- Supabase: only `mogmine_`-prefixed objects. If a package truly needs a schema change, write the SQL migration file under `supabase/migrations/` in the PR, but DO NOT apply it yourself: NEVER run `supabase db push`, NEVER run `supabase migration repair`, never use psql against the project. Note "MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP)" at the top of the handoff and PR body; code must degrade gracefully (local mode) until it is applied. Never touch `showmob_` tables, auth site_url or disable_signup settings.
- No data dumps (no exporting tables/journals/backups, no printcode full dumps committed).
- Never print, log, commit or echo secrets (.env*, tokens, keys). Do not cat env files.
- Never modify, delete or re-create Chris's real trade records or accounts (no calls to the live /api/v1 with real tokens, no Supabase writes). Use fixtures and unit tests.
- Stay inside this package's scope and its listed writable files. Out-of-scope need = stop and write it in the handoff.
- Never edit BOARD.md, NOTES.md, DECISIONS.md. Never merge PRs, never push to main, never force-push other branches, never touch other worktrees.
