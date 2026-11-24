# Package Prompt: `RS-4` — Stated Risk at Entry and the R-Size Backfill Script

- **Agent / Lane:** `swarm-1` (`L1 Risk`) · **Wave:** `5` · **Branch:** `swarm/RS-4`
- **Depends on:** `RS-1` (W1), `RS-2` (W2), `RS-3b` (W4)

## 1. Goal

Add the optional stated-risk row (`0.25R · 0.5R · 1R · other`) to manual trade entry via a dedicated `components/RiskRow.tsx` mounted in `components/AddTradeSheet.tsx` (keeping `AddTradeSheet.tsx <= 450` lines) and `lib/entry-form.ts`. Also write the idempotent, dry-run-by-default CLI backfill script `scripts/r-size-backfill.mjs` tested exclusively against mocked repositories (**NEVER run against real accounts or Supabase**).

## 2. Read First (Required Context)

1. `AGENTS.md` (Guardrail 11 suggestions never overwrite user input, §4 `390×844` mobile & `>= 44px` tap targets, §6.12 keep `AddTradeSheet.tsx <= 450` lines)
2. `docs/design-2026-11-24/04-r-size.md` (§4 Entry and editing, §5 Recompute and migration, §6)
3. `docs/design-2026-11-24/90-work-packages.md` (`RS-4`)
4. `docs/design-2026-11-24/92-decisions-made-by-swarm.md` (`D-A`, `D-B`, `Q-13`)

## 3. Writable Files (Strict Scope — Everything Else Read-Only)

- `lib/entry-form.ts` *(existing, ~194 lines)*
- `components/RiskRow.tsx` *(new — keeps `AddTradeSheet.tsx` well under 450 lines!)*
- `components/AddTradeSheet.tsx` *(existing, ~426 lines — MUST stay `<= 450` lines)*
- `scripts/r-size-backfill.mjs` *(new — **DO NOT RUN against real data or Supabase!**)*
- `lib/__tests__/r-size-entry-and-backfill.test.ts` *(new)*

## 4. Step-by-Step Implementation Plan

1. **Extend `lib/entry-form.ts`:**
   - Add `statedRiskR?: string;` (empty string `""` when unstated, else text like `"0.25"`) to `EntryDraft`, `freshEntryDraft`, and `upgradeDraft`.
   - Export pure helper `suggestedStopFromRiskR(entryPrice: number, direction: TradeDirection, symbol: string, quantity: number, rSizeCents: number, riskRValue: number): number | null` (computes dollar risk = `(rSizeCents / 100) * riskRValue`, points = `usd / (quantity * spec.pointValueUsd)`, snapped to tick on the risk side; returns `null` if invalid or equals `entryPrice`).

2. **Create `components/RiskRow.tsx` and mount in `components/AddTradeSheet.tsx` (`04` §4):**
   - Chips: `0.25R`, `0.5R`, `1R`, `Other` (`minHeight: 44`).
   - Selecting a chip sets `draft.statedRiskR` (tapping the active preset clears it).
   - When `draft.stopPrice.trim() === ""` and a valid `entryPrice` is present, tapping a chip offers `"Use stop 7122.00 ($75)"` button (or fills empty stop only on explicit tap/offer per `04` §4: *"When the stop is empty, a chip also offers the matching stop price, as `RiskChips` does today"* — never silently overwriting a typed stop!).
   - When `stopPrice` IS typed, show the live comparison line (`tabular-nums`, Shield-aware): e.g. `"Stop 7119.50 → $87.50 (0.29R) · you said 0.25R"` (under Shield: `"Stop 7119.50 → 0.29R · you said 0.25R"`).
   - On form submit in `AddTradeSheet.tsx`: validate `statedRiskR` if non-empty (`isValidStatedRiskR`), pass `stated_risk_r` and frozen `r_size_cents: resolvedRSize.cents` into `normalizeTrade`.

3. **Create `scripts/r-size-backfill.mjs` (`04` §5 — pure logic exported for tests + CLI entrypoint):**
   - Export `proposeStatedRiskFromNotes(trade)` (regex-extracting patterns like `0.25R`, `.25 R`, `$75 = 0.25R` from `note`, `pre_trade_thesis`, `management_notes`, `post_exit_notes` as a **proposal column only**), `runBackfillDryRun(commands)`, and `runBackfillApply(commands, rows)` so unit tests import and test them directly against `createLocalAdapter` / memory repos!
   - CLI defaults strictly to `--dry-run` (requiring explicit `--apply <csv-path>` to write anything):
     - Skips `is_sample === true` trades.
     - Dry-run outputs CSV rows (`id,account_id,r_size_cents,r_size_source,risk_cents,old_risk_multiple,new_result_r,new_risk_r,current_stated_risk_r,proposed_stated_risk_r,notes_have_risk_text`) and performs **zero** writes.
     - `--apply <csv>` updates ONLY `r_size_cents`, `risk_cents` (computed by `normalizeTrade`, not sent as raw client override if `journal-commands` computes it, or matching `riskCents`), and confirmed `stated_risk_r`, passing `expectedUpdatedAt` via `repos.trades.put(owner, updated, { expectedUpdatedAt })` so concurrent edits fail with `conflict` instead of overwriting, and **never** edits `note` / `*_notes`! Second apply with unchanged CSV performs zero writes (idempotent).

## 5. Tests to Write (`lib/__tests__/r-size-entry-and-backfill.test.ts`)

1. `suggestedStopFromRiskR`: 1 MES LONG at `7137.00`, `$300` R size, `0.25R` → `$75` = `15.00 pts` → `7122.00`.
2. `upgradeDraft` preserves `statedRiskR` and defaults missing field to `""`.
3. `proposeStatedRiskFromNotes`: extracts `0.25` from `"Risked $75 = 0.25R on ORB"`, `.5` from `".5 R"`, returns `null` when notes have no R risk mention; flags `notes_have_risk_text: true`.
4. `runBackfillDryRun` on mocked repositories: makes **zero** `put` calls, skips `is_sample` trades, reports accurate `r_size_cents`, `risk_cents`, `new_result_r`, and `proposed_stated_risk_r`.
5. `runBackfillApply` on mocked repositories:
   - First run writes `r_size_cents`, `risk_cents`, and confirmed `stated_risk_r` with `expectedUpdatedAt`, leaving all note fields byte-for-byte identical!
   - Second run with same CSV makes **zero** `put` calls (idempotent).
   - Simulated concurrent edit (`updated_at` changed between dry-run and apply) returns `conflict` instead of clobbering.

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
   git push origin origin/main:refs/heads/claim/RS-4
   ```
2. Write `notes/handoffs/2026-11-24-RS-4.md` with changed files, line counts (`AddTradeSheet.tsx <= 450`), and real command outputs.
3. Commit, push, and open PR:
   ```bash
   git add lib/entry-form.ts components/RiskRow.tsx components/AddTradeSheet.tsx scripts/r-size-backfill.mjs lib/__tests__/r-size-entry-and-backfill.test.ts notes/handoffs/2026-11-24-RS-4.md
   git commit -m "feat(RS-4): stated risk row in AddTradeSheet and dry-run R-size backfill script"
   git push -u origin swarm/RS-4
   gh pr create --base main --title "[RS-4] Stated risk at entry and R-size backfill script" --body-file notes/handoffs/2026-11-24-RS-4.md
   ```

## 8. What NOT to Do & Out-of-Scope Rule

- **NEVER** execute `scripts/r-size-backfill.mjs` against real accounts, `/api/v1`, or Supabase! Test with mocked repositories only.
- Do **NOT** auto-edit or strip trader notes in the script.
- **STOP and leave a note** in the handoff if any out-of-scope file seems needed.

HARD RULES:
- Supabase: only `mogmine_`-prefixed objects. If a package truly needs a schema change, write the SQL migration file under `supabase/migrations/` in the PR, but DO NOT apply it yourself: NEVER run `supabase db push`, NEVER run `supabase migration repair`, never use psql against the project. Note "MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP)" at the top of the handoff and PR body; code must degrade gracefully (local mode) until it is applied. Never touch `showmob_` tables, auth site_url or disable_signup settings.
- No data dumps (no exporting tables/journals/backups, no printcode full dumps committed).
- Never print, log, commit or echo secrets (.env*, tokens, keys). Do not cat env files.
- Never modify, delete or re-create Chris's real trade records or accounts (no calls to the live /api/v1 with real tokens, no Supabase writes). Use fixtures and unit tests.
- Stay inside this package's scope and its listed writable files. Out-of-scope need = stop and write it in the handoff.
- Never edit BOARD.md, NOTES.md, DECISIONS.md. Never merge PRs, never push to main, never force-push other branches, never touch other worktrees.
