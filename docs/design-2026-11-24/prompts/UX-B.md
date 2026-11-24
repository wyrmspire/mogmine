# Package Prompt: `UX-B` — Challenges Per Account and Floor Label Fix

- **Agent / Lane:** `swarm-2` (`L2 Trade truth`) · **Wave:** `4` · **Branch:** `swarm/UX-B`
- **Depends on:** `DR-1b` (W3 — serialized on `lib/commands/journal-commands.ts`)

## 1. Goal

Scope challenges optionally to a single trading account (`account_id: string | null`, where `null` means all accounts so existing challenges stay unchanged) across `lib/challenges.ts`, `lib/challenge-sanitize.ts`, `lib/challenge-store.ts`, `lib/commands/journal-commands.ts`, and `ChallengeSetupSheet.tsx`, and fix the misleading Drawdown Defender floor label on `ChallengeCard.tsx` / `ChallengeDetail.tsx` (`02-ux.md` §2.1–§2.2).

## 2. Read First (Required Context)

1. `AGENTS.md` (§4 `390×844` mobile & `tabular-nums`, §6.12 file-length rule for `components/ChallengeDetail.tsx`)
2. `docs/design-2026-11-24/02-ux.md` (§2.1 Challenge floor label `UX-07`, §2.2 Challenges per account `UX-08`)
3. `docs/17-challenges.md` (golden test invariants)
4. `docs/design-2026-11-24/90-work-packages.md` (`UX-B`)

## 3. Writable Files (Strict Scope — Everything Else Read-Only)

- `lib/challenges.ts` *(existing)*
- `lib/challenge-sanitize.ts` *(existing)*
- `lib/challenge-store.ts` *(existing)*
- `components/ChallengeSetupSheet.tsx` *(existing)*
- `components/ChallengeCard.tsx` *(existing)*
- `components/ChallengeDetail.tsx` *(existing, **594 lines — grandfathered**: keep edits minimal and state before/after line counts)*
- `lib/commands/journal-commands.ts` *(existing — ensure `challenges` parser validates optional `account_id: string | null`)*
- `lib/__tests__/challenges.test.ts` *(existing)*
- `lib/__tests__/challenge-store.test.ts` *(existing)*

## 4. Step-by-Step Implementation Plan

1. **Update `lib/challenges.ts`, `lib/challenge-sanitize.ts`, and `lib/challenge-store.ts` (`02-ux.md` §2.2):**
   - Add `account_id: string | null;` to `ChallengeDefinition` (defaulting legacy records without `account_id` to `null` in `sanitizeChallenge`).
   - In `evaluateChallenge(challenge, trades, now)`: when `challenge.account_id != null`, filter `trades` to `trade.account_id === challenge.account_id` BEFORE evaluating Drawdown Defender or Clean Run. Keep `account_id: null` evaluating across all real trades (exact existing behavior). Do NOT read the account's own loss-limit rules (`docs/17` keeps challenge limits independent).
   - Allow `startChallenge` / `createChallenge` in `lib/challenge-store.ts` to accept `account_id?: string | null`.
   - Add pure copy helper `formatChallengeRoomLabel(roomCents: number, limitCents: number, shield: boolean): string` in `lib/challenges.ts`:
     - Non-Shield: `"Room before the challenge limit: $50 (from your high point)"` (formatting `roomCents` via `formatMoney` / dollar formatting without sign ambiguity).
     - Shield: `"Room: 3% of the limit"` (`Math.max(0, Math.round((roomCents / limitCents) * 100))`%, zero `$` signs!).

2. **Update `lib/commands/journal-commands.ts`:**
   - Ensure `COLLECTION_PARSERS.challenges` rejects non-string/empty-string `account_id` (`account_id` must be `undefined`, `null`, or a non-empty `string`).

3. **Update `components/ChallengeSetupSheet.tsx`, `components/ChallengeCard.tsx`, and `components/ChallengeDetail.tsx`:**
   - `ChallengeSetupSheet.tsx`: render `<AccountSelect />` (defaulting to `defaultAccountId(accounts, trades)` and allowing `"All accounts"` = `null`; hidden when `activeAccounts.length === 0`).
   - `ChallengeCard.tsx` & `ChallengeDetail.tsx`: display the account name badge when `challenge.account_id != null` (e.g. `"SIM Eval 50K"`), and replace the ambiguous `~$50` floor text with `formatChallengeRoomLabel(...)` (`02-ux.md` §2.1).

## 5. Tests to Write (`lib/__tests__/challenges.test.ts` + `lib/__tests__/challenge-store.test.ts`)

1. All existing `docs/17` golden test cases pass unchanged with `account_id: null`.
2. Account-scoped Drawdown Defender & Clean Run (`account_id: "sim-acct-eval-50k"`): ignores losing/rule-breaking trades on `"sim-acct-sim-2"` and unassigned (`account_id: null`) QA trades, while scoring `"sim-acct-eval-50k"` trades accurately.
3. Sanitizer & command layer: legacy challenge JSON without `account_id` normalizes to `account_id: null`; non-string `account_id: 123` fails command-layer validation (`invalid`).
4. `formatChallengeRoomLabel(5000, 200000, false)` → `"Room before the challenge limit: $50 (from your high point)"`; with `shield = true` (`5000, 200000, true`) → `"Room: 3% of the limit"` (contains no `$`).

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
   git push origin origin/main:refs/heads/claim/UX-B
   ```
2. Write `notes/handoffs/2026-11-24-UX-B.md` with changed files, `ChallengeDetail.tsx` before/after line counts (`594` before), and real command outputs.
3. Commit, push, and open PR:
   ```bash
   git add lib/challenges.ts lib/challenge-sanitize.ts lib/challenge-store.ts components/ChallengeSetupSheet.tsx components/ChallengeCard.tsx components/ChallengeDetail.tsx lib/commands/journal-commands.ts lib/__tests__/challenges.test.ts lib/__tests__/challenge-store.test.ts notes/handoffs/2026-11-24-UX-B.md
   git commit -m "feat(UX-B): per-account challenges and clear drawdown room label"
   git push -u origin swarm/UX-B
   gh pr create --base main --title "[UX-B] Challenges per account and challenge room label" --body-file notes/handoffs/2026-11-24-UX-B.md
   ```

## 8. What NOT to Do & Out-of-Scope Rule

- Do **NOT** couple challenges to `TradingAccount.rules.max_loss_cents`.
- Do **NOT** create a SQL migration (`mogmine_challenges` stores `record jsonb`).
- **STOP and leave a note** in the handoff if any out-of-scope file seems needed.

HARD RULES:
- Supabase: only `mogmine_`-prefixed objects. If a package truly needs a schema change, write the SQL migration file under `supabase/migrations/` in the PR, but DO NOT apply it yourself: NEVER run `supabase db push`, NEVER run `supabase migration repair`, never use psql against the project. Note "MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP)" at the top of the handoff and PR body; code must degrade gracefully (local mode) until it is applied. Never touch `showmob_` tables, auth site_url or disable_signup settings.
- No data dumps (no exporting tables/journals/backups, no printcode full dumps committed).
- Never print, log, commit or echo secrets (.env*, tokens, keys). Do not cat env files.
- Never modify, delete or re-create Chris's real trade records or accounts (no calls to the live /api/v1 with real tokens, no Supabase writes). Use fixtures and unit tests.
- Stay inside this package's scope and its listed writable files. Out-of-scope need = stop and write it in the handoff.
- Never edit BOARD.md, NOTES.md, DECISIONS.md. Never merge PRs, never push to main, never force-push other branches, never touch other worktrees.
