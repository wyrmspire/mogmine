# Package Prompt: `PL-3` — Tag Registry Singleton, Tune Editor, and Live Vocabulary Wiring

- **Agent / Lane:** `swarm-5` (`L5 Agent API`) · **Wave:** `7` · **Branch:** `swarm/PL-3`
- **Depends on:** `PL-1` (W3), `PL-2a` (W4), `API-2a` (W2), `API-2b` (W4), `DR-1b` (W3), `UX-C` (W6)
- **Migration:** `needs_migration: true` — **Put `"MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP)"` at the very top of your handoff and PR body! NEVER run `supabase db push` or apply it yourself.**

## 1. Goal

Turn setup and execution tags from static code constants into an editable, synced `tag_registry` singleton (`01-playbook-lab.md` §5, `Q-6`): create `lib/tag-registry.ts` + `lib/tag-registry-store.ts`, register `tag_registry` across persistence (`contract.ts`, `registry.ts`, `local-adapter.ts`, `supabase-adapter.ts`, `select.ts`, `journal-commands.ts`, `http.ts`) with an additive `mogmine_tag_registries` SQL migration, include it in backups, mount `<TagRegistryEditor />` on Tune, and wire `lib/playbooks.ts`, `/api/v1/vocabulary`, and `write-checks.ts` to read the live registry.

## 2. Read First (Required Context)

1. `AGENTS.md` (Guardrail §3b-2 RLS on every table, `D-012` `mogmine_` prefix only, §4 `390×844` & `>= 44px` tap targets, §6.12 keep new files `<= 450` lines and report `TuneScreen.tsx` before/after line counts)
2. `docs/design-2026-11-24/01-playbook-lab.md` (§5 Tag registry)
3. `docs/design-2026-11-24/90-work-packages.md` (`PL-3`)
4. `docs/design-2026-11-24/92-decisions-made-by-swarm.md` (`Q-6` build `tag_registry` now; `Q-9` API write-checks accept active tags from `tag_registry` and reject unknown strings with `422`)

## 3. Writable Files (Strict Scope — Everything Else Read-Only)

- `supabase/migrations/20261124120500_mogmine_tag_registries.sql` *(new — write file ONLY, NEVER apply!)*
- `lib/tag-registry.ts` *(new)*
- `lib/tag-registry-store.ts` *(new)*
- `components/TagRegistryEditor.tsx` *(new — keep `<= 450` lines)*
- `components/AppShell.tsx` *(existing — call `hydrateTagRegistry()` in `useLayoutEffect`)*
- `components/TuneScreen.tsx` *(existing, **grandfathered** — mount `<TagRegistryEditor />` + backup pass-through in `<= 6` net lines; state before/after line counts)*
- `lib/playbooks.ts` *(existing — add live getters `currentSetupTags()`, `currentExecutionTags()`, `currentTagRegistry()` updated by `tag-registry-store` just like `setPlaybookRegistry`!)*
- `lib/journal-backup.ts` *(existing — optional `tag_registry?: TagRegistry`)*
- `lib/persistence/contract.ts`, `lib/persistence/registry.ts`, `lib/persistence/local-adapter.ts`, `lib/persistence/supabase-adapter.ts`, `lib/persistence/select.ts` *(existing)*
- `lib/commands/journal-commands.ts` *(existing)*
- `lib/agent/http.ts`, `lib/agent/vocabulary.ts`, `lib/agent/write-checks.ts` *(existing)*
- `lib/__tests__/tag-registry.test.ts` *(new)*
- `lib/__tests__/agent-http.test.ts`, `lib/__tests__/fake-supabase.ts`, `lib/__tests__/journal-commands.test.ts`, `lib/__tests__/persistence-contract.test.ts`, `lib/__tests__/persistence-local-adapter.test.ts`, `lib/__tests__/persistence-supabase-adapter.test.ts` *(existing)*

## 4. Step-by-Step Implementation Plan

1. **Create `lib/tag-registry.ts` (pure model, seeds, and sanitizer):**
   ```ts
   export interface TagDef {
     id: string;              // e.g. "seed:setup:smt-divergence" or uuid
     label: string;           // max 40 chars, case-insensitive unique across active + retired
     description: string;     // max 160 chars
     retired: boolean;        // retired tags stay resolvable, never hard-deleted (like OD-54)
     aliases: string[];       // previous labels kept when renamed so old trade.quick_tags still resolve!
     playbook_ids: string[];  // playbooks where this tag belongs (empty = any)
   }

   export interface TagRegistry {
     setup: TagDef[];
     execution: TagDef[];
   }

   export const DEFAULT_TAG_REGISTRY: TagRegistry; // seeded from SETUP_TAGS and EXECUTION_TAGS
   export function sanitizeTagRegistry(raw: unknown): TagRegistry;
   export function activeSetupTagLabels(reg: TagRegistry): string[];
   export function activeExecutionTagLabels(reg: TagRegistry): string[];
   export function resolveTagLabel(reg: TagRegistry, rawLabel: string): { def: TagDef; kind: "setup" | "execution" } | null; // matches label OR aliases!
   ```
   - Protect `"Moved Stop"` (`MOVED_STOP_TAG`) so its label/alias always resolves for `VIOLATION_TAGS` / `suggestedQuickTags`.

2. **Write `supabase/migrations/20261124120500_mogmine_tag_registries.sql` (DO NOT APPLY):**
   - Mirror `mogmine_mood_registries` in `20261123004734_mogmine_journal_v1.sql` + `20261123004848_mogmine_journal_grants.sql`:
     - `create table public.mogmine_tag_registries (user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade, record jsonb not null check (jsonb_typeof(record) = 'object'), created_at timestamptz not null default now(), updated_at timestamptz not null default now());`
     - Enable RLS, `revoke all ... from anon`, `grant select, insert, update, delete ... to authenticated, service_role`, `mogmine_tag_registries_own` policy (`user_id = (select auth.uid()) and (select public.mogmine_is_allowed())`), and `mogmine_tag_registries_touch` trigger.

3. **Register `tag_registry` across persistence, Agent HTTP, and command layer:**
   - `contract.ts`: add `tag_registry: TagRegistry;` to `SingletonRecordTypes`.
   - `registry.ts`: add `{ key: "tag_registry", domainType: "TagRegistry, TagDef", module: "lib/tag-registry.ts, lib/tag-registry-store.ts", deviceKey: "mogmine-tags-v1", table: "mogmine_tag_registries", ownership: "stamped", ...own, readiness: "v1", inBackup: true, deletePolicy: "hard", derivedNeverStored: [], notes: "Singleton per user; setup and execution tag defs." }`.
   - **CRITICAL (`lib/agent/http.ts` lines 101–109):** update `COLLECTION_KEYS` filter to exclude `"tag_registry"` (`entry.key !== "prefs" && entry.key !== "mood_registry" && entry.key !== "tag_registry"`) and update `SINGLETON_KEYS` filter to include `"tag_registry"` (`entry.key === "prefs" || entry.key === "mood_registry" || entry.key === "tag_registry"`), updating `lib/__tests__/agent-http.test.ts`!
   - Update `local-adapter.ts` (`SINGLETON_SLOTS`, `sanitizeSingletonRecord`, `repositories`), `supabase-adapter.ts` (`singleton`, `repositories` — degrading gracefully on missing table), `select.ts`, and `journal-commands.ts` (`SINGLETON_PARSERS.tag_registry`).

4. **Create `lib/tag-registry-store.ts`, `<TagRegistryEditor />`, and wire consumers:**
   - `tag-registry-store.ts` (`mogmine-tags-v1` + `createSingletonSync` like `lib/prefs.ts`): `hydrateTagRegistry`, `useTagRegistry`, `addTag`, `renameTag` (pushes old label into `aliases`!), `updateTagDescription`, `setTagPlaybooks`, `retireTag` / `restoreTag`, `restoreTagRegistry`, `resetTagRegistryForTests`. Keep `lib/playbooks.ts` live registry synced via `setTagRegistry(reg)` (`currentSetupTags()`, `currentExecutionTags()`), while keeping `SETUP_TAGS` and `EXECUTION_TAGS` seed exports intact!
   - `lib/agent/vocabulary.ts` & `lib/agent/write-checks.ts`: read owner's `tag_registry` singleton via `commands.readSingleton("tag_registry")` (falling back to `DEFAULT_TAG_REGISTRY` when `null`), returning active tag labels + descriptions in `/api/v1/vocabulary` and validating `quick_tags` against active labels in `write-checks.ts`!
   - `components/TagRegistryEditor.tsx`: mobile-friendly (`390×844`, `>= 44px` controls) editor for Setup & Execution tags (add tag, edit label/description, assign playbooks, retire/restore), mounted below `<PlaybookEditor />` in `components/TuneScreen.tsx`, plus backup round-trip in `lib/journal-backup.ts` & `TuneScreen.tsx` and hydration in `AppShell.tsx`.

## 5. Tests to Write (`lib/__tests__/tag-registry.test.ts` + persistence/http suites)

1. Seed parity: `DEFAULT_TAG_REGISTRY` active labels equal `SETUP_TAGS` and `EXECUTION_TAGS`.
2. Add, rename (old label kept in `aliases`, case-insensitive collision rejected), description edit, playbook linking, retire & restore.
3. Backup round-trip (`buildBackup` → `parseBackupFile` → `restoreTagRegistry`); legacy backup without `tag_registry` leaves device tags untouched.
4. Agent API integration: `PUT /api/v1/singletons/tag_registry` adds a new setup tag `"200 EMA Pullback"`, `GET /api/v1/vocabulary` immediately lists `"200 EMA Pullback"`, and `POST /api/v1/records/trades` accepts `quick_tags: ["200 EMA Pullback"]` while rejecting retired or unknown tags with `422`!
5. Update `agent-http.test.ts`, `fake-supabase.ts`, `journal-commands.test.ts`, `persistence-contract.test.ts`, `persistence-local-adapter.test.ts`, and `persistence-supabase-adapter.test.ts`.

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
   git push origin origin/main:refs/heads/claim/PL-3
   ```
2. **FIRST LINE OF `notes/handoffs/2026-11-24-PL-3.md` MUST BE:**
   `> **MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP):** supabase/migrations/20261124120500_mogmine_tag_registries.sql`
   Include changed files, `TuneScreen.tsx` before/after line counts, and real command outputs.
3. Commit, push, and open PR:
   ```bash
   git add -A
   git status   # verify ONLY files in §3 and notes/handoffs/2026-11-24-PL-3.md are staged
   git commit -m "feat(PL-3): editable synced tag_registry singleton, Tune editor, and live API vocabulary"
   git push -u origin swarm/PL-3
   gh pr create --base main --title "[PL-3] Tag registry singleton, Tune editor, and live vocabulary" --body-file notes/handoffs/2026-11-24-PL-3.md
   ```

## 8. What NOT to Do & Out-of-Scope Rule

- **NEVER** run `supabase db push`, `supabase migration repair`, or `psql`!
- Do **NOT** touch any `showmob_` table in SQL, and do **NOT** rewrite stored `TradeRecord.quick_tags`.
- **STOP and leave a note** in the handoff if any out-of-scope file seems needed.

HARD RULES:
- Supabase: only `mogmine_`-prefixed objects. If a package truly needs a schema change, write the SQL migration file under `supabase/migrations/` in the PR, but DO NOT apply it yourself: NEVER run `supabase db push`, NEVER run `supabase migration repair`, never use psql against the project. Note "MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP)" at the top of the handoff and PR body; code must degrade gracefully (local mode) until it is applied. Never touch `showmob_` tables, auth site_url or disable_signup settings.
- No data dumps (no exporting tables/journals/backups, no printcode full dumps committed).
- Never print, log, commit or echo secrets (.env*, tokens, keys). Do not cat env files.
- Never modify, delete or re-create Chris's real trade records or accounts (no calls to the live /api/v1 with real tokens, no Supabase writes). Use fixtures and unit tests.
- Stay inside this package's scope and its listed writable files. Out-of-scope need = stop and write it in the handoff.
- Never edit BOARD.md, NOTES.md, DECISIONS.md. Never merge PRs, never push to main, never force-push other branches, never touch other worktrees.
