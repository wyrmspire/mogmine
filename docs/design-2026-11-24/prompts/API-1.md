# Package Prompt: `API-1` — House Rules at Discovery and List Defaults Fixed

- **Agent / Lane:** `swarm-5` (`L5 Agent API`) · **Wave:** `1` · **Branch:** `swarm/API-1`
- **Depends on:** None (Wave 1 baseline)

## 1. Goal

Serve MogMine's 12 structured agent house rules (`HR-1`..`HR-12`) and step-by-step workflows from a single pure source (`lib/agent/house-rules.ts`) across `/.well-known/mogmine.json`, `/api/v1/openapi.json`, `setupBlock`, and a new read-scoped `GET /api/v1/guide` endpoint. Also fix the `parseListQuery` bug in `lib/agent/http.ts` where missing `includeArchived` / `includeSamples` query params passed `undefined` (causing archived accounts and sample trades to leak into default API list responses).

## 2. Read First (Required Context)

1. `AGENTS.md` (especially Guardrail 11 and §6)
2. `docs/design-2026-11-24/07-agent-api.md` (§1, §2.1–§2.3, §5, §6 bullets 1 & 4)
3. `docs/design-2026-11-24/90-work-packages.md` (`API-1`)
4. `docs/design-2026-11-24/92-decisions-made-by-swarm.md` (`D-A` account R rule in `HR-6` / `HR-7`: state `r_size_cents` and `stated_risk_r` directly since `RS-1` ships in Wave 1 alongside `API-1`)

## 3. Writable Files (Strict Scope — Everything Else Read-Only)

- `lib/agent/house-rules.ts` *(new)*
- `lib/agent/openapi.ts` *(existing, ~252 lines)*
- `app/.well-known/mogmine.json/route.ts` *(existing)*
- `app/api/v1/guide/route.ts` *(new)*
- `lib/agent/http.ts` *(existing, ~125 lines)*
- `lib/__tests__/agent-house-rules.test.ts` *(new)*
- `lib/__tests__/agent-http.test.ts` *(existing)*
- `lib/__tests__/agent-openapi.test.ts` *(existing)*

## 4. Step-by-Step Implementation Plan

1. **Create `lib/agent/house-rules.ts` (pure, no Next/SDK/DOM, zero journal text):**
   ```ts
   export const HOUSE_RULES_VERSION = "2026-11-24.1";

   export interface HouseRule {
     id: `HR-${number}`;
     title: string;
     summary: string;       // concise 1-line summary for /.well-known/mogmine.json
     rule: string;          // full rule text
     why: string;           // 11/23 failure mode it prevents
     badExample: string;
     goodExample: string;
     appliesTo?: readonly ("trades" | "plans" | "daily_reviews" | "accounts" | "playbooks" | "all")[];
   }

   export interface AgentWorkflow {
     id: "log_trade" | "review_day" | "plan_session";
     title: string;
     steps: readonly string[];
   }

   export const HOUSE_RULES: readonly HouseRule[]; // HR-1 through HR-12 per 07-agent-api.md §2.2
   export const AGENT_WORKFLOWS: readonly AgentWorkflow[]; // log_trade, review_day, plan_session per 07 §2.3
   export function formatHouseRulesMarkdown(): string;
   export function buildGuidePayload(origin: string): {
     version: string;
     vocabulary_url: string;
     rules: readonly HouseRule[];
     workflows: readonly AgentWorkflow[];
   };
   ```
   - Include all 12 rules `HR-1`..`HR-12` from `07-agent-api.md` §2.2 (`HR-6` and `HR-7` teach `r_size_cents` and `stated_risk_r` per `D-A`).

2. **Update `lib/agent/http.ts`:**
   - Fix `parseListQuery(searchParams: URLSearchParams): ListQuery`:
     - Default `includeSamples` to `false` when query param is absent or not `"true"` (`searchParams.get("includeSamples") === "true"`).
     - Default `includeArchived` to `false` when query param is absent or not `"true"` (`searchParams.get("includeArchived") === "true"`).
     - *(Check `lib/__tests__/agent-http.test.ts` and update any assertion that previously expected `undefined` to assert `false`, adding a regression comment referencing the 11/23 archived-accounts bug.)*

3. **Update `lib/agent/openapi.ts` and `app/.well-known/mogmine.json/route.ts`:**
   - Export `guideUrl(origin: string): string` (`${apiBaseUrl(origin)}/guide`) and `vocabularyUrl(origin: string): string` (`${apiBaseUrl(origin)}/vocabulary`).
   - In `buildDiscovery(origin, enabled)`: add `house_rules_version: HOUSE_RULES_VERSION`, `guide_url: guideUrl(origin)`, `vocabulary_url: vocabularyUrl(origin)`, and `house_rules: HOUSE_RULES.map((r) => ({ id: r.id, summary: r.summary }))`.
   - In `buildOpenApiSpec(origin)`:
     - Append `formatHouseRulesMarkdown()` to `info.description`.
     - Add top-level `"x-mogmine-house-rules": { version: HOUSE_RULES_VERSION, guide_url: guideUrl(origin), rules: HOUSE_RULES.map(({ id, title, summary }) => ({ id, title, summary })) }`.
     - Add `/guide` GET operation (`operationId: "getGuide"`, `scope: "read"`, 200 ok).
     - Repeat relevant rule reminders (`HR-1`..`HR-5`, `HR-7`, `HR-9`, `HR-10`) in `/records/{type}` POST/PATCH descriptions.
   - In `setupBlock(origin, token)`: add `"Before writing anything, read " + guideUrl(origin)` as a line in the returned block.
   - Verify `app/.well-known/mogmine.json/route.ts` passes through the updated `buildDiscovery`.

4. **Create `app/api/v1/guide/route.ts`:**
   - Use the exact same auth/rate-limit/audit wrapper (`handleAgentRequest` from `lib/agent/handle.ts`, `scope: "read"`) as `app/api/v1/me/route.ts`, returning `agentOk(buildGuidePayload(new URL(request.url).origin))`.

## 5. Tests to Write

1. `lib/__tests__/agent-house-rules.test.ts`:
   - Asserts all 12 rule IDs (`HR-1`..`HR-12`) exist in `HOUSE_RULES`, `buildDiscovery(...)`, `buildOpenApiSpec(...)` (`info.description` AND `x-mogmine-house-rules`), and `buildGuidePayload(...)`, with identical `HOUSE_RULES_VERSION`.
   - Asserts `setupBlock` includes `Before writing anything, read https://.../api/v1/guide`.
   - Tests `GET /api/v1/guide` route handler (or `handleAgentRequest` integration) requires `read` scope (`401` without key, `403` with write-only key, `200` with read key).
2. `lib/__tests__/agent-http.test.ts` & `lib/__tests__/agent-openapi.test.ts`:
   - Regression test: `parseListQuery(new URLSearchParams())` returns `{ includeSamples: false, includeArchived: false, parentId: undefined, limit: 100 }`, and listing `accounts` through `dispatchAgentRoute` with default query omits archived accounts!

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
   git push origin origin/main:refs/heads/claim/API-1
   ```
2. Write `notes/handoffs/2026-11-24-API-1.md` with changed files, exported functions, and real command output.
3. Commit, push, and open PR:
   ```bash
   git add lib/agent/house-rules.ts lib/agent/openapi.ts app/.well-known/mogmine.json/route.ts app/api/v1/guide/route.ts lib/agent/http.ts lib/__tests__/agent-house-rules.test.ts lib/__tests__/agent-http.test.ts lib/__tests__/agent-openapi.test.ts notes/handoffs/2026-11-24-API-1.md
   git commit -m "feat(API-1): serve agent house rules at discovery and /guide; default includeArchived false"
   git push -u origin swarm/API-1
   gh pr create --base main --title "[API-1] House rules at discovery and list defaults fixed" --body-file notes/handoffs/2026-11-24-API-1.md
   ```

## 8. What NOT to Do & Out-of-Scope Rule

- Do **NOT** build `/api/v1/vocabulary` here (`API-2a` builds it in Wave 2; `API-1` only advertises `vocabulary_url` in discovery/guide).
- Do **NOT** edit `lib/persistence/contract.ts` (keep `ListQuery` contract defaults for internal backup callers; only `parseListQuery` in `lib/agent/http.ts` defaults to `false`).
- **STOP and leave a note** in the handoff if any out-of-scope file seems needed.

HARD RULES:
- Supabase: only `mogmine_`-prefixed objects. If a package truly needs a schema change, write the SQL migration file under `supabase/migrations/` in the PR, but DO NOT apply it yourself: NEVER run `supabase db push`, NEVER run `supabase migration repair`, never use psql against the project. Note "MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP)" at the top of the handoff and PR body; code must degrade gracefully (local mode) until it is applied. Never touch `showmob_` tables, auth site_url or disable_signup settings.
- No data dumps (no exporting tables/journals/backups, no printcode full dumps committed).
- Never print, log, commit or echo secrets (.env*, tokens, keys). Do not cat env files.
- Never modify, delete or re-create Chris's real trade records or accounts (no calls to the live /api/v1 with real tokens, no Supabase writes). Use fixtures and unit tests.
- Stay inside this package's scope and its listed writable files. Out-of-scope need = stop and write it in the handoff.
- Never edit BOARD.md, NOTES.md, DECISIONS.md. Never merge PRs, never push to main, never force-push other branches, never touch other worktrees.
