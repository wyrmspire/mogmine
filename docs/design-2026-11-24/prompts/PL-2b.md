# Package Prompt: `PL-2b` — Playbook Lab UI: Map and Gaps

- **Agent / Lane:** `swarm-1` (`L1` slot) · **Wave:** `7` · **Branch:** `swarm/PL-2b`
- **Depends on:** `PL-2a` (W4)

## 1. Goal

Complete the Playbook Lab (`01-playbook-lab.md` §4.4–§4.5, §9) by building `<PlaybookLabMap />` (playbook × setup-tag count grid shaded strictly by count via `--gold-mid` token intensity, switching to a sorted pairs list when `> 8` setup tags exist, horizontally scrolling inside its own container with pinned first column and zero outer page overflow at `390×844`) and `<PlaybookLabGaps />` (no-playbook, no-setup-tag, unused playbooks/tags, and impulse share), mounted into `components/PlaybookLab.tsx`.

## 2. Read First (Required Context)

1. `AGENTS.md` (Invariant 5 CSS tokens — never hardcode gold hex and never encode P&L win/loss in gold per `#80`, §4 `390×844` zero horizontal page overflow, §6.12 keep all files `<= 450` lines)
2. `docs/design-2026-11-24/01-playbook-lab.md` (§4.4 Map, §4.5 Gaps, §9 Acceptance)
3. `docs/design-2026-11-24/90-work-packages.md` (`PL-2b`)

## 3. Writable Files (Strict Scope — Everything Else Read-Only)

- `components/PlaybookLabMap.tsx` *(new — `<= 450` lines)*
- `components/PlaybookLabGaps.tsx` *(new — `<= 450` lines)*
- `components/PlaybookLab.tsx` *(existing from `PL-2a` — mount `<PlaybookLabMap />` and `<PlaybookLabGaps />` in the `Map` and `Gaps` tabs; keep `<= 450` lines)*
- `app/lab.css` *(existing from `PL-2a`)*
- `lib/__tests__/playbook-lab-map-gaps.test.ts` *(new)*

## 4. Step-by-Step Implementation Plan

1. **Create `components/PlaybookLabMap.tsx` (`01` §4.4):**
   - Export pure helper `buildLabMapLayout(view: LabView): { mode: "grid" | "pairs"; maxCount: number; rows: ...; pairs: ... }`:
     - When `setupTags.length <= 8`: `mode = "grid"` (rows = active playbooks, plus archived with `n > 0`; columns = setup tags). Each cell displays `n` (`tabular-nums`, `—` for `0`), shaded with `color-mix(in srgb, var(--gold-mid) calc(${Math.round((n / maxCount) * 32)}% * var(--gold-intensity)), var(--bg-elevated))` (single hue count density only — **never** profit/loss color!), and links (`<Link href={cell.feedHref}>`, `minHeight: 44, minWidth: 44`) when `n > 0`.
     - When `setupTags.length > 8`: `mode = "pairs"` ("pairs, most used first" — sorted descending by `n`, linking to `cell.feedHref`).
   - Style `.lab-map-scroll` in `app/lab.css` with `overflow-x: auto; max-width: 100%; overscroll-behavior-x: contain;` and `position: sticky; left: 0; background: var(--bg-surface); z-index: 1;` on the first column so the outer `390×844` page **never** overflows horizontally (`document.documentElement.scrollWidth <= clientWidth`)!

2. **Create `components/PlaybookLabGaps.tsx` (`01` §4.5):**
   - Render all four gap rows with `tabular-nums` counts and direct `<Link>`s (`minHeight: 44`) into `/feed?...`:
     1. **Trades with no playbook:** `view.gaps.noPlaybook.length` → links to `view.gaps.noPlaybookHref` (`/feed?playbook=none`).
     2. **Trades with a playbook, no setup tag:** `view.gaps.noSetupTag.length` → links to `view.gaps.noSetupTagHref` (`/feed?tag=no-setup-tag`).
     3. **Never used:** lists `unusedPlaybooks` (linking to `/tune#playbooks`) and `unusedTags`.
     4. **"No Setup / Impulse" share:** `impulseCount` and formatted `impulseShare` % of trades → links to `view.gaps.impulseHref` (`/feed?playbook=no-setup`).
   - Empty/clean state when all gaps are zero: `"Every trade has a playbook and setup tag."`

3. **Mount both in `components/PlaybookLab.tsx`** when `activeTab === "map"` and `activeTab === "gaps"`.

## 5. Tests to Write (`lib/__tests__/playbook-lab-map-gaps.test.ts`)

1. `buildLabMapLayout`: uses `"grid"` mode for `<= 8` setup tags and switches automatically to `"pairs"` (sorted most-used first) when `9` setup tags are passed!
2. Verifies cell shade uses CSS `var(--gold-mid)` / `var(--gold-intensity)` tokens (zero hardcoded gold hex, zero P&L win/loss dependency).
3. Feed-count round-trip: every non-zero cell in `Map` and every count link in `Gaps` (`noPlaybookHref`, `noSetupTagHref`, `impulseHref`) parsed via `parseFilters` + `applyFilters` returns the **exact** count displayed!

## 6. Verification Commands

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run check:file-length
```
Also verify `/playbooks/lab?tab=map` and `/playbooks/lab?tab=gaps` at `390×844` (confirm `scrollWidth <= clientWidth` while `.lab-map-scroll` scrolls internally).

## 7. Claim, Handoff & PR Steps

1. Claim atomically:
   ```bash
   git fetch origin
   git push origin origin/main:refs/heads/claim/PL-2b
   ```
2. Write `notes/handoffs/2026-11-24-PL-2b.md` with changed files, line counts (`<= 450` each), and real command outputs.
3. Commit, push, and open PR:
   ```bash
   git add components/PlaybookLabMap.tsx components/PlaybookLabGaps.tsx components/PlaybookLab.tsx app/lab.css lib/__tests__/playbook-lab-map-gaps.test.ts notes/handoffs/2026-11-24-PL-2b.md
   git commit -m "feat(PL-2b): Playbook Lab Map grid/pairs view and Gaps view"
   git push -u origin swarm/PL-2b
   gh pr create --base main --title "[PL-2b] Playbook Lab Map and Gaps views" --body-file notes/handoffs/2026-11-24-PL-2b.md
   ```

## 8. What NOT to Do & Out-of-Scope Rule

- Do **NOT** hardcode `#d4af37` or color cells by win rate / P&L.
- Do **NOT** edit `app/globals.css` (all styles belong in `app/lab.css`).
- **STOP and leave a note** in the handoff if any out-of-scope file seems needed.

HARD RULES:
- Supabase: only `mogmine_`-prefixed objects. If a package truly needs a schema change, write the SQL migration file under `supabase/migrations/` in the PR, but DO NOT apply it yourself: NEVER run `supabase db push`, NEVER run `supabase migration repair`, never use psql against the project. Note "MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP)" at the top of the handoff and PR body; code must degrade gracefully (local mode) until it is applied. Never touch `showmob_` tables, auth site_url or disable_signup settings.
- No data dumps (no exporting tables/journals/backups, no printcode full dumps committed).
- Never print, log, commit or echo secrets (.env*, tokens, keys). Do not cat env files.
- Never modify, delete or re-create Chris's real trade records or accounts (no calls to the live /api/v1 with real tokens, no Supabase writes). Use fixtures and unit tests.
- Stay inside this package's scope and its listed writable files. Out-of-scope need = stop and write it in the handoff.
- Never edit BOARD.md, NOTES.md, DECISIONS.md. Never merge PRs, never push to main, never force-push other branches, never touch other worktrees.
