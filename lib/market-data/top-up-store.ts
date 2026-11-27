// Server only. The Supabase side of the archive top-up. Uses the service-role key, which never leaves the server.
import { createClient } from "@supabase/supabase-js";
import { TOP_UP_SYMBOL, type TopUpStore } from "./top-up.ts";

const BATCH = 1000;

function check<T>(response: { data: T; error: { message: string } | null }, what: string): T {
  if (response.error) throw new Error(`Archive ${what} failed: ${response.error.message}`);
  return response.data;
}

/** `null` when the server has no Supabase URL or service-role key. */
export function createTopUpStore(): TopUpStore | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const candles = () => db.from("mogmine_market_candles");

  return {
    async lastCandleTs() {
      const rows = check(await candles().select("ts").eq("symbol", TOP_UP_SYMBOL).eq("timeframe", "1m")
        .order("ts", { ascending: false }).limit(1), "latest-bar read");
      return rows?.[0]?.ts ?? null;
    },
    async contractAsOf(sessionDate) {
      const rows = check(await db.from("mogmine_market_rolls").select("to_contract").eq("symbol", TOP_UP_SYMBOL)
        .lte("session_date", sessionDate).order("session_date", { ascending: false }).limit(1), "roll read");
      return rows?.[0]?.to_contract ?? null;
    },
    async databentoSessions(fromSession) {
      const rows = check(await db.from("mogmine_market_coverage").select("session_date").eq("symbol", TOP_UP_SYMBOL)
        .eq("timeframe", "1m").eq("source", "databento").gte("session_date", fromSession), "coverage read");
      return new Set((rows ?? []).map((row) => String(row.session_date)));
    },
    async databentoCloses(fromIso) {
      const rows = check(await candles().select("ts,close").eq("symbol", TOP_UP_SYMBOL).eq("timeframe", "1m")
        .eq("source", "databento").gte("ts", fromIso).order("ts", { ascending: true }).limit(BATCH), "seam read");
      return (rows ?? []).map((row) => ({ ts: String(row.ts), close: Number(row.close) }));
    },
    async upsertCandles(rows) {
      // The database trigger keeps any Databento row unchanged.
      for (let i = 0; i < rows.length; i += BATCH) {
        check(await candles().upsert(rows.slice(i, i + BATCH), { onConflict: "symbol,timeframe,ts" }), "bar write");
      }
    },
    async upsertCoverage(sessionDate, receivedBars) {
      check(await db.from("mogmine_market_coverage").upsert({
        symbol: TOP_UP_SYMBOL, timeframe: "1m", session_date: sessionDate, expected_bars: null,
        received_bars: receivedBars, missing_ranges: [], status: "partial", source: "yahoo_finance",
        updated_at: new Date().toISOString(),
      }, { onConflict: "symbol,timeframe,session_date" }), "coverage write");
    },
    async upsertRoll(row) {
      check(await db.from("mogmine_market_rolls").upsert(row, { onConflict: "symbol,session_date" }), "roll write");
    },
    async startJob(rangeFrom, rangeTo) {
      const row = check(await db.from("mogmine_market_archive_jobs").insert({
        kind: "daily", source: "yahoo_finance", symbol: TOP_UP_SYMBOL, timeframe: "1m",
        range_from: rangeFrom, range_to: rangeTo, status: "started",
      }).select("id").single(), "job start");
      return String(row?.id);
    },
    async finishJob(id, { status, bars, result, error }) {
      check(await db.from("mogmine_market_archive_jobs").update({
        finished_at: new Date().toISOString(), status, bars_upserted: bars, result, last_error: error ?? null,
      }).eq("id", id), "job finish");
    },
  };
}
