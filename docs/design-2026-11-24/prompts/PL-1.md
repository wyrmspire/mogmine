# Package Prompt: `PL-1` — Playbook Lab Pure Model

- **Agent / Lane:** `swarm-5` (`L5 Agent API`) · **Wave:** `3` · **Branch:** `swarm/PL-1`
- **Depends on:** `NAV-1` (W2 — reuses `applyFilters` / `filtersToQuery` from `lib/selectors.ts`)

## 1. Goal

Implement the pure, React-free Playbook Lab computation engine (`lib/playbook-lab.ts`) that aggregates playbooks, setup/execution tags, co-occurring tag counts, computed trade shape facts, unknown vocabulary tags, the playbook × setup-tag matrix, and setup/tag gaps, guaranteeing that every facet count matches the exact Feed filter result from `NAV-1`.

## 2. Read First (Required Context)

1. `AGENTS.md` (Guardrail `B-42` lists never load candles, `OD-38` open trades in `n` only, `OD-24` never use `trade_style` categories in UI)
2. `docs/design-2026-11-24/01-playbook-lab.md` (§1, §3, §4.1–§4.5, §6, §7, §9)
3. `docs/design-2026-11-24/90-work-packages.md` (`PL-1`)
4. `docs/design-2026-11-24/92-decisions-made-by-swarm.md` — **Chosen defaults locked for you:**
   - **Q-2:** Show playbooks and computed shape facts (direction split, exit reasons, hold length bands, stop-moved %, win/loss/scratch); do NOT add a `family` field to `Playbook`.
   - **D-A:** `labView` accepts optional `rOf?: (trade: TradeRecord) => number | null` defaulting to account `resultR(trade, resolveRSize(trade))` from `lib/r-size.ts`. Print `avgResultR` and `rulesFollowedRatio` rates only when `closedCount >= PLAYBOOK_CARD_MIN_TRADES` (`10`, imported from `lib/playbook-card.ts`).

## 3. Writable Files (Strict Scope — Everything Else Read-Only)

- `lib/playbook-lab.ts` *(new — keep `<= 450` lines)*
- `lib/__tests__/playbook-lab.test.ts` *(new)*

## 4. Step-by-Step Implementation Plan

1. **Create `lib/playbook-lab.ts` (pure, no React, no DOM, no candle imports):**
   ```ts
   import type { Playbook } from "./playbooks.ts";
   import type { TradeExitReason, TradeRecord } from "./trades.ts";

   export type TagKind = "setup" | "execution";
   export type HoldBand = "under_5m" | "5m_to_30m" | "30m_to_2h" | "over_2h";

   export interface TagInput {
     setup: readonly string[];
     execution: readonly string[];
   }

   export interface LabExampleRef {
     tradeId: string;
     reason: "latest" | "best_rules" | "latest_loss";
   }

   export interface ShapeFacts {
     longCount: number;
     shortCount: number;
     exitReasons: Record<TradeExitReason | "unknown", number>;
     holdBands: Record<HoldBand, number>;
     stopMovedCount: number;
     stopMovedShare: number | null; // null when closedCount < 10? Or raw count + ratio when closedCount > 0; gate win/avgR/rules rates at PLAYBOOK_CARD_MIN_TRADES (10)
     wins: number;
     losses: number;
     scratches: number;
   }

   export interface PlaybookFacet {
     playbookId: string;
     name: string;
     archived: boolean;
     rules: readonly { id: string; label: string }[];
     n: number;                      // includes open trades
     closedCount: number;
     openCount: number;
     lastUsedAt: string | null;      // latest entry_time ISO
     setupTags: { tag: string; n: number; feedHref: string }[];
     executionTags: { tag: string; n: number; feedHref: string }[];
     shape: ShapeFacts;
     rulesFollowedRatio: number | null; // null unless gradedCount >= PLAYBOOK_CARD_MIN_TRADES (10) or closedCount >= 10 per 01 §6
     gradedCount: number;
     avgResultR: number | null;      // null when closedWithR < PLAYBOOK_CARD_MIN_TRADES (10)
     examples: LabExampleRef[];      // up to 3 distinct trade ids: latest, best_rules, latest_loss
     feedHref: string;               // `/feed${filtersToQuery({ status: "all", playbook: playbookId })}`
   }

   export interface TagFacet {
     tag: string;
     kind: TagKind;
     n: number;
     closedCount: number;
     playbooks: { playbookId: string | null; name: string; n: number; feedHref: string }[];
     avgResultR: number | null;      // gated at >= 10
     rulesFollowedRatio: number | null; // gated at >= 10
     examples: LabExampleRef[];
     feedHref: string;
   }

   export interface LabView {
     counts: {
       playbooks: number;
       archived: number;
       setupTags: number;
       executionTags: number;
       trades: number;
       withPlaybook: number;
       withSetupTag: number;
     };
     playbooks: PlaybookFacet[];     // active first, then archived
     tags: TagFacet[];               // setup group first, then execution group
     unknownTags: { label: string; n: number; feedHref: string }[];
     matrix: { playbookId: string; tag: string; n: number; feedHref: string }[];
     gaps: {
       noPlaybook: string[];         // trade ids where playbook_id === null
       noPlaybookHref: string;       // `/feed?playbook=none`
       noSetupTag: string[];         // trade ids with a playbook (excluding NO_SETUP_ID? Or any withPlaybook lacking a setup tag — match `01` §4.5: "Trades with a playbook but no setup tag")
       noSetupTagHref: string;
       unusedPlaybooks: string[];    // active playbook ids with n === 0
       unusedTags: string[];         // setup + execution tags with n === 0
       impulseCount: number;
       impulseShare: number | null;  // trades with playbook_id === NO_SETUP_ID ÷ total trades (null when 0 trades)
       impulseHref: string;
     };
   }

   export function labView(
     playbooks: readonly Playbook[],
     tags: TagInput,
     trades: readonly TradeRecord[],
     opts: { includeSamples: boolean; now: number; rOf?: (trade: TradeRecord) => number | null },
   ): LabView;
   ```
   - Filter `trades` by `opts.includeSamples ? true : !trade.is_sample`.
   - Open trades (`isOpen(trade)`) increment `n` and `openCount` ONLY — never included in `avgResultR`, `wins`/`losses`/`scratches`, or `holdBands` (`OD-38`).
   - Use `isScratch(trade)` for scratches; non-scratch closed trades with `pnl > 0` are wins, `pnl < 0` losses.
   - `unknownTags`: any label in `trade.quick_tags` not in `tags.setup` or `tags.execution`, sorted by descending `n` then alphabetically.
   - Build every `feedHref` with `filtersToQuery` from `lib/selectors.ts` (`NAV-1`), and verify in tests that `applyFilters` returns the exact matching count!

## 5. Tests to Write (`lib/__tests__/playbook-lab.test.ts`)

1. Sample exclusion: `includeSamples: false` omits `is_sample: true` trades; `includeSamples: true` includes them.
2. Open-trade rule (`OD-38`): open trade increments `n` and `openCount` on its playbook and tags, but is excluded from `avgResultR`, `wins`/`losses`/`scratches`, and hold bands.
3. Minimum-sample gate (`PLAYBOOK_CARD_MIN_TRADES = 10`): `avgResultR` and `rulesFollowedRatio` are `null` at `n = 9` and computed accurately at `n = 10`.
4. Unknown tags: a trade carrying `"VWAP HoldPlaybookTypo"` appears in `unknownTags` with `n: 1` and disappears once removed.
5. Feed-link parity: for every `PlaybookFacet`, `TagFacet`, `unknownTags` item, `matrix` cell, and `gaps.noPlaybookHref` / `impulseHref`, parsing the generated `feedHref` with `parseFilters` and running `applyFilters(eligibleTrades, parsed)` returns **the exact same count `n`**!
6. Active playbooks sort before archived playbooks; examples return at most 3 distinct trade IDs (`latest`, `best_rules`, `latest_loss`) without touching candles.

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
   git push origin origin/main:refs/heads/claim/PL-1
   ```
2. Write `notes/handoffs/2026-11-24-PL-1.md` with exported types/functions and real command outputs.
3. Commit, push, and open PR:
   ```bash
   git add lib/playbook-lab.ts lib/__tests__/playbook-lab.test.ts notes/handoffs/2026-11-24-PL-1.md
   git commit -m "feat(PL-1): pure Playbook Lab facet, matrix, and gap model"
   git push -u origin swarm/PL-1
   gh pr create --base main --title "[PL-1] Playbook Lab pure model" --body-file notes/handoffs/2026-11-24-PL-1.md
   ```

## 8. What NOT to Do & Out-of-Scope Rule

- Do **NOT** import React or candle modules in `lib/playbook-lab.ts`.
- Do **NOT** create `/playbooks/lab` UI components yet (`PL-2a` and `PL-2b` do that in Waves 4 and 7).
- **STOP and leave a note** in the handoff if any out-of-scope file seems needed.

HARD RULES:
- Supabase: only `mogmine_`-prefixed objects. If a package truly needs a schema change, write the SQL migration file under `supabase/migrations/` in the PR, but DO NOT apply it yourself: NEVER run `supabase db push`, NEVER run `supabase migration repair`, never use psql against the project. Note "MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP)" at the top of the handoff and PR body; code must degrade gracefully (local mode) until it is applied. Never touch `showmob_` tables, auth site_url or disable_signup settings.
- No data dumps (no exporting tables/journals/backups, no printcode full dumps committed).
- Never print, log, commit or echo secrets (.env*, tokens, keys). Do not cat env files.
- Never modify, delete or re-create Chris's real trade records or accounts (no calls to the live /api/v1 with real tokens, no Supabase writes). Use fixtures and unit tests.
- Stay inside this package's scope and its listed writable files. Out-of-scope need = stop and write it in the handoff.
- Never edit BOARD.md, NOTES.md, DECISIONS.md. Never merge PRs, never push to main, never force-push other branches, never touch other worktrees.
