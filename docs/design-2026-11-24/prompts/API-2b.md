# Package Prompt: `API-2b` — Agent API Write-Time Checks and Warnings

- **Agent / Lane:** `swarm-5` (`L5 Agent API`) · **Wave:** `4` · **Branch:** `swarm/API-2b`
- **Depends on:** `API-2a` (W2)

## 1. Goal

Add comprehensive write-time refusals (`422 invalid`) and non-blocking `warnings: [{ code, message }]` (`lib/agent/write-checks.ts`, wired into `lib/agent/dispatch.ts`) covering every row of `07-agent-api.md` §4 so an agent writing trades via the API immediately gets rejected if it invents a playbook/account/tag or future date, and gets actionable warnings when notes restate prices/R, setup is blank, stop moves lack times, or exit reason mismatches the working stop.

## 2. Read First (Required Context)

1. `AGENTS.md` (Guardrail 11)
2. `docs/design-2026-11-24/07-agent-api.md` (§4 full table, §6 last bullet)
3. `docs/design-2026-11-24/90-work-packages.md` (`API-2b`)
4. `docs/design-2026-11-24/92-decisions-made-by-swarm.md` — **Chosen defaults locked for you:**
   - **Q-9:** **Refuse unknown `quick_tags` with `422 invalid`**, listing all valid setup and execution tags in the error message (note: on `PATCH`, validate only the incoming `patch.quick_tags` if supplied so updating `note` on a legacy trade with an old tag is not blocked unless `quick_tags` itself is being written with an unknown tag!).
   - **Q-10 / Q-11:** **Refuse future-dated `entry_time` or `exit_time` (`> now + 5 * 60_000 ms`) with `422 invalid`**, and emit warning `price_out_of_range` when cached bars exist for the day and `entry_price` / `exit_price` is `> 1%` outside `[dayLow, dayHigh]`.

## 3. Writable Files (Strict Scope — Everything Else Read-Only)

- `lib/agent/write-checks.ts` *(new)*
- `lib/agent/dispatch.ts` *(existing)*
- `lib/agent/openapi.ts` *(existing)*
- `lib/__tests__/agent-write-checks.test.ts` *(new)*
- `lib/__tests__/agent-openapi.test.ts` *(existing)*

## 4. Step-by-Step Implementation Plan

1. **Create `lib/agent/write-checks.ts` (pure over passed vocab/data + `now`):**
   ```ts
   export interface AgentWriteWarning {
     code:
       | "playbook_missing"
       | "setup_tag_missing"
       | "notes_restate_fields"
       | "stop_moved_without_time"
       | "exit_reason_mismatch"
       | "stated_risk_differs"
       | "price_out_of_range"
       | "initial_stop_time_defaulted";
     message: string;
   }

   export type TradeWriteCheckResult =
     | { ok: true; warnings: AgentWriteWarning[] }
     | { ok: false; message: string };

   export interface WriteCheckContext {
     playbooks: readonly { id: string; name: string; archived: boolean }[];
     accounts: readonly { id: string; name: string; r_size_cents: number | null; archived: boolean }[];
     setupTags: readonly string[];
     executionTags: readonly string[];
     defaultRSizeCents: number;
     dayPriceRange?: { low: number; high: number } | null; // optional when cached bars exist
     nowMs?: number;
     isCreate: boolean;
     writtenFields: ReadonlySet<string>;
   }

   export function checkTradeWrite(candidate: TradeRecord, rawInput: Record<string, unknown>, ctx: WriteCheckContext): TradeWriteCheckResult;
   ```
   - **Refusals (`ok: false` → `422 invalid`):**
     1. `candidate.playbook_id != null` and not in `ctx.playbooks` (when `playbook_id` is in `writtenFields` or `isCreate`): list valid `id ("Name")` pairs!
     2. `candidate.account_id != null` and not in `ctx.accounts` (when `account_id` is in `writtenFields` or `isCreate`): list valid account ids/names!
     3. `writtenFields.has("quick_tags")` (or `isCreate` with non-empty `quick_tags`) and any tag not in `ctx.setupTags` ∪ `ctx.executionTags`: refuse listing valid setup and execution tags (`Q-9`).
     4. `entry_time` or `exit_time` `> (ctx.nowMs ?? Date.now()) + 5 * 60_000` (`Q-10`, `Q-11`): refuse with clear message.
     *(Note: `risk_cents` mismatch is already `422` in `journal-commands.ts` from `RS-1`; keep a guard or test confirming `422`!)*
   - **Non-blocking warnings (`ok: true, warnings`):**
     1. `playbook_missing`: `isCreate && candidate.playbook_id == null`.
     2. `setup_tag_missing`: `candidate.quick_tags` contains zero tags from `ctx.setupTags`.
     3. `notes_restate_fields` (`HR-1`): any of `note`, `pre_trade_thesis`, `management_notes`, `post_exit_notes` contains an exact formatted/numeric match for `entry_price`, `stop_loss_price`, `initial_stop_price`, `planned_target_price`, `exit_price`, or an R/dollar-risk pattern (`/\b\d*\.?\d+\s*R\b/i` or `/\$\d+(\.\d{1,2})?\b/`).
     4. `stop_moved_without_time` (`HR-4`): `candidate.initial_stop_price != null && candidate.stop_loss_price != null && candidate.stop_loss_price !== candidate.initial_stop_price && (!candidate.stop_moves || candidate.stop_moves.length === 0)`.
     5. `exit_reason_mismatch` (`HR-5`): `candidate.status === "closed" && (candidate.exit_reason === "stop" || candidate.exit_reason === "trail")` and working stop (`stop_moves?.at(-1)?.price ?? stop_loss_price`) differs from `exit_price` by `> 2` ticks (`spec.tickSize * 2`).
     6. `stated_risk_differs` (`HR-7`): `riskComparison(candidate, resolvedRSize).differs === true`.
     7. `price_out_of_range` (`Q-10`): `ctx.dayPriceRange != null` and `entry_price` (or `exit_price`) is `< low * 0.99` or `> high * 1.01`.

2. **Wire into `lib/agent/dispatch.ts` and document in `lib/agent/openapi.ts`:**
   - On `create` and `update` for `type === "trades"`: load owner's playbooks, accounts, and prefs via `commands`, run `checkTradeWrite` (on `create`, validate after `parse` / before `commands.create` or merge candidate on `update` before `commands.update` so `422` aborts before any write!), and attach `warnings` (`{ ok: true, data: stored, ...(warnings.length ? { warnings } : { warnings: [] }) }` — include `warnings` on trade write responses and document in `Ok` schema in `openapi.ts`).

## 5. Tests to Write (`lib/__tests__/agent-write-checks.test.ts`)

Write one dedicated test case for **every single row** of `07-agent-api.md` §4:
1. Unknown `playbook_id: "News Impulse"` → `422` listing `"orb-reclaim"`, `"onl-sweep-smt"`, `"vwap-trend-push"`, `"no-setup"`; nothing written.
2. Unknown `account_id` → `422`; nothing written.
3. Unknown `quick_tags: ["Invented Tag"]` → `422` listing `SETUP_TAGS` and `EXECUTION_TAGS` (`Q-9`).
4. Future `entry_time` (`now + 10 min`) → `422`; `now + 3 min` → `201` (`Q-10`, `Q-11`).
5. Mismatched `risk_cents` → `422`.
6. Warnings (`201` saved + `warnings` array): `playbook_missing`, `setup_tag_missing`, `notes_restate_fields` (testing `"7137"`, `"0.25R"`, `"$75"`), `stop_moved_without_time`, `exit_reason_mismatch` (`exit_reason: "stop"`, 5 ticks away from stop), `stated_risk_differs` (Trade A: `0.29R` actual vs `0.25R` stated), and `price_out_of_range` (`4866.25` vs `6935–7410`).

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
   git push origin origin/main:refs/heads/claim/API-2b
   ```
2. Write `notes/handoffs/2026-11-24-API-2b.md` with changed files, exported types/functions, and real command outputs.
3. Commit, push, and open PR:
   ```bash
   git add lib/agent/write-checks.ts lib/agent/dispatch.ts lib/agent/openapi.ts lib/__tests__/agent-write-checks.test.ts lib/__tests__/agent-openapi.test.ts notes/handoffs/2026-11-24-API-2b.md
   git commit -m "feat(API-2b): agent write-time refusals and warnings for trades"
   git push -u origin swarm/API-2b
   gh pr create --base main --title "[API-2b] Agent API write-time checks and warnings" --body-file notes/handoffs/2026-11-24-API-2b.md
   ```

## 8. What NOT to Do & Out-of-Scope Rule

- Do **NOT** fetch network Yahoo candles during trade `POST`/`PATCH` (only emit `price_out_of_range` if cached bars are already present).
- Do **NOT** block UI form note text (`HR-1` warning is for the Agent API only).
- **STOP and leave a note** in the handoff if any out-of-scope file seems needed.

HARD RULES:
- Supabase: only `mogmine_`-prefixed objects. If a package truly needs a schema change, write the SQL migration file under `supabase/migrations/` in the PR, but DO NOT apply it yourself: NEVER run `supabase db push`, NEVER run `supabase migration repair`, never use psql against the project. Note "MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP)" at the top of the handoff and PR body; code must degrade gracefully (local mode) until it is applied. Never touch `showmob_` tables, auth site_url or disable_signup settings.
- No data dumps (no exporting tables/journals/backups, no printcode full dumps committed).
- Never print, log, commit or echo secrets (.env*, tokens, keys). Do not cat env files.
- Never modify, delete or re-create Chris's real trade records or accounts (no calls to the live /api/v1 with real tokens, no Supabase writes). Use fixtures and unit tests.
- Stay inside this package's scope and its listed writable files. Out-of-scope need = stop and write it in the handoff.
- Never edit BOARD.md, NOTES.md, DECISIONS.md. Never merge PRs, never push to main, never force-push other branches, never touch other worktrees.
