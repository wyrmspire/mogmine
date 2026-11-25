// #176: an in-memory stand-in for the slice of supabase-js the Supabase adapter uses. It mimics the migration:
// `(user_id, id)` keys, generated query columns read from `record`, server-owned millisecond timestamps, RLS
// (rows are visible and writable only for the session user), the cascade backstop and `mogmine_replace_rows`.
import type { DbError, DbResult, DbRow, QueryLike, SupabaseLike } from "../persistence/supabase-adapter.ts";

type Row = DbRow & { id?: string };
type Op = { kind: "select" } | { kind: "upsert"; row: Record<string, unknown>; onConflict: string } | { kind: "update"; patch: Record<string, unknown> } | { kind: "delete" };

const SINGLETON_TABLES = new Set(["mogmine_user_prefs", "mogmine_mood_registries", "mogmine_tag_registries"]);
const CASCADE: Record<string, { table: string; column: string }[]> = {
  mogmine_trades: [
    { table: "mogmine_mood_records", column: "trade_id" },
    { table: "mogmine_drills", column: "trade_id" },
    { table: "mogmine_prompt_dismissals", column: "trade_id" },
  ],
  mogmine_accounts: [{ table: "mogmine_balance_checks", column: "account_id" }],
};

export interface FakeSupabase extends SupabaseLike {
  tables: Map<string, Row[]>;
  signIn(uid: string | null): void;
  /** Make the next request fail with this error (e.g. a network error). */
  failNext(error: DbError): void;
  calls: string[];
}

/** Generated columns: the value of `column` on a row, read from `record` like the migration does. */
function columnValue(row: Row, column: string): unknown {
  if (column in row) return (row as unknown as Record<string, unknown>)[column];
  const record = (row.record ?? {}) as Record<string, unknown>;
  if (column === "is_sample" || column === "archived") return record[column] === true;
  return record[column] ?? null;
}

export function createFakeSupabase(uid: string | null = null): FakeSupabase {
  let session = uid;
  let clock = Date.parse("2026-11-23T00:00:00.000Z");
  let pending: DbError | null = null;
  const tables = new Map<string, Row[]>();
  const calls: string[] = [];
  const rowsOf = (table: string) => {
    if (!tables.has(table)) tables.set(table, []);
    return tables.get(table)!;
  };
  const tick = () => new Date((clock += 1)).toISOString();
  const takeError = () => {
    const error = pending;
    pending = null;
    return error;
  };

  function builder(table: string, op: Op): QueryLike {
    const filters: [string, unknown][] = [];
    const orders: string[] = [];
    let limit: number | undefined;

    const run = (): DbResult<Row[]> => {
      calls.push(`${op.kind} ${table}`);
      const error = takeError();
      if (error) return { data: null, error };
      if (!session) return { data: [], error: null }; // anon: RLS shows nothing
      const all = rowsOf(table);
      const visible = (row: Row) => row.user_id === session && filters.every(([column, value]) => columnValue(row, column) === value);
      if (op.kind === "select") {
        let found = all.filter(visible);
        if (orders.length) found = [...found].sort((a, b) => a.created_at.localeCompare(b.created_at) || String(a.id).localeCompare(String(b.id)));
        if (limit !== undefined) found = found.slice(0, limit);
        return { data: found.map((row) => structuredClone(row)), error: null };
      }
      if (op.kind === "upsert") {
        const row = op.row;
        if (row.user_id !== session) return { data: null, error: { code: "42501", message: "new row violates row-level security policy" } };
        const at = tick();
        const keyMatch = (existing: Row) => existing.user_id === row.user_id && (SINGLETON_TABLES.has(table) || existing.id === row.id);
        const existing = all.find(keyMatch);
        if (existing) {
          existing.record = structuredClone(row.record);
          existing.updated_at = at;
          return { data: [structuredClone(existing)], error: null };
        }
        const created: Row = { ...(structuredClone(row) as unknown as Row), created_at: at, updated_at: at };
        all.push(created);
        return { data: [structuredClone(created)], error: null };
      }
      if (op.kind === "update") {
        const hit = all.filter(visible);
        const at = tick();
        for (const row of hit) {
          row.record = structuredClone(op.patch.record);
          row.updated_at = at;
        }
        return { data: hit.map((row) => structuredClone(row)), error: null };
      }
      const gone = all.filter(visible);
      tables.set(table, all.filter((row) => !gone.includes(row)));
      for (const row of gone) {
        for (const child of CASCADE[table] ?? []) {
          tables.set(child.table, rowsOf(child.table).filter((item) => !(item.user_id === row.user_id && columnValue(item, child.column) === row.id)));
        }
      }
      return { data: gone.map((row) => ({ ...row })), error: null };
    };

    const query: QueryLike = {
      select: () => query,
      eq(column, value) {
        filters.push([column, value]);
        return query;
      },
      order(column) {
        orders.push(column);
        return query;
      },
      limit(count) {
        limit = count;
        return query;
      },
      maybeSingle() {
        const result = run();
        if (result.error) return Promise.resolve({ data: null, error: result.error });
        const rows = result.data ?? [];
        if (rows.length > 1) return Promise.resolve({ data: null, error: { code: "PGRST116", message: "multiple rows" } });
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      then(onfulfilled, onrejected) {
        return Promise.resolve(run()).then(onfulfilled, onrejected);
      },
    };
    return query;
  }

  return {
    tables,
    calls,
    signIn(next) {
      session = next;
    },
    failNext(error) {
      pending = error;
    },
    auth: {
      async getSession() {
        return { data: { session: session ? { user: { id: session } } : null } };
      },
    },
    from(table) {
      return {
        select: () => builder(table, { kind: "select" }),
        upsert: (row, options) => builder(table, { kind: "upsert", row, onConflict: options.onConflict }),
        update: (patch) => builder(table, { kind: "update", patch }),
        delete: () => builder(table, { kind: "delete" }),
      };
    },
    async rpc(fn, args) {
      calls.push(`rpc ${fn}`);
      const error = takeError();
      if (error) return { data: null, error };
      if (!session) return { data: null, error: { code: "42501", message: "not signed in" } };
      if (fn !== "mogmine_replace_rows") return { data: null, error: { code: "PGRST202", message: "no such function" } };
      const table = String(args.p_table);
      if (!table.startsWith("mogmine_")) return { data: null, error: { code: "22023", message: "not a mogmine collection table" } };
      const at = tick();
      const kept = rowsOf(table).filter((row) => row.user_id !== session);
      const added = (args.p_rows as Record<string, unknown>[]).map((record) => ({ user_id: session!, id: String(record.id), record: structuredClone(record), created_at: at, updated_at: at }));
      tables.set(table, [...kept, ...added]);
      return { data: null, error: null };
    },
  };
}
