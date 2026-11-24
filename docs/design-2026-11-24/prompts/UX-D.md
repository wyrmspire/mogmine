# Package Prompt: `UX-D` — "No Setup" Chip and Commentary-Only Notes Placeholders

- **Agent / Lane:** `swarm-2` (`L2 Trade truth`) · **Wave:** `6` · **Branch:** `swarm/UX-D`
- **Depends on:** `DR-2` (W5), `RS-3b` (W4)

## 1. Goal

Make missing setups immediately visible and steer notes away from restating structured numbers (`02-ux.md` §2.4 `UX-14`, §2.5 `UX-18`): render a muted `"No setup picked"` / `"No setup"` indicator alongside playbook chips in `components/PitStop.tsx` and `components/ReviewScreen.tsx` when `trade.playbook_id === null`, and update all four note placeholders plus the muted guidance hint under the notes block in `PitStop.tsx`.

## 2. Read First (Required Context)

1. `AGENTS.md` (§4 `390×844` mobile, `>= 44px` tap targets, accessible labels)
2. `docs/design-2026-11-24/02-ux.md` (§2.4 No setup picked, §2.5 Notes fields say what they are for)
3. `docs/design-2026-11-24/90-work-packages.md` (`UX-D`)

## 3. Writable Files (Strict Scope — Everything Else Read-Only)

- `components/PitStop.tsx` *(existing — keep `<= 450` lines)*
- `components/ReviewScreen.tsx` *(existing — add muted `"No setup"` chip in queue card header when `trade.playbook_id == null`)*
- `lib/__tests__/ux-setup-and-notes.test.ts` *(new)*

## 4. Step-by-Step Implementation Plan

1. **Export pure constants & helpers in `components/PitStop.tsx` (so unit tests import and assert exact copy):**
   ```ts
   export const NOTE_PLACEHOLDERS = {
     pre_trade_thesis: "Why this trade? What did you see?",
     management_notes: "What did you decide during the trade, and why?",
     post_exit_notes: "What would you do differently?",
     note: "Anything else worth remembering",
   } as const;

   export const NOTES_COMMENTARY_HINT = "Prices, stop, risk and R are saved above. Notes are for your thinking.";
   export const NO_SETUP_PICKED_LABEL = "No setup picked";
   ```

2. **Update `components/PitStop.tsx` (`02` §2.4 & §2.5):**
   - When `trade.playbook_id === null`, render a non-blocking muted status pill/label `"No setup picked"` right at the start of the setup/playbook chip row (with the active playbooks directly tappable right beside it, `minHeight: 44`). Note: `"No Setup / Impulse"` (`playbook_id === "no-setup"`) IS a chosen playbook, whereas `playbook_id === null` means the trader/agent never picked one!
   - Apply the exact 4 placeholders from `NOTE_PLACEHOLDERS` to `pre_trade_thesis`, `management_notes`, `post_exit_notes`, and `note` textareas (with explicit `<label>` / `aria-label` on each).
   - Render `<p className="muted" ...>{NOTES_COMMENTARY_HINT}</p>` under the notes block (non-blocking — never reject or strip what the trader types in the UI).

3. **Update `components/ReviewScreen.tsx` (`02` §2.4):**
   - On unsealed Review queue cards, when `trade.playbook_id === null`, show a muted `"No setup"` chip (`className="tag-chip muted"`) in `.row-title` so missing setups stand out immediately.

## 5. Tests to Write (`lib/__tests__/ux-setup-and-notes.test.ts`)

1. Asserts `NOTE_PLACEHOLDERS` matches all four exact strings in `02-ux.md` §2.5 table (`pre_trade_thesis`, `management_notes`, `post_exit_notes`, `note`) and `NOTES_COMMENTARY_HINT` matches `"Prices, stop, risk and R are saved above. Notes are for your thinking."`.
2. Tests helper / predicate distinguishing `playbook_id: null` (`"No setup picked"` shown) from `playbook_id: "no-setup"` (`"No Setup / Impulse"` chosen — `"No setup picked"` hidden) and `playbook_id: "orb-reclaim"` (hidden).
3. Verifies accessible labels and `>= 44px` tap targets on playbook chips in `PitStop.tsx` (and `lib/__tests__/a11y-core-screens.test.ts` continues to pass).

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
   git push origin origin/main:refs/heads/claim/UX-D
   ```
2. Write `notes/handoffs/2026-11-24-UX-D.md` with changed files and real command outputs.
3. Commit, push, and open PR:
   ```bash
   git add components/PitStop.tsx components/ReviewScreen.tsx lib/__tests__/ux-setup-and-notes.test.ts notes/handoffs/2026-11-24-UX-D.md
   git commit -m "feat(UX-D): show No setup chip and commentary-focused note placeholders"
   git push -u origin swarm/UX-D
   gh pr create --base main --title "[UX-D] No setup chip and notes placeholders" --body-file notes/handoffs/2026-11-24-UX-D.md
   ```

## 8. What NOT to Do & Out-of-Scope Rule

- Do **NOT** block or reject text typed into UI notes fields (`02` §2.5: *"No validation in the app: the trader may write what they like"*).
- **STOP and leave a note** in the handoff if any out-of-scope file seems needed.

HARD RULES:
- Supabase: only `mogmine_`-prefixed objects. If a package truly needs a schema change, write the SQL migration file under `supabase/migrations/` in the PR, but DO NOT apply it yourself: NEVER run `supabase db push`, NEVER run `supabase migration repair`, never use psql against the project. Note "MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP)" at the top of the handoff and PR body; code must degrade gracefully (local mode) until it is applied. Never touch `showmob_` tables, auth site_url or disable_signup settings.
- No data dumps (no exporting tables/journals/backups, no printcode full dumps committed).
- Never print, log, commit or echo secrets (.env*, tokens, keys). Do not cat env files.
- Never modify, delete or re-create Chris's real trade records or accounts (no calls to the live /api/v1 with real tokens, no Supabase writes). Use fixtures and unit tests.
- Stay inside this package's scope and its listed writable files. Out-of-scope need = stop and write it in the handoff.
- Never edit BOARD.md, NOTES.md, DECISIONS.md. Never merge PRs, never push to main, never force-push other branches, never touch other worktrees.
