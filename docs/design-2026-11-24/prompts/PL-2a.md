# Package Prompt: `PL-2a` — Playbook Lab UI: Home, Playbooks, and Tags

- **Agent / Lane:** `swarm-4` (`L4` slot) · **Wave:** `4` · **Branch:** `swarm/PL-2a`
- **Depends on:** `PL-1` (W3), `NAV-1` (W2), `DR-1a` (W1)

## 1. Goal

Build the `/playbooks/lab` page (`app/playbooks/lab/page.tsx`, `components/PlaybookLab.tsx`, `app/lab.css`) with the shared `Binder | Lab` header on `/playbooks` (`components/PlaybookBinder.tsx`), Tune's `"Playbooks & Lab"` link (`components/TuneScreen.tsx`), and full mobile-first (`390×844`) views for Lab Home, Playbooks (list + `?playbook=` detail view with sparkline examples), and Tags (Setup, Execution, and `"Not in your vocabulary"`).

## 2. Read First (Required Context)

1. `AGENTS.md` (Invariant 5 no hardcoded gold hex, Guardrail `B-42` sparklines only in lists, §4 `390×844` mobile & `tabular-nums`, §6.12 file-length rule: keep every new file `<= 450` lines and report `TuneScreen.tsx` line count)
2. `docs/design-2026-11-24/01-playbook-lab.md` (§2, §4.1–§4.3, §9)
3. `docs/design-2026-11-24/90-work-packages.md` (`PL-2a`)
4. `docs/design-2026-11-24/92-decisions-made-by-swarm.md` (`Q-1`: no 5th dock item; `Binder | Lab` tabs + `"Playbooks & Lab"` link in Tune; `Q-2`: playbooks + shape facts)

## 3. Writable Files (Strict Scope — Everything Else Read-Only)

- `app/playbooks/lab/page.tsx` *(new)*
- `components/PlaybookLab.tsx` *(new — keep `<= 450` lines!)*
- `components/PlaybookBinder.tsx` *(existing, ~83 lines — add `Binder | Lab` two-tab header only)*
- `components/TuneScreen.tsx` *(existing, **~476 lines — grandfathered**: 1-line link text change `"Open the binder"` → `"Playbooks & Lab"`; state before/after line counts)*
- `app/lab.css` *(new)*
- `app/layout.tsx` *(existing, ~45 lines — add `import "./lab.css";`)*
- `lib/__tests__/playbook-lab-ui.test.ts` *(new)*

## 4. Step-by-Step Implementation Plan

1. **Create `app/lab.css` and import once in `app/layout.tsx`:**
   - Style the `Binder | Lab` tab bar, sticky `[ Playbooks ] [ Tags ] [ Map ] [ Gaps ]` segmented switch (`min-height: 44px`), facet cards, horizontal tag-count bars (using `var(--gold-mid)` / `var(--border-strong)` tokens — never hardcoded gold hex, and never encoding win/loss in gold per `#80`!), and `390×844` responsive grid with `overflow-x: clip`.

2. **Update `components/PlaybookBinder.tsx` and `components/TuneScreen.tsx`:**
   - `PlaybookBinder.tsx`: add a clean `Binder | Lab` navigation bar (`<Link href="/playbooks" aria-current="page">Binder</Link>` / `<Link href="/playbooks/lab">Lab</Link>`, `minHeight: 44`).
   - `TuneScreen.tsx` (line ~406): change `<Link href="/playbooks">Open the binder</Link>` to `<Link href="/playbooks/lab">Playbooks &amp; Lab</Link>`.

3. **Create `components/PlaybookLab.tsx` + `app/playbooks/lab/page.tsx`:**
   - Read `useJournal()`, `usePlaybooks()`, `usePrefs()`, `useAccounts()`, and `useSearchParams()` (`?tab=playbooks|tags|map|gaps`, `?playbook=<id>`).
   - Compute `view = labView(playbooks.playbooks, { setup: SETUP_TAGS, execution: EXECUTION_TAGS }, journal.trades, { includeSamples, now, rOf: (t) => resultR(t, resolveRSize(t, accounts.accounts, prefs)) })`.
   - **Lab Home header (`01` §4.1):**
     - `Binder | Lab` tabs + `"Your vocabulary"` heading + `include samples` switch (`role="switch"`, `minHeight: 44`, defaulting `false` per `01` §9: *"Samples excluded by default; the toggle includes them, labelled"*).
     - Summary counts line (`tabular-nums`): `"4 playbooks (1 archived) · 5 setup tags · 5 execution tags"` and `"31 trades · 26 with a playbook · 19 with a setup tag"`.
     - Sticky segmented tabs: `Playbooks`, `Tags`, `Map`, `Gaps` (for `Map` and `Gaps` in Wave 4, render clean placeholder/summary panels ready for `PL-2b` to mount `<PlaybookLabMap />` and `<PlaybookLabGaps />` in Wave 7!).
   - **Playbooks tab (`01` §4.2):**
     - Active playbooks first, archived playbooks under an expandable `<details>` fold.
     - Each row shows `n` trades, last used session date, top co-occurring setup & execution tags, exit-reason counts, and rules % + avg R (or `"n X · need 10 closed for rates"` when `< 10`).
     - Tapping a playbook (`?playbook=<id>`) opens the **playbook detail view**: rules (read-only), co-occurring tags with horizontal count bars, shape facts (Long/Short split, exit reasons, hold bands, stop moved %, Win/Loss/Scratch), up to 3 example trades rendered with `<Sparkline />` (never mounting `TradeChart`), and 3 action links: `"Open card"` (`/playbooks`), `"Edit"` (`/tune#playbooks`), `"All N trades"` (`facet.feedHref`).
   - **Tags tab (`01` §4.3):**
     - `Setup` group and `Execution` group, each showing `n`, co-occurring playbooks with counts, avg R & rules % (gated at `>= 10`), up to 3 sparkline example links, and link to `facet.feedHref`.
     - **Not in your vocabulary** section (shown when `view.unknownTags.length > 0`): each unknown tag label with count and link to `feedHref`.
   - **All states (`01` §9, `docs/08` §4):** loading skeleton, zero trades (`"Log a trade and tag it to see your map"`), zero tags used, Shield mode on (counts and R visible, zero `$` amounts), archived playbook with trades.

## 5. Tests to Write (`lib/__tests__/playbook-lab-ui.test.ts`)

Write pure/view-helper tests verifying:
1. Default `includeSamples` state on Lab is `false` (excluding samples by default per `01` §9), and toggling it on labels sample inclusion.
2. Formatting helpers for rate gating (`< 10` shows `"not enough for rates yet"`, `>= 10` formats tabular `%` and `R`), Shield safety (zero `$` signs), unknown-tag visibility, and archived fold count.
3. Route accessibility check (following `lib/__tests__/a11y-routes.test.ts` pattern): buttons/tabs have accessible names, `aria-pressed`/`aria-current`, and `minHeight: 44`.

## 6. Verification Commands

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run check:file-length
```
Also verify `/playbooks/lab` at `390×844` and `1280px` (zero horizontal page overflow, `>= 44px` tap targets).

## 7. Claim, Handoff & PR Steps

1. Claim atomically:
   ```bash
   git fetch origin
   git push origin origin/main:refs/heads/claim/PL-2a
   ```
2. Write `notes/handoffs/2026-11-24-PL-2a.md` with changed files, `PlaybookLab.tsx` line count (`<= 450`) and `TuneScreen.tsx` before/after line counts, and real command outputs.
3. Commit, push, and open PR:
   ```bash
   git add app/playbooks/lab/page.tsx components/PlaybookLab.tsx components/PlaybookBinder.tsx components/TuneScreen.tsx app/lab.css app/layout.tsx lib/__tests__/playbook-lab-ui.test.ts notes/handoffs/2026-11-24-PL-2a.md
   git commit -m "feat(PL-2a): Playbook Lab route, Binder|Lab header, Playbooks and Tags views"
   git push -u origin swarm/PL-2a
   gh pr create --base main --title "[PL-2a] Playbook Lab UI: Home, Playbooks, and Tags" --body-file notes/handoffs/2026-11-24-PL-2a.md
   ```

## 8. What NOT to Do & Out-of-Scope Rule

- Do **NOT** add a 5th item to `AppShell.tsx` bottom dock (`Q-1`).
- Do **NOT** mount live `TradeChart` instances in Playbook Lab lists (use `Sparkline` only, `B-42`).
- **STOP and leave a note** in the handoff if any out-of-scope file seems needed.

HARD RULES:
- Supabase: only `mogmine_`-prefixed objects. If a package truly needs a schema change, write the SQL migration file under `supabase/migrations/` in the PR, but DO NOT apply it yourself: NEVER run `supabase db push`, NEVER run `supabase migration repair`, never use psql against the project. Note "MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP)" at the top of the handoff and PR body; code must degrade gracefully (local mode) until it is applied. Never touch `showmob_` tables, auth site_url or disable_signup settings.
- No data dumps (no exporting tables/journals/backups, no printcode full dumps committed).
- Never print, log, commit or echo secrets (.env*, tokens, keys). Do not cat env files.
- Never modify, delete or re-create Chris's real trade records or accounts (no calls to the live /api/v1 with real tokens, no Supabase writes). Use fixtures and unit tests.
- Stay inside this package's scope and its listed writable files. Out-of-scope need = stop and write it in the handoff.
- Never edit BOARD.md, NOTES.md, DECISIONS.md. Never merge PRs, never push to main, never force-push other branches, never touch other worktrees.
