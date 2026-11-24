# Package Prompt: `IN-1` — Remember Chart Choices (All New Prefs)

- **Agent / Lane:** `swarm-3` (`L3 Chart look`) · **Wave:** `1` · **Branch:** `swarm/IN-1`
- **Depends on:** None (Wave 1 baseline)

## 1. Goal

Add all four new persistent preference fields (`vwapAnchor`, `levelLabels`, `ema200`, `reviewCardOrientation`) to `lib/prefs-sanitize.ts` in one clean pass, and wire `TradeDetail.tsx`'s Session VWAP toggle (`Off | RTH | Globex`) to read and write `prefs.vwapAnchor` via `usePrefs()` / `setPrefs()` instead of resetting to `"off"` on every trade.

## 2. Read First (Required Context)

1. `AGENTS.md` (especially §6.12 file-length rule for `components/TradeDetail.tsx`)
2. `docs/design-2026-11-24/03-indicators-and-levels.md` (§3 `LB-5`, §4 `IN-1`, §6, §7)
3. `docs/design-2026-11-24/06-daily-review-and-review-cards.md` (§4 orientation pref)
4. `docs/design-2026-11-24/90-work-packages.md` (`IN-1`)
5. `docs/design-2026-11-24/92-decisions-made-by-swarm.md` — **Chosen defaults locked for you:**
   - **D-D:** `levelLabels` defaults to `"tap"`.
   - **D-G / OD-18:** `vwapAnchor` defaults to `"off"`; `ema200` defaults to `false`.
   - **Q-5:** `reviewCardOrientation` defaults to `"portrait"`.

## 3. Writable Files (Strict Scope — Everything Else Read-Only)

- `lib/prefs-sanitize.ts` *(existing, ~56 lines)*
- `components/TradeDetail.tsx` *(existing, **807 lines — over 450-line target, grandfathered**: `<= 10` net lines changed; state before/after line count in handoff)*
- `lib/__tests__/prefs-chart-choices.test.ts` *(new)*

*(Note: `lib/commands/journal-commands.ts` delegates `prefs` parsing directly to `sanitizePrefs(raw)` without enumerating fields, so do NOT edit `lib/commands/journal-commands.ts`. Also note `lib/prefs.ts` re-exports `Prefs` from `lib/prefs-sanitize.ts`; if callers need the new union types exported from `lib/prefs-sanitize.ts`, export them from `lib/prefs-sanitize.ts`.)*

## 4. Step-by-Step Implementation Plan

1. **Update `lib/prefs-sanitize.ts`:**
   - Export new types:
     ```ts
     export type VwapAnchorPref = "off" | "rth" | "globex";
     export type LevelLabelsMode = "tap" | "always";
     export type ReviewCardOrientation = "portrait" | "landscape";
     ```
   - Add fields to `Prefs`:
     ```ts
     vwapAnchor: VwapAnchorPref;
     levelLabels: LevelLabelsMode;
     ema200: boolean;
     reviewCardOrientation: ReviewCardOrientation;
     ```
   - Update `DEFAULT_PREFS`:
     ```ts
     vwapAnchor: "off",
     levelLabels: "tap",
     ema200: false,
     reviewCardOrientation: "portrait",
     ```
   - Update `sanitize(raw: Partial<Prefs>): Prefs`:
     - `vwapAnchor`: `"rth"` or `"globex"` kept, anything else → `"off"`.
     - `levelLabels`: `"always"` kept, anything else → `"tap"`.
     - `ema200`: `raw.ema200 === true`.
     - `reviewCardOrientation`: `"landscape"` kept, anything else → `"portrait"`.

2. **Update `components/TradeDetail.tsx` (`<= 10` net lines):**
   - Import `setPrefs` alongside `usePrefs` from `@/lib/prefs`.
   - Remove the local `const [vwapAnchor, setVwapAnchor] = useState<VwapAnchor | "off">("off");` state (around line 109).
   - Read `const vwapAnchor = prefs.vwapAnchor;` and update the View menu buttons' `onClick` to call `setPrefs({ vwapAnchor: value })`.
   - Ensure drill, review, and playbook charts remain unaffected (they do not read `prefs.vwapAnchor`).

## 5. Tests to Write (`lib/__tests__/prefs-chart-choices.test.ts`)

Write `node:test` tests covering:
1. `sanitizePrefs({})` and legacy stored prefs objects (missing the 4 new keys) populate exact defaults: `vwapAnchor: "off"`, `levelLabels: "tap"`, `ema200: false`, `reviewCardOrientation: "portrait"`.
2. Valid non-default values (`vwapAnchor: "rth" | "globex"`, `levelLabels: "always"`, `ema200: true`, `reviewCardOrientation: "landscape"`) round-trip through `sanitizePrefs`, `setPrefs`, localStorage hydration (`hydratePrefs`), and `createJournalCommands.writeSingleton("prefs", ...)`.
3. Invalid values (`vwapAnchor: "weekly"`, `levelLabels: "none"`, `ema200: "yes"`, `reviewCardOrientation: "square"`) sanitize cleanly back to defaults.
4. Existing `lib/__tests__/prefs-sync.test.ts` and `lib/__tests__/singleton-sync.test.ts` pass unchanged.

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
   git push origin origin/main:refs/heads/claim/IN-1
   ```
2. Write `notes/handoffs/2026-11-24-IN-1.md` including changed files, exported types, `components/TradeDetail.tsx` before/after line counts (`807` before), and real command outputs.
3. Commit, push, and open PR:
   ```bash
   git add lib/prefs-sanitize.ts components/TradeDetail.tsx lib/__tests__/prefs-chart-choices.test.ts notes/handoffs/2026-11-24-IN-1.md
   git commit -m "feat(IN-1): persist chart and review card choices in prefs; remember VWAP anchor"
   git push -u origin swarm/IN-1
   gh pr create --base main --title "[IN-1] Remember chart choices in prefs" --body-file notes/handoffs/2026-11-24-IN-1.md
   ```

## 8. What NOT to Do & Out-of-Scope Rule

- Do **NOT** edit `lib/commands/journal-commands.ts` (`RS-1` owns it in Wave 1).
- Do **NOT** build 200 EMA (`IN-3`) or level tap mode (`LB-B1`) here — only register and sanitize their preference keys.
- **STOP and leave a note** in the handoff if any file outside §3 appears needed.

HARD RULES:
- Supabase: only `mogmine_`-prefixed objects. If a package truly needs a schema change, write the SQL migration file under `supabase/migrations/` in the PR, but DO NOT apply it yourself: NEVER run `supabase db push`, NEVER run `supabase migration repair`, never use psql against the project. Note "MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP)" at the top of the handoff and PR body; code must degrade gracefully (local mode) until it is applied. Never touch `showmob_` tables, auth site_url or disable_signup settings.
- No data dumps (no exporting tables/journals/backups, no printcode full dumps committed).
- Never print, log, commit or echo secrets (.env*, tokens, keys). Do not cat env files.
- Never modify, delete or re-create Chris's real trade records or accounts (no calls to the live /api/v1 with real tokens, no Supabase writes). Use fixtures and unit tests.
- Stay inside this package's scope and its listed writable files. Out-of-scope need = stop and write it in the handoff.
- Never edit BOARD.md, NOTES.md, DECISIONS.md. Never merge PRs, never push to main, never force-push other branches, never touch other worktrees.
