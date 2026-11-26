import test from "node:test";
import assert from "node:assert/strict";
import type { DbError } from "../persistence/supabase-adapter.ts";
import {
  createStrategyLabRemoteRepo, fromPersistedRun, loadLocalRuns, RUN_STORE_KEY, saveLocalRun, type LabQueryLike,
  type LabSupabaseClientLike, type PersistedRun, type RunStorage,
} from "../strategy-lab/persistence.ts";
import {
  mergeRecipeStores, mergeRunLists, persistedLastRuns, runsCoverVersion, sessionsForChangedTrades, tradeSignature,
  tradeSignatures,
} from "../strategy-lab/use-lab-persistence.ts";
import type { RecipeStore } from "../strategy-lab/recipes-store.ts";
import type { Recipe } from "../strategy-lab/types.ts";
import type { TradeRecord } from "../trades.ts";

// Headless tests for the Strategy Lab sync helpers and the remote repository (no React renderer, no network).

/** §5.3 example B, the same valid v1 recipe the persistence tests use. */
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

const recipe = (id: string, version: number, name = `${id} v${version}`): Recipe =>
  ({ ...RECIPE_B, id, version, name } as unknown as Recipe);

/** A compact stored run for a recipe version, built through the same sanitizer the app uses. */
function run(id: string, recipeId: string, recipeVersion: number, createdAt: string): PersistedRun {
  const clean = fromPersistedRun({
    id, recipeId, recipeVersion, accountName: null, createdAt,
    summary: {
      data: { sessionsUsed: ["2026-11-25"], sessionsRequested: 22, rSize: { usd: 300, source: "default" } },
      candidates: 3, skips: {}, splits: [], separators: [], timeOfDay: [], ms: 12,
      stats: { n: 3, avgR: 0.5, winRate: 0.66, expectancyR: 0.5 },
    },
    matches: [],
  });
  if (!clean) throw new Error("fixture run did not pass validation");
  return clean;
}

/** Enough of a PostgREST chain for the repository: every builder call returns the same thenable. */
function fakeClient(reply: { data?: unknown; error?: DbError | null }, calls: string[]): LabSupabaseClientLike {
  const builder: Record<string, unknown> = {};
  for (const name of ["select", "eq", "gte", "lt", "order", "limit", "delete"]) builder[name] = () => builder;
  builder.upsert = () => { calls.push("upsert"); return builder; };
  builder.then = (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) =>
    Promise.resolve({ data: reply.data ?? null, error: reply.error ?? null }).then(resolve, reject);
  return {
    auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }) },
    from: (table: string) => { calls.push(table); return builder as unknown as LabQueryLike; },
  };
}

function memoryStorage(seed: Record<string, string> = {}): RunStorage & { values: Map<string, string> } {
  const values = new Map(Object.entries(seed));
  return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}

const store = (...recipes: Recipe[]): RecipeStore => ({ recipes });

test("recipe merge unions local and remote by id@version and never drops a newer local version", () => {
  const local = store(recipe("rcp-a", 1), recipe("rcp-a", 2, "local edit"));
  const remote = store(recipe("rcp-a", 1, "remote copy"), recipe("rcp-a", 3), recipe("rcp-b", 1));
  const merged = mergeRecipeStores(local, remote);
  assert.deepEqual(merged.recipes.map((r) => `${r.id}@${r.version}`), ["rcp-a@1", "rcp-a@2", "rcp-a@3", "rcp-b@1"]);
  assert.equal(merged.recipes.find((r) => r.id === "rcp-a" && r.version === 2)?.name, "local edit");
  assert.equal(merged.recipes.find((r) => r.id === "rcp-a" && r.version === 1)?.name, "rcp-a v1", "the local copy wins on a shared key");
});

test("run merge is by id, newest first, and the local copy wins on a shared id", () => {
  const local = [run("run-2", "rcp-a", 1, "2026-11-26T10:00:00.000Z")];
  const remote = [run("run-1", "rcp-a", 1, "2026-11-25T10:00:00.000Z"), run("run-2", "rcp-a", 1, "2026-11-20T00:00:00.000Z")];
  const merged = mergeRunLists(local, remote);
  assert.deepEqual(merged.map((r) => r.id), ["run-2", "run-1"]);
  assert.equal(merged[0].createdAt, "2026-11-26T10:00:00.000Z");
});

test("restored runs fill the Recipes tab summary and the editor's newest-has-runs flag before anything is re-run", () => {
  const runs = [
    run("run-new", "rcp-a", 2, "2026-11-26T10:00:00.000Z"),
    run("run-old", "rcp-a", 1, "2026-11-25T10:00:00.000Z"),
  ];
  const lines = persistedLastRuns(runs);
  assert.match(lines["rcp-a"], /^last run: n 3 /, "the newest run per recipe names the line");
  assert.equal(Object.keys(lines).length, 1);
  assert.equal(runsCoverVersion(runs, "rcp-a", 2), true, "the newest version has runs");
  assert.equal(runsCoverVersion(runs, "rcp-a", 3), false, "a version with no run does not");
});

test("saves push to the server and runs push as they finish; the repository writes the expected table", async () => {
  const calls: string[] = [];
  const repo = createStrategyLabRemoteRepo({ client: fakeClient({}, calls) });
  const saved = await repo.putRecipe(recipe("rcp-pdl-first-hour", 1));
  assert.equal(saved.ok, true);
  const pushed = await repo.putRun(run("run-1", "rcp-pdl-first-hour", 1, "2026-11-26T10:00:00.000Z"));
  assert.equal(pushed.ok, true);
  assert.deepEqual(calls, ["mogmine_strategy_recipes", "upsert", "mogmine_strategy_runs", "upsert"]);
});

test("a missing table (42P01) or an unavailable server is silent: the local runs stay and the save still lands on the device", async () => {
  const unapplied = createStrategyLabRemoteRepo({ client: fakeClient({ error: { code: "42P01", message: "relation does not exist" } }, []) });
  const listed = await unapplied.listRuns();
  assert.equal(listed.ok, false);
  assert.equal(!listed.ok && listed.error.code, "unavailable");

  const local = memoryStorage();
  const kept = saveLocalRun(local, run("run-local", "rcp-a", 1, "2026-11-26T09:00:00.000Z"));
  assert.equal(kept.ok, true);
  const pushed = await unapplied.putRun(run("run-local", "rcp-a", 1, "2026-11-26T09:00:00.000Z"));
  assert.equal(pushed.ok, false, "the push fails quietly");
  assert.deepEqual(loadLocalRuns(local).map((r) => r.id), ["run-local"], "the local copy still stands");

  const signedOut = createStrategyLabRemoteRepo({ client: { ...fakeClient({}, []), auth: { getSession: async () => ({ data: { session: null } }) } } });
  const none = await signedOut.listRecipes();
  assert.equal(!none.ok && none.error.code, "unauthenticated");
  assert.equal(loadLocalRuns(local).length, 1);
  assert.ok(local.values.has(RUN_STORE_KEY));
});

test("trade signatures: note edits never re-trigger a top-up; a new trade or an edited entry or exit time does, once", () => {
  const trade = (patch: Partial<TradeRecord> = {}): TradeRecord => ({
    id: "t1", symbol: "MES", is_sample: false,
    entry_time: "2026-11-25T15:00:00Z", exit_time: "2026-11-25T16:00:00Z", notes: "first", ...patch,
  } as unknown as TradeRecord);

  const seen = tradeSignatures([trade()]);
  assert.equal(tradeSignature(trade()), tradeSignature(trade({ notes: "a note edit" } as Partial<TradeRecord>)));
  assert.deepEqual(sessionsForChangedTrades(seen, [trade({ notes: "a note edit" } as Partial<TradeRecord>)]), []);

  // An edited entry time moves the trade to the session it now belongs to, and that is topped up once.
  const moved = [trade({ entry_time: "2026-11-24T15:00:00Z", exit_time: "2026-11-24T16:00:00Z" })];
  const changed = sessionsForChangedTrades(seen, moved);
  assert.deepEqual(changed, ["2026-11-23", "2026-11-24"]);
  assert.deepEqual(sessionsForChangedTrades(tradeSignatures(moved), moved), [], "the second pass finds nothing new");

  // A brand-new real trade is queued; a sample or a non-MES trade is not.
  const added = [trade(), trade({ id: "t2" }), trade({ id: "t3", is_sample: true } as Partial<TradeRecord>), trade({ id: "t4", symbol: "MNQ" })];
  assert.deepEqual(sessionsForChangedTrades(seen, added), ["2026-11-24", "2026-11-25"], "t2 adds the same sessions, once");
});
