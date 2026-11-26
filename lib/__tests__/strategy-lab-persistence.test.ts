import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildBarSeries } from "../strategy-lab/series.ts";
import { readRemoteSessionBars1m, upsertBars1mForArchive, type ServiceBarsClientLike } from "../strategy-lab/bars-cache.ts";
import {
  createStrategyLabRemoteRepo, fromPersistedRun, loadLocalRuns, RUN_STORE_KEY, RUN_STORE_LIMIT, sanitizeMatch,
  saveLocalRun, toPersistedRun, type LabSupabaseClientLike, type PersistedRun, type RunStorage,
} from "../strategy-lab/persistence.ts";
import type { DbError } from "../persistence/supabase-adapter.ts";
import type { Match, Recipe, RunResult, SourceBar } from "../strategy-lab/types.ts";

// ---------------------------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------------------------

const T0 = Date.UTC(2026, 10, 25, 14, 30); // 09:30 ET
const MINUTE = 60_000;

/** §5.3 example B, verbatim (valid v1 recipe). */
const RECIPE_B = {
  schema: "mogmine.strategy-recipe.v1",
  id: "rcp-pdl-first-hour", version: 1,
  name: "PDL first touch, first hour, close back above",
  playbookId: null,
  symbol: "MES", side: "long",
  window: { startEt: "09:31", endEt: "10:30" },
  trigger: { all: [
    { skill: "levelMap", params: { level: "pdl", toleranceTicks: 2 }, out: "touch", op: "==", value: true },
    { skill: "levelMap", params: { level: "pdl", toleranceTicks: 2 }, out: "closeDistTicks", op: ">=", value: 0 },
  ]},
  entry: { at: "trigger-close" },
  stop: { type: "points", points: 4 },
  target: { type: "level", level: "rth_open", fallbackPoints: 8 },
  maxHoldMinutes: 90, flatAtEt: "15:59",
  sizing: { mode: "risk-r", riskR: 0.25 },
  account: { accountId: null },
  slippageTicks: { stop: 1, market: 1 },
  dedupe: { maxPerSession: 1, cooldownMinutes: 60, oneAtATime: true },
  sliceBy: [{ skill: "sessionClock", out: "todBucket" }],
  measure: { levelReach: ["rth_open"], forwardMinutes: [15] },
};

const recipe = (version: number, name = `v${version}`): Recipe =>
  ({ ...RECIPE_B, version, name } as unknown as Recipe);

function match(k: number, features: Match["features"] = { rvol: 1.4, spike: true, sign: "positive" }): Match {
  return {
    i: 100 + k, time: T0 + k * MINUTE, sessionDate: "2026-11-25", entry: 5000 + k, stop: 4996 + k, target: 5008 + k,
    qty: 2, oversized: false, features,
    outcome: {
      exitReason: "target", exitTime: T0 + (k + 12) * MINUTE, pnlPoints: 8, pnlUsd: 80, resultR: 2, riskMultiple: 2,
      mfePoints: 9, maePoints: 1, mfeR: 2.25, maeR: 0.25, minutesToExit: 12, minutesToTarget: 12,
    },
  };
}

/** A RunResult with the full aggregate surface plus bulky fields the compact form must drop. */
function runResult(recipeVersion: number, matchCount = 3): RunResult & Record<string, unknown> {
  const matches = Array.from({ length: matchCount }, (_, k) => match(k, { rvol: k === 0 ? Number.NaN : 1.1, sign: "flat" }));
  const result: RunResult & Record<string, unknown> = {
    recipe: { id: "rcp-pdl-first-hour", version: recipeVersion },
    data: {
      sessionsRequested: 10, sessionsUsed: ["2026-11-25"], excluded: [], barsMissing: 0, volumeMissing: 1,
      rSize: { usd: 300, source: "account" },
    },
    candidates: 4,
    skips: { rvol: { "volume-missing": 1 } },
    matches,
    stats: { n: matchCount, wins: matchCount, losses: 0, scratches: 0, winRate: 1, avgR: 2 } as unknown as RunResult["stats"],
    splits: [{ ref: { skill: "sessionClock", out: "todBucket" }, buckets: [] }],
    separators: [],
    timeOfDay: [{ bucket: "09:30", n: 3, wins: 3, winRate: 1, avgR: 2 }],
    ms: 42,
    overlays: Array.from({ length: 200 }, (_, k) => ({ tradeId: `t${k}` })) as unknown as RunResult["overlays"],
    series: Array.from({ length: 5000 }, (_, k) => k),
  };
  return result;
}

function mustRun(result: RunResult, id: string, createdAt: string, accountName: string | null = null): PersistedRun {
  const run = toPersistedRun(result, { id, createdAt, accountName });
  assert.ok(run, "fixture run should compact");
  return run;
}

// ---------------------------------------------------------------------------------------------------------------
// In-memory fake Supabase client (zero network). Filters, upsert on conflict keys, delete, error injection.
// ---------------------------------------------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
interface Call { table: string; op: "select" | "upsert" | "delete"; filters: string[]; order?: string; onConflict?: string; payload?: unknown }
interface FakeOptions {
  uid?: string | null;
  tables?: Tables;
  fail?: Record<string, { code: string; message?: string }>;
  offline?: boolean;
}

function fakeSupabase(options: FakeOptions = {}) {
  const tables: Tables = options.tables ?? {};
  const calls: Call[] = [];
  const uid = options.uid === undefined ? "user-a" : options.uid;
  const rowsOf = (name: string) => (tables[name] ??= []);
  const nowIso = "2026-11-26T12:00:00.000Z";

  const upsertRow = (name: string, row: Row, conflict: string) => {
    if (row.user_id !== uid) return { data: null, error: { code: "42501", message: "new row violates row-level security policy" } };
    const keys = conflict.split(",");
    const list = rowsOf(name);
    const at = list.findIndex((existing) => keys.every((key) => existing[key] === row[key]));
    const stored: Row = { created_at: nowIso, ...(at >= 0 ? list[at] : {}), ...row, updated_at: nowIso };
    if (at >= 0) list[at] = stored; else list.push(stored);
    return { data: [stored], error: null };
  };

  const client = {
    auth: { async getSession() { return { data: { session: uid ? { user: { id: uid } } : null } }; } },
    from(name: string) {
      const call: Call = { table: name, op: "select", filters: [] };
      const steps: Array<(rows: Row[]) => Row[]> = [];
      let write: (() => { data: unknown; error: DbError | null }) | null = null;
      const api = {
        select() { return api; },
        eq(column: string, value: unknown) {
          call.filters.push(`${column}=${String(value)}`);
          steps.push((rows) => rows.filter((row) => row[column] === value));
          return api;
        },
        gte(column: string, value: string) {
          call.filters.push(`${column}>=${value}`);
          steps.push((rows) => rows.filter((row) => Date.parse(String(row[column])) >= Date.parse(value)));
          return api;
        },
        lt(column: string, value: string) {
          call.filters.push(`${column}<${value}`);
          steps.push((rows) => rows.filter((row) => Date.parse(String(row[column])) < Date.parse(value)));
          return api;
        },
        order(column: string, opts?: { ascending?: boolean }) {
          const ascending = opts?.ascending !== false;
          call.order = `${column}:${ascending ? "asc" : "desc"}`;
          steps.push((rows) => [...rows].sort((a, b) => {
            const left = String(a[column]);
            const right = String(b[column]);
            return (left < right ? -1 : left > right ? 1 : 0) * (ascending ? 1 : -1);
          }));
          return api;
        },
        limit(count: number) { steps.push((rows) => rows.slice(0, count)); return api; },
        upsert(row: Row, opts: { onConflict: string }) {
          call.op = "upsert";
          call.onConflict = opts.onConflict;
          call.payload = row;
          write = () => upsertRow(name, row, opts.onConflict);
          return api;
        },
        delete() {
          call.op = "delete";
          write = () => {
            const doomed = steps.reduce((rows, step) => step(rows), [...rowsOf(name)]);
            tables[name] = rowsOf(name).filter((row) => !doomed.includes(row));
            return { data: doomed, error: null };
          };
          return api;
        },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          calls.push({ ...call, filters: [...call.filters] });
          const run = async () => {
            if (options.offline) throw new TypeError("fetch failed");
            const injected = options.fail?.[name];
            if (injected) return { data: null, error: { code: injected.code, message: injected.message ?? "injected" } };
            if (write) return write();
            const rows = steps.reduce((current, step) => step(current), [...rowsOf(name)]);
            return { data: rows.map((row) => ({ ...row })), error: null };
          };
          return run().then(resolve, reject);
        },
      };
      return api;
    },
  };
  return { client: client as unknown as LabSupabaseClientLike, tables, calls };
}

function fakeServiceClient(error: DbError | null = null) {
  const upserts: { table: string; rows: Row[]; onConflict: string }[] = [];
  const client: ServiceBarsClientLike = {
    from(table: string) {
      return {
        upsert(rows, opts) {
          upserts.push({ table, rows: rows.map((row) => ({ ...row })), onConflict: opts.onConflict });
          return Promise.resolve({ error });
        },
      };
    },
  };
  return { client, upserts };
}

function memoryStorage(initial: Record<string, string> = {}): RunStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
  };
}

/** Run a block with the Supabase adapter env flag set, restoring the old values afterwards. */
async function withEnv<T>(vars: Record<string, string | undefined>, body: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  try {
    return await body();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Migration file
// ---------------------------------------------------------------------------------------------------------------

const MIGRATION = path.resolve(process.cwd(), "supabase/migrations/20261126120000_mogmine_strategy_lab.sql");
const sql = fs.readFileSync(MIGRATION, "utf-8");
const sqlStatements = sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n")
  .split(";").map((statement) => statement.trim().replace(/\s+/g, " ")).filter(Boolean);
const statementsMatching = (pattern: RegExp) => sqlStatements.filter((statement) => pattern.test(statement));

test("migration: header flags it as needing apply and never applied by a worker", () => {
  assert.match(sql, /^-- MIGRATION NEEDS APPLYING \(apply_migration via Supabase MCP\)\. Written by a worker; never applied by a worker\./m);
});

test("migration: every public.* identifier is a mogmine_ object", () => {
  const names = [...sql.matchAll(/\bpublic\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]);
  assert.ok(names.length > 0);
  for (const name of names) assert.ok(name.startsWith("mogmine_"), `non-mogmine object: ${name}`);
  for (const expected of ["mogmine_strategy_recipes", "mogmine_strategy_runs", "mogmine_bars_1m", "mogmine_is_allowed", "mogmine_touch_row"]) {
    assert.ok(names.includes(expected), `expected ${expected}`);
  }
});

test("migration: no showmob_, drop, alter user, disable_signup or site_url anywhere", () => {
  for (const banned of [/showmob_/i, /drop/i, /alter\s+user/i, /disable_signup/i, /site_url/i]) {
    assert.doesNotMatch(sql, banned);
  }
});

test("migration: RLS on all three tables, no anon access, is_allowed and touch triggers", () => {
  for (const table of ["mogmine_strategy_recipes", "mogmine_strategy_runs", "mogmine_bars_1m"]) {
    assert.ok(sqlStatements.includes(`alter table public.${table} enable row level security`), `RLS on ${table}`);
    assert.ok(sqlStatements.includes(`revoke all on table public.${table} from anon`), `no anon on ${table}`);
  }
  for (const table of ["mogmine_strategy_recipes", "mogmine_strategy_runs"]) {
    const policies = statementsMatching(new RegExp(`^create policy \\w+ on public\\.${table} for all to authenticated`));
    assert.equal(policies.length, 1, `own-rows policy on ${table}`);
    assert.match(policies[0], /using \(user_id = \(select auth\.uid\(\)\) and \(select public\.mogmine_is_allowed\(\)\)\)/);
    assert.match(policies[0], /with check \(user_id = \(select auth\.uid\(\)\) and \(select public\.mogmine_is_allowed\(\)\)\)/);
    assert.ok(statementsMatching(new RegExp(`^create trigger \\w+ before insert or update on public\\.${table} .*mogmine_touch_row\\(\\)`)).length === 1, `touch trigger on ${table}`);
  }
  const bars = statementsMatching(/^create policy \w+ on public\.mogmine_bars_1m/);
  assert.equal(bars.length, 1);
  assert.match(bars[0], /for select to authenticated using \(\(select public\.mogmine_is_allowed\(\)\)\)/);
});

test("migration: bars are written only by service_role; authenticated reads only", () => {
  const grants = statementsMatching(/^grant .* on table public\.mogmine_bars_1m /);
  assert.ok(grants.includes("grant select on table public.mogmine_bars_1m to authenticated"));
  assert.ok(grants.includes("grant select, insert, update, delete on table public.mogmine_bars_1m to service_role"));
  assert.ok(!grants.some((grant) => /to authenticated/.test(grant) && /insert|update|delete/.test(grant)));
  assert.equal(statementsMatching(/^create policy \w+ on public\.mogmine_bars_1m for (?!select)/).length, 0);
});

test("migration: recipe key is (user_id, id, version) and runs grants match the journal pattern", () => {
  const recipes = statementsMatching(/^create table public\.mogmine_strategy_recipes /)[0];
  assert.match(recipes, /primary key \(user_id, id, version\)/);
  assert.match(recipes, /archived boolean not null generated always as/);
  assert.ok(sqlStatements.includes("grant select, insert, update, delete on table public.mogmine_strategy_recipes to authenticated, service_role"));
  assert.ok(sqlStatements.includes("grant select, insert, update, delete on table public.mogmine_strategy_runs to authenticated, service_role"));
});

// ---------------------------------------------------------------------------------------------------------------
// Compact runs and local storage
// ---------------------------------------------------------------------------------------------------------------

test("compact run: summary has no per-bar arrays and matches keep only scalars", () => {
  const run = mustRun(runResult(1), "run-1", "2026-11-26T12:00:00.000Z", "SIM Eval 50K");
  assert.deepEqual(Object.keys(run.summary).sort(), ["candidates", "data", "ms", "separators", "skips", "splits", "stats", "timeOfDay"]);
  assert.equal(run.recipeId, "rcp-pdl-first-hour");
  assert.equal(run.recipeVersion, 1);
  assert.equal(run.accountName, "SIM Eval 50K");
  assert.ok(JSON.stringify(run).length < 4_000, "compact run stays small");
  assert.equal(run.matches[0].features.rvol, null, "NaN feature (missing volume) is stored as null");
});

test("compact run: round-trips through the remote row shape without per-bar bloat", async () => {
  const fake = fakeSupabase({ uid: "user-a" });
  const repo = createStrategyLabRemoteRepo({ client: fake.client });
  const original = mustRun(runResult(1), "run-rt", "2026-11-26T12:00:00.000Z", "SIM Eval 50K");
  const put = await repo.putRun(original);
  assert.ok(put.ok);
  const stored = fake.tables.mogmine_strategy_runs[0];
  assert.ok(JSON.stringify(stored.summary).length < 4_000, "row summary is compact");
  assert.equal("overlays" in (stored.summary as object), false);
  assert.equal("series" in (stored.summary as object), false);

  const listed = await repo.listRuns();
  assert.ok(listed.ok);
  assert.equal(listed.value.length, 1);
  assert.deepEqual(listed.value[0], fromPersistedRun(original));
  assert.equal(listed.value[0].accountName, "SIM Eval 50K");
});

test("local runs: keep the latest 25, newest first, and replace an id in place", () => {
  const storage = memoryStorage();
  for (let k = 0; k < 30; k += 1) {
    const at = new Date(Date.UTC(2026, 10, 20, 12, k)).toISOString();
    const result = saveLocalRun(storage, mustRun(runResult(1, 1), `run-${k}`, at));
    assert.ok(result.ok);
  }
  const runs = loadLocalRuns(storage);
  assert.equal(runs.length, RUN_STORE_LIMIT);
  assert.equal(runs[0].id, "run-29");
  assert.equal(runs.at(-1)?.id, "run-5");
  const replaced = saveLocalRun(storage, mustRun(runResult(1, 1), "run-29", "2026-11-20T12:59:00.000Z"));
  assert.ok(replaced.ok);
  assert.equal(replaced.value.filter((run) => run.id === "run-29").length, 1);
});

test("local runs: bad JSON and bad entries never throw; a bad entry drops only itself", () => {
  assert.deepEqual(loadLocalRuns(memoryStorage({ [RUN_STORE_KEY]: "{not json" })), []);
  assert.deepEqual(loadLocalRuns(memoryStorage({ [RUN_STORE_KEY]: JSON.stringify({ runs: "nope" }) })), []);
  const good = mustRun(runResult(1, 1), "run-good", "2026-11-26T12:00:00.000Z");
  const mixed = memoryStorage({ [RUN_STORE_KEY]: JSON.stringify({ runs: ["junk", { id: "" }, good] }) });
  assert.deepEqual(loadLocalRuns(mixed).map((run) => run.id), ["run-good"]);
});

test("local runs: a storage write failure returns unavailable instead of throwing", () => {
  const storage: RunStorage = {
    getItem: () => null,
    setItem: () => { throw new Error("QuotaExceededError"); },
  };
  const result = saveLocalRun(storage, mustRun(runResult(1, 1), "run-q", "2026-11-26T12:00:00.000Z"));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "unavailable");
});

test("sanitizeMatch: rejects a match with a non-finite required number", () => {
  const broken = { ...match(0), entry: Number.NaN };
  assert.equal(sanitizeMatch(broken), null);
  assert.equal(sanitizeMatch(match(0))?.outcome.minutesToTarget, 12);
});

// ---------------------------------------------------------------------------------------------------------------
// Remote recipes and runs
// ---------------------------------------------------------------------------------------------------------------

test("recipes: owner isolation, each user sees and changes only their own rows", async () => {
  const tables: Tables = {};
  const a = createStrategyLabRemoteRepo({ client: fakeSupabase({ uid: "user-a", tables }).client });
  const b = createStrategyLabRemoteRepo({ client: fakeSupabase({ uid: "user-b", tables }).client });
  assert.ok((await a.putRecipe(recipe(1))).ok);
  assert.ok((await b.putRecipe(recipe(1, "b's copy"))).ok);

  const aList = await a.listRecipes();
  const bList = await b.listRecipes();
  assert.ok(aList.ok && bList.ok);
  assert.deepEqual(aList.value.map((r) => r.name), ["v1"]);
  assert.deepEqual(bList.value.map((r) => r.name), ["b's copy"]);
  assert.equal(tables.mogmine_strategy_recipes.length, 2);

  assert.ok((await b.removeRecipe("rcp-pdl-first-hour")).ok);
  const aAfter = await a.listRecipes();
  assert.ok(aAfter.ok);
  assert.equal(aAfter.value.length, 1, "b's delete never touches a's rows");
});

test("recipes: every version is kept under (user_id, id, version)", async () => {
  const fake = fakeSupabase();
  const repo = createStrategyLabRemoteRepo({ client: fake.client });
  assert.ok((await repo.putRecipe(recipe(1))).ok);
  assert.ok((await repo.putRecipe(recipe(2, "v2"))).ok);
  assert.ok((await repo.putRecipe(recipe(2, "v2"))).ok, "same version upserts, no duplicate");
  const listed = await repo.listRecipes();
  assert.ok(listed.ok);
  assert.deepEqual(listed.value.map((r) => r.version), [1, 2]);
  assert.equal(fake.tables.mogmine_strategy_recipes.length, 2);
  assert.equal(fake.calls.filter((c) => c.op === "upsert").at(-1)?.onConflict, "user_id,id,version");
});

test("recipes: an invalid recipe is rejected before any write", async () => {
  const fake = fakeSupabase();
  const repo = createStrategyLabRemoteRepo({ client: fake.client });
  const result = await repo.putRecipe({ ...recipe(1), schema: "wrong" } as unknown as Recipe);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "invalid");
  assert.equal(fake.calls.filter((c) => c.op === "upsert").length, 0);
});

test("errors: unapplied migration (42P01 / PGRST205) is unavailable, never a throw", async () => {
  for (const code of ["42P01", "PGRST205"]) {
    const repo = createStrategyLabRemoteRepo({ client: fakeSupabase({ fail: { mogmine_strategy_recipes: { code }, mogmine_strategy_runs: { code } } }).client });
    const recipes = await repo.listRecipes();
    assert.equal(recipes.ok, false);
    if (!recipes.ok) assert.equal(recipes.error.code, "unavailable");
    const runs = await repo.putRun(mustRun(runResult(1, 1), "run-x", "2026-11-26T12:00:00.000Z"));
    assert.equal(runs.ok, false);
    if (!runs.ok) assert.equal(runs.error.code, "unavailable");
  }
});

test("errors: signed out is unauthenticated; offline is unavailable; neither throws", async () => {
  const signedOut = createStrategyLabRemoteRepo({ client: fakeSupabase({ uid: null }).client });
  const out = await signedOut.listRuns();
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.error.code, "unauthenticated");

  const offline = createStrategyLabRemoteRepo({ client: fakeSupabase({ offline: true }).client });
  const net = await offline.removeRecipe("rcp-pdl-first-hour");
  assert.equal(net.ok, false);
  if (!net.ok) assert.equal(net.error.code, "unavailable");
});

test("remote default: with the adapter off, no client is loaded and the repo says unavailable", async () => {
  await withEnv({ NEXT_PUBLIC_PERSISTENCE_ADAPTER: undefined }, async () => {
    const result = await createStrategyLabRemoteRepo().listRecipes();
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "unavailable");
  });
});

test("remote default: adapter on without env vars fails safely, offline, without throwing", async () => {
  await withEnv({ NEXT_PUBLIC_PERSISTENCE_ADAPTER: "supabase", NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "" }, async () => {
    const result = await createStrategyLabRemoteRepo().putRun(mustRun(runResult(1, 1), "run-env", "2026-11-26T12:00:00.000Z"));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "unavailable");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The 1m bar cache
// ---------------------------------------------------------------------------------------------------------------

const barRow = (time: number, extra: Row) => ({
  symbol: "MES", time: new Date(time).toISOString(), open: "5000.25", high: 5001, low: "4999.5", close: 5000.75, source: "test", ...extra,
});

test("bars read: ISO time to ms, numeric strings to numbers, volume 0 and null to missing", async () => {
  const fake = fakeSupabase({
    tables: {
      mogmine_bars_1m: [
        barRow(T0 + 2 * MINUTE, { volume: 1200 }),
        barRow(T0, { volume: 0 }),
        barRow(T0 + MINUTE, { volume: null }),
        barRow(T0 + 3 * MINUTE, { volume: "980" }),
        barRow(T0 + 4 * MINUTE, { symbol: "NQ", volume: 5 }),
      ],
    },
  });
  const result = await readRemoteSessionBars1m("MES", { from: T0, to: T0 + 3 * MINUTE }, fake.client);
  assert.ok(result.ok);
  assert.deepEqual(result.value?.map((bar) => bar.time), [T0, T0 + MINUTE, T0 + 2 * MINUTE]);
  assert.deepEqual(result.value?.map((bar) => bar.volume), [null, null, 1200]);
  assert.equal(result.value?.[0].open, 5000.25);
  const call = fake.calls[0];
  assert.deepEqual(call.filters, ["symbol=MES", `time>=${new Date(T0).toISOString()}`, `time<${new Date(T0 + 3 * MINUTE).toISOString()}`]);
  assert.equal(call.order, "time:asc");
  assert.ok(fake.calls.every((c) => c.op === "select"), "browser read never writes the bar cache");

  const series = buildBarSeries("MES", result.value ?? []);
  assert.ok(Number.isNaN(series.volume[0]) && Number.isNaN(series.volume[1]));
  assert.equal(series.volume[2], 1200);
});

test("bars read: unapplied table is unavailable; signed out is unavailable; adapter off is null", async () => {
  const window = { from: T0, to: T0 + MINUTE };
  const missing = await readRemoteSessionBars1m("MES", window, fakeSupabase({ fail: { mogmine_bars_1m: { code: "42P01" } } }).client);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.error.code, "unavailable");

  const signedOut = await readRemoteSessionBars1m("MES", window, fakeSupabase({ uid: null }).client);
  assert.equal(signedOut.ok, false);
  if (!signedOut.ok) assert.equal(signedOut.error.code, "unavailable");

  await withEnv({ NEXT_PUBLIC_PERSISTENCE_ADAPTER: undefined }, async () => {
    const off = await readRemoteSessionBars1m("MES", window);
    assert.deepEqual(off, { ok: true, value: null });
  });
});

test("bars archive: service_role upsert maps volume 0 and null to null, drops bad OHLC, last duplicate wins", async () => {
  const service = fakeServiceClient();
  const bars: SourceBar[] = [
    { time: T0, open: 5000, high: 5001, low: 4999, close: 5000.5, volume: 0 },
    { time: T0 + MINUTE, open: 5000, high: 5001, low: 4999, close: 5000.5, volume: null },
    { time: T0 + 2 * MINUTE, open: 5000, high: 5001, low: 4999, close: 5000.5, volume: 800.4 },
    { time: T0 + 3 * MINUTE, open: 5000, high: 5000, low: 4999, close: 5001, volume: 300 },
    { time: Number.NaN, open: 5000, high: 5001, low: 4999, close: 5000.5, volume: 300 },
    { time: T0 + 2 * MINUTE, open: 5000, high: 5001, low: 4999, close: 5000.5, volume: 900 },
  ];
  const result = await upsertBars1mForArchive(service.client, { symbol: "MES", source: "yahoo", bars });
  assert.deepEqual(result, { ok: true, value: { written: 3, dropped: 2 } });
  assert.equal(service.upserts.length, 1);
  assert.equal(service.upserts[0].table, "mogmine_bars_1m");
  assert.equal(service.upserts[0].onConflict, "symbol,time");
  const rows = service.upserts[0].rows;
  assert.deepEqual(rows.map((row) => row.volume), [null, null, 900]);
  assert.equal(rows[0].time, new Date(T0).toISOString());
  assert.equal(rows[0].source, "yahoo");
});

test("bars archive: a database error comes back typed, not thrown", async () => {
  const service = fakeServiceClient({ code: "42P01", message: "relation does not exist" });
  const result = await upsertBars1mForArchive(service.client, {
    symbol: "MES", source: "yahoo", bars: [{ time: T0, open: 1, high: 1, low: 1, close: 1, volume: 5 }],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "unavailable");
});
