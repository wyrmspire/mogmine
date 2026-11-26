// SL-15a: Strategy Lab persistence (docs/design-2026-11-24/09 §11, docs/26 D-012). Local compact runs (latest 25)
// and `mogmine_strategy_recipes` / `mogmine_strategy_runs` through a narrow client. The Supabase SDK loads lazily,
// only when NEXT_PUBLIC_PERSISTENCE_ADAPTER is "supabase". Expected failures return PersistResult; nothing throws.
import type { PersistError, PersistErrorCode, PersistResult } from "../persistence/contract.ts";
import { mapDbError, type DbError } from "../persistence/supabase-adapter.ts";
import { validateRecipe } from "./recipe.ts";
import type { SkillRegistry } from "./registry.ts";
import { SKILLS } from "./registry.ts";
import type { Match, OutcomeExitReason, Recipe, RunResult, Value } from "./types.ts";

export const RUN_STORE_KEY = "mogmine-strategy-lab-runs-v1";
export const RUN_STORE_LIMIT = 25;
export const RECIPES_TABLE = "mogmine_strategy_recipes";
export const RUNS_TABLE = "mogmine_strategy_runs";

/** Aggregates only. Shape from RunResult minus `recipe`, `overlays`, `matches` (matches are stored separately). */
export interface PersistedRunSummary {
  data: RunResult["data"];
  candidates: number;
  skips: RunResult["skips"];
  stats: RunResult["stats"];
  splits: RunResult["splits"];
  separators: RunResult["separators"];
  timeOfDay: RunResult["timeOfDay"];
  ms: number;
}

export interface PersistedRun {
  id: string;
  recipeId: string;
  recipeVersion: number;
  /** Account the R size came from, or null for the default risk budget. Stored inside the remote `summary`. */
  accountName: string | null;
  /** ISO-8601 UTC. */
  createdAt: string;
  summary: PersistedRunSummary;
  matches: Match[];
}

export interface PersistedRunMeta {
  id: string;
  /** ISO-8601 UTC or epoch ms. */
  createdAt: string | number;
  accountName?: string | null;
}

// Sanitizing helpers

export const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
/** A finite number, or NaN. */
const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : NaN);
const nonEmpty = (value: unknown): string | null => (typeof value === "string" && value.length >= 1 && value.length <= 200 ? value : null);
const EXIT_REASONS: readonly OutcomeExitReason[] = ["target", "stop", "time", "session-end", "ambiguous-stop"];

/** Deep copy that is safe to JSON-store: NaN and Infinity become null, undefined and functions disappear. */
export function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, v) => (typeof v === "number" && !Number.isFinite(v) ? null : v))) as T;
}

/** One compact match, or null when a required number is missing. Features keep only scalars (NaN becomes null). */
export function sanitizeMatch(raw: unknown): Match | null {
  if (!isObject(raw) || !isObject(raw.outcome)) return null;
  const o = raw.outcome;
  const exitReason = EXIT_REASONS.find((reason) => reason === o.exitReason);
  const required = [raw.i, raw.time, raw.entry, raw.stop, raw.target, raw.qty, o.exitTime, o.pnlPoints, o.pnlUsd,
    o.resultR, o.riskMultiple, o.mfePoints, o.maePoints, o.mfeR, o.maeR, o.minutesToExit].map(num);
  if (!exitReason || typeof raw.sessionDate !== "string" || !required.every(Number.isFinite)) return null;
  const features: Record<string, Value> = {};
  for (const [key, value] of Object.entries(isObject(raw.features) ? raw.features : {})) {
    if (typeof value === "number") features[key] = Number.isFinite(value) ? value : null;
    else if (typeof value === "string" || typeof value === "boolean" || value === null) features[key] = value;
  }
  const [i, time, entry, stop, target, qty, exitTime, pnlPoints, pnlUsd, resultR, riskMultiple, mfePoints, maePoints, mfeR, maeR, minutesToExit] = required;
  const minutesToTarget = num(o.minutesToTarget);
  return {
    i, time, sessionDate: raw.sessionDate, entry, stop, target, qty,
    oversized: raw.oversized === true, features,
    outcome: {
      exitReason, exitTime, pnlPoints, pnlUsd, resultR, riskMultiple, mfePoints, maePoints, mfeR, maeR, minutesToExit,
      minutesToTarget: Number.isFinite(minutesToTarget) ? minutesToTarget : null,
    },
  };
}

/** Keeps only the aggregate fields. Unknown keys (overlays, per-bar arrays) are dropped here. */
function sanitizeSummary(raw: unknown): PersistedRunSummary | null {
  if (!isObject(raw) || !isObject(raw.data) || !isObject(raw.stats)) return null;
  const list = (value: unknown) => (Array.isArray(value) ? value : []);
  const count = (value: unknown) => (Number.isFinite(num(value)) ? num(value) : 0);
  return jsonSafe({
    data: raw.data,
    candidates: count(raw.candidates),
    skips: isObject(raw.skips) ? raw.skips : {},
    stats: raw.stats,
    splits: list(raw.splits),
    separators: list(raw.separators),
    timeOfDay: list(raw.timeOfDay),
    ms: count(raw.ms),
  }) as unknown as PersistedRunSummary;
}

/** Compact form of a finished run: aggregates plus compact matches. Returns null when the run cannot be stored. */
export function toPersistedRun(result: RunResult, meta: PersistedRunMeta): PersistedRun | null {
  const createdAt = typeof meta.createdAt === "number" ? new Date(meta.createdAt).toISOString() : meta.createdAt;
  return fromPersistedRun({
    id: meta.id,
    recipeId: result.recipe.id,
    recipeVersion: result.recipe.version,
    accountName: meta.accountName ?? null,
    createdAt,
    summary: { ...result },
    matches: result.matches,
  });
}

/** Sanitize a stored or incoming run. Returns null for anything that is not a complete, valid run. */
export function fromPersistedRun(raw: unknown): PersistedRun | null {
  if (!isObject(raw)) return null;
  const id = nonEmpty(raw.id);
  const recipeId = nonEmpty(raw.recipeId);
  const createdMs = typeof raw.createdAt === "string" ? Date.parse(raw.createdAt) : NaN;
  const summary = sanitizeSummary(raw.summary);
  if (!id || !recipeId || !Number.isInteger(raw.recipeVersion) || (raw.recipeVersion as number) < 1) return null;
  if (!Number.isFinite(createdMs) || !summary || !Array.isArray(raw.matches)) return null;
  const matches = raw.matches.flatMap((match) => sanitizeMatch(match) ?? []);
  const accountName = typeof raw.accountName === "string" ? raw.accountName : null;
  return {
    id, recipeId, recipeVersion: raw.recipeVersion as number, accountName,
    createdAt: new Date(createdMs).toISOString(), summary, matches,
  };
}

// Local run storage (device only). Never throws on bad JSON; a bad entry drops only itself.

export interface RunStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }

function newestFirst(runs: readonly PersistedRun[]): PersistedRun[] {
  return [...runs].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, RUN_STORE_LIMIT);
}

export function loadLocalRuns(storage: RunStorage | null | undefined): PersistedRun[] {
  try {
    const raw = storage?.getItem(RUN_STORE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    const list = isObject(parsed) && Array.isArray(parsed.runs) ? parsed.runs : [];
    return newestFirst(list.flatMap((run) => fromPersistedRun(run) ?? []));
  } catch {
    return [];
  }
}

/** Add or replace one run (by id), keep the latest RUN_STORE_LIMIT, and return the stored list. */
export function saveLocalRun(storage: RunStorage | null | undefined, run: PersistedRun): PersistResult<PersistedRun[]> {
  const clean = fromPersistedRun(run);
  if (!clean) return labFail("invalid", "This run did not pass validation.", run?.id);
  const kept = loadLocalRuns(storage).filter((existing) => existing.id !== clean.id);
  const runs = newestFirst([clean, ...kept]);
  try {
    storage?.setItem(RUN_STORE_KEY, JSON.stringify({ runs }));
    return { ok: true, value: runs };
  } catch (error) {
    return labFail("unavailable", "This device could not save the run. The run is still on screen.", clean.id, errorName(error));
  }
}

// Remote repositories (Supabase). Narrow structural client; the browser client satisfies it.

/** The slice of a PostgREST builder the lab uses. `@supabase/supabase-js` satisfies it structurally. */
export interface LabQueryLike extends PromiseLike<{ data: unknown; error: DbError | null }> {
  select(columns?: string): LabQueryLike;
  eq(column: string, value: string | number | boolean): LabQueryLike;
  gte(column: string, value: string): LabQueryLike;
  lt(column: string, value: string): LabQueryLike;
  order(column: string, options?: { ascending?: boolean }): LabQueryLike;
  limit(count: number): LabQueryLike;
  upsert(row: Record<string, unknown>, options: { onConflict: string }): LabQueryLike;
  delete(): LabQueryLike;
}

export interface LabSupabaseClientLike {
  auth: { getSession(): Promise<{ data: { session: { user: { id: string } } | null } }> };
  from(table: string): LabQueryLike;
}

export type LabClientOption = LabSupabaseClientLike | (() => LabSupabaseClientLike | Promise<LabSupabaseClientLike>);

export function labFail<T = never>(code: PersistErrorCode, message: string, id?: string, cause?: string): PersistResult<T> {
  const error: PersistError = { code, message, id, cause };
  return { ok: false, error };
}

const errorName = (error: unknown): string => (error instanceof Error ? error.name : "unknown");

/** True when the browser is configured to use the Supabase adapter (the only time the default client loads). */
export function supabaseAdapterOn(): boolean {
  return process.env.NEXT_PUBLIC_PERSISTENCE_ADAPTER === "supabase";
}

/** An injected client wins. Otherwise the browser client loads lazily, only when the adapter is "supabase". */
export async function resolveLabClient(client?: LabClientOption): Promise<LabSupabaseClientLike | null> {
  if (client) return typeof client === "function" ? await client() : client;
  if (!supabaseAdapterOn()) return null;
  const mod = await import("../persistence/supabase-client.ts");
  return mod.getBrowserSupabaseClient() as unknown as LabSupabaseClientLike;
}

/** Run `body` with a client and the signed-in user id. Maps every failure to a typed PersistResult. */
export async function withLabSession<T>(
  client: LabClientOption | undefined,
  body: (db: LabSupabaseClientLike, uid: string) => Promise<PersistResult<T>>,
): Promise<PersistResult<T>> {
  try {
    const db = await resolveLabClient(client);
    if (!db) return labFail("unavailable", "Strategy Lab sync is off on this device.");
    const { data } = await db.auth.getSession();
    const uid = data.session?.user.id;
    if (!uid) return labFail("unauthenticated", "Sign in to sync your Strategy Lab.");
    return await body(db, uid);
  } catch (error) {
    return labFail("unavailable", "Could not reach the journal server. Try again.", undefined, errorName(error));
  }
}

/** A `mogmine_strategy_runs` row (snake_case) as a PersistedRun. The account name rides inside `summary`. */
function runFromRow(row: unknown): PersistedRun | null {
  if (!isObject(row)) return null;
  const summary = isObject(row.summary) ? row.summary : {};
  return fromPersistedRun({
    id: row.id, recipeId: row.recipe_id, recipeVersion: row.recipe_version, accountName: summary.accountName,
    createdAt: row.created_at, summary, matches: row.matches,
  });
}

export interface StrategyLabRemoteRepo {
  listRecipes(registry?: SkillRegistry): Promise<PersistResult<Recipe[]>>;
  putRecipe(recipe: Recipe, registry?: SkillRegistry): Promise<PersistResult<Recipe>>;
  removeRecipe(recipeId: string): Promise<PersistResult<void>>;
  listRuns(limit?: number): Promise<PersistResult<PersistedRun[]>>;
  putRun(run: PersistedRun): Promise<PersistResult<PersistedRun>>;
}

/** `client` (optional) is injected for tests or callers that hold one; it skips the adapter gate. */
export function createStrategyLabRemoteRepo(options: { client?: LabClientOption } = {}): StrategyLabRemoteRepo {
  const session = <T>(body: (db: LabSupabaseClientLike, uid: string) => Promise<PersistResult<T>>) =>
    withLabSession<T>(options.client, body);

  return {
    listRecipes(registry = SKILLS) {
      return session(async (db, uid) => {
        const { data, error } = await db.from(RECIPES_TABLE).select("record,version").eq("user_id", uid).order("id", { ascending: true });
        if (error) return mapDbError(error);
        const rows = Array.isArray(data) ? data : [];
        const recipes = rows.flatMap((row) => {
          if (!isObject(row)) return [];
          const checked = validateRecipe(row.record, registry);
          return checked.ok ? [checked.recipe] : [];
        });
        return { ok: true, value: recipes };
      });
    },

    putRecipe(recipe, registry = SKILLS) {
      return session(async (db, uid) => {
        const checked = validateRecipe(recipe, registry);
        if (!checked.ok) return labFail("invalid", checked.errors.map((issue) => `${issue.path}: ${issue.message}`).join("; ").slice(0, 300));
        const saved = checked.recipe;
        const { error } = await db.from(RECIPES_TABLE).upsert(
          { user_id: uid, id: saved.id, version: saved.version, playbook_id: saved.playbookId, record: saved },
          { onConflict: "user_id,id,version" },
        );
        if (error) return mapDbError(error, undefined, saved.id);
        return { ok: true, value: saved };
      });
    },

    removeRecipe(recipeId) {
      return session(async (db, uid) => {
        if (!nonEmpty(recipeId)) return labFail("invalid", "This recipe has no id.");
        const { error } = await db.from(RECIPES_TABLE).delete().eq("user_id", uid).eq("id", recipeId);
        if (error) return mapDbError(error, undefined, recipeId);
        return { ok: true, value: undefined };
      });
    },

    listRuns(limit = RUN_STORE_LIMIT) {
      return session(async (db, uid) => {
        const cap = Math.min(Math.max(Math.trunc(limit), 1), 100);
        const { data, error } = await db.from(RUNS_TABLE)
          .select("id,recipe_id,recipe_version,summary,matches,created_at")
          .eq("user_id", uid)
          .order("created_at", { ascending: false })
          .limit(cap);
        if (error) return mapDbError(error);
        const rows = Array.isArray(data) ? data : [];
        return { ok: true, value: rows.flatMap((row) => runFromRow(row) ?? []) };
      });
    },

    putRun(run) {
      return session(async (db, uid) => {
        const clean = fromPersistedRun(run);
        if (!clean) return labFail("invalid", "This run did not pass validation.", run?.id);
        const row = {
          user_id: uid,
          id: clean.id,
          recipe_id: clean.recipeId,
          recipe_version: clean.recipeVersion,
          summary: { ...clean.summary, accountName: clean.accountName },
          matches: clean.matches,
          created_at: clean.createdAt,
        };
        const { error } = await db.from(RUNS_TABLE).upsert(row, { onConflict: "user_id,id" });
        if (error) return mapDbError(error, undefined, clean.id);
        return { ok: true, value: clean };
      });
    },
  };
}
