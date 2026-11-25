import test from "node:test";
import assert from "node:assert/strict";
import {
  CACHE_SCHEMA,
  cacheKey,
  cleanCandles,
  loadBarSeries,
  loadSession,
  loadSessions,
  marketDataUrl,
  recentSessionDates,
  sessionWindow,
  volumeIntegrity,
  type BarLoaderDeps,
  type HttpResponseLike,
  type SessionWindow,
} from "../strategy-lab/bars.ts";
import { buildBarSeries } from "../strategy-lab/series.ts";
import type { SourceBar } from "../strategy-lab/types.ts";
import { equityIndexSessionBounds } from "../session.ts";

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
/** Mon 2026-11-30 12:00 UTC: every session through 11-25 is settled, 11-30 is still open. */
const NOW = Date.parse("2026-11-30T12:00:00Z");

function oneMinuteBars(window: SessionWindow, count: number, volume = 100): unknown[] {
  return Array.from({ length: count }, (_, i) => ({
    time: window.from + i * MINUTE_MS,
    open: 5900 + i * 0.25,
    high: 5901 + i * 0.25,
    low: 5899 + i * 0.25,
    close: 5900.5 + i * 0.25,
    volume,
  }));
}

interface Reply { status?: number; body?: unknown }

/** Fetch double: answers from a route function, tracks calls and the peak in flight. */
function routeFetch(route: (url: URL) => Reply | Error) {
  const calls: string[] = [];
  let inFlight = 0;
  let peak = 0;
  const fetch = async (url: string): Promise<HttpResponseLike> => {
    calls.push(url);
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    try {
      await new Promise((resolve) => setTimeout(resolve, 2));
      const reply = route(new URL(url, "http://lab.test"));
      if (reply instanceof Error) throw reply;
      const status = reply.status ?? 200;
      return { ok: status >= 200 && status < 300, status, json: async () => reply.body };
    } finally {
      inFlight -= 1;
    }
  };
  return { fetch, calls, peak: () => peak };
}

/** A 200 answer serving the window's bars at the given base timeframe. */
function okFor(url: URL, baseTimeframe = "1m", count = 5, volume = 100): Reply {
  const from = Date.parse(url.searchParams.get("from") ?? "");
  const to = Date.parse(url.searchParams.get("to") ?? "");
  return {
    body: {
      candles: oneMinuteBars({ date: "", from, to }, count, volume),
      source: "Yahoo Finance",
      ticker: "MES=F",
      baseTimeframe,
    },
  };
}

function memoryCache(seed: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(seed));
  const gets: string[] = [];
  const sets: string[] = [];
  return {
    store,
    gets,
    sets,
    cache: {
      get: async (key: string) => { gets.push(key); return store.get(key); },
      set: async (key: string, value: unknown) => { sets.push(key); store.set(key, value); return true; },
    },
  };
}

test("a session window runs from 18:00 ET the day before to 17:00 ET, 23 hours, in winter and summer time", () => {
  const winter = sessionWindow("2026-11-25");
  assert.equal(new Date(winter.from).toISOString(), "2026-11-24T23:00:00.000Z");
  assert.equal(new Date(winter.to).toISOString(), "2026-11-25T22:00:00.000Z");
  assert.equal(winter.to - winter.from, 23 * HOUR_MS);

  const summer = sessionWindow("2026-07-08");
  assert.equal(new Date(summer.from).toISOString(), "2026-07-07T22:00:00.000Z");
  assert.equal(summer.to - summer.from, 23 * HOUR_MS);

  // Sessions whose evening starts on the night of a DST change still span exactly 23 hours.
  for (const date of ["2026-03-09", "2026-11-02"]) {
    const window = sessionWindow(date);
    assert.equal(window.to - window.from, 23 * HOUR_MS, date);
  }
});

test("the market-data URL asks for MES over the session window, and the loader requests one window per session", async () => {
  const dates = ["2026-11-24", "2026-11-25"];
  const net = routeFetch((url) => okFor(url));
  const loads = await loadSessions(dates, { fetch: net.fetch, cache: memoryCache().cache, now: () => NOW });

  assert.equal(loads.every((load) => load.status === "loaded"), true);
  assert.equal(net.calls.length, 2);
  for (const [index, call] of net.calls.entries()) {
    const url = new URL(call, "http://lab.test");
    assert.equal(url.pathname, "/api/market-data");
    assert.equal(url.searchParams.get("symbol"), "MES");
    const from = Date.parse(url.searchParams.get("from") ?? "");
    const to = Date.parse(url.searchParams.get("to") ?? "");
    assert.equal(to - from, 23 * HOUR_MS, `window ${index}`);
    assert.equal(call, marketDataUrl(sessionWindow(dates[index])));
  }
  assert.equal(marketDataUrl(sessionWindow("2026-11-25"), "https://lab.example").startsWith("https://lab.example/api/market-data?"), true);
});

test("cleaning drops null and non-numeric rows and rows outside the window, and keeps volume zero for the series to grade", () => {
  const window = sessionWindow("2026-11-25");
  const raw = [
    { time: window.from, open: 1, high: 2, low: 0.5, close: 1.5, volume: 0 },
    { time: window.from + MINUTE_MS, open: null, high: 2, low: 0.5, close: 1.5, volume: 10 },
    { time: window.from + 2 * MINUTE_MS, open: 1, high: "2", low: 0.5, close: 1.5, volume: 10 },
    { time: window.to, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
    { time: window.from - MINUTE_MS, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
    null,
    { time: window.from + 3 * MINUTE_MS, open: 1, high: 2, low: 0.5, close: 1.5, volume: null },
  ];
  const { bars, clean } = cleanCandles(raw, window);
  assert.equal(bars.length, 2);
  assert.equal(clean.droppedRows, 3);
  assert.equal(clean.outsideWindow, 2);
  assert.equal(bars[0].volume, 0);
  assert.equal(bars[1].volume, null);

  const series = buildBarSeries("MES", bars as SourceBar[]);
  assert.equal(Number.isNaN(series.volume[0]), true, "volume 0 is missing, not activity");
  assert.equal(Number.isNaN(series.volume[1]), true, "null volume is missing");
});

test("a 5m answer excludes the session with a reason and adds no bars", async () => {
  const memory = memoryCache();
  const load = await loadSession("2026-11-25", {
    fetch: routeFetch((url) => okFor(url, "5m")).fetch,
    cache: memory.cache,
    now: () => NOW,
  });
  assert.equal(load.status, "excluded");
  if (load.status !== "excluded") return;
  assert.equal(load.reason, "not-1m");
  assert.equal(load.baseTimeframe, "5m");
  assert.match(load.detail, /5m/);
  assert.equal(memory.sets.length, 0, "a session that is not 1m is never cached");
});

test("failures become excluded sessions with a reason and never throw", async () => {
  const cases: Array<{ name: string; route: (url: URL) => Reply | Error; reason: string }> = [
    { name: "404 is nothing served", route: () => ({ status: 404 }), reason: "no-data" },
    { name: "502 is an upstream failure", route: () => ({ status: 502, body: {} }), reason: "upstream" },
    { name: "a thrown network error", route: () => new Error("offline"), reason: "upstream" },
    { name: "a body that is not an object", route: () => ({ body: "nope" }), reason: "bad-response" },
    { name: "a body with no candles array", route: () => ({ body: { baseTimeframe: "1m" } }), reason: "bad-response" },
    {
      name: "non-empty candles with no timeframe",
      route: (url) => ({ body: { candles: oneMinuteBars({
        date: "",
        from: Date.parse(url.searchParams.get("from") ?? ""),
        to: Date.parse(url.searchParams.get("to") ?? ""),
      }, 5) } }),
      reason: "bad-response",
    },
  ];
  for (const item of cases) {
    const load = await loadSession("2026-11-25", {
      fetch: routeFetch(item.route).fetch,
      cache: memoryCache().cache,
      now: () => NOW,
    });
    assert.equal(load.status, "excluded", item.name);
    if (load.status === "excluded") assert.equal(load.reason, item.reason, item.name);
  }

  const notJson = await loadSession("2026-11-25", {
    fetch: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad json"); } }),
    cache: memoryCache().cache,
    now: () => NOW,
  });
  assert.equal(notJson.status === "excluded" && notJson.reason, "bad-response");
});

test("an empty 200 for a weekend is no-data, not an error", async () => {
  const empty = await loadSession("2026-11-23", {
    fetch: routeFetch(() => ({ body: { candles: [], source: "Yahoo Finance", baseTimeframe: "1m" } })).fetch,
    cache: memoryCache().cache,
    now: () => NOW,
  });
  assert.equal(empty.status === "excluded" && empty.reason, "no-data");

  const futureShape = await loadSession("2026-11-25", {
    fetch: routeFetch(() => ({ body: { candles: [] } })).fetch,
    cache: memoryCache().cache,
    now: () => NOW,
  });
  assert.equal(futureShape.status === "excluded" && futureShape.reason, "no-data");
});

test("a settled 1m session is cached under the lab key and served from the cache next time", async () => {
  const memory = memoryCache();
  const first = routeFetch((url) => okFor(url, "1m", 5));
  const deps: BarLoaderDeps = { fetch: first.fetch, cache: memory.cache, now: () => NOW };

  const loaded = await loadSession("2026-11-25", deps);
  assert.equal(loaded.status === "loaded" && loaded.source, "network");
  assert.deepEqual(memory.sets, [cacheKey("2026-11-25")]);
  assert.equal(cacheKey("2026-11-25"), "strategy-lab:v1:MES:2026-11-25");
  const stored = memory.store.get(cacheKey("2026-11-25")) as { schema: string; baseTimeframe: string };
  assert.equal(stored.schema, CACHE_SCHEMA);
  assert.equal(stored.baseTimeframe, "1m");

  const second = routeFetch(() => ({ status: 502 }));
  const cached = await loadSession("2026-11-25", { ...deps, fetch: second.fetch });
  assert.equal(cached.status === "loaded" && cached.source, "cache");
  assert.equal(second.calls.length, 0, "a cache hit does not call Yahoo");
  assert.equal(cached.status === "loaded" && cached.bars.length, 5);
});

test("today's session is never read from or written to the cache", async () => {
  const memory = memoryCache();
  const net = routeFetch((url) => okFor(url));
  // 2026-11-30 closes at 22:00 UTC; now is 12:00 UTC, so it is still open.
  const load = await loadSession("2026-11-30", { fetch: net.fetch, cache: memory.cache, now: () => NOW });
  assert.equal(load.status, "loaded");
  assert.equal(memory.sets.length, 0);
  assert.equal(memory.gets.length, 0);
  assert.equal(net.calls.length, 1);
});

test("a corrupt cache entry is a miss and the session is fetched again", async () => {
  const memory = memoryCache({ [cacheKey("2026-11-25")]: { schema: CACHE_SCHEMA, date: "2026-11-25", baseTimeframe: "1m", bars: [{ nope: true }] } });
  const net = routeFetch((url) => okFor(url));
  const load = await loadSession("2026-11-25", { fetch: net.fetch, cache: memory.cache, now: () => NOW });
  assert.equal(load.status === "loaded" && load.source, "network");
  assert.equal(net.calls.length, 1);
});

test("at most three sessions are in flight, results keep their order, and progress counts every session", async () => {
  const dates = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-23", "2026-11-24"];
  const net = routeFetch((url) => okFor(url));
  const progress: Array<[number, number]> = [];
  const loads = await loadSessions(dates, {
    fetch: net.fetch,
    cache: memoryCache().cache,
    now: () => NOW,
    onProgress: (done, total) => progress.push([done, total]),
  });
  assert.equal(net.peak(), 3);
  assert.deepEqual(loads.map((load) => load.date), dates);
  assert.equal(progress.length, dates.length);
  assert.deepEqual(progress.at(-1), [dates.length, dates.length]);
  assert.deepEqual(progress.map(([done]) => done), [1, 2, 3, 4, 5, 6, 7]);
});

test("without an injected cache the loader still works in Node (IndexedDB is absent, so nothing is cached)", async () => {
  const net = routeFetch((url) => okFor(url));
  const loads = await loadSessions(["2026-11-25"], { fetch: net.fetch, now: () => NOW });
  assert.equal(loads[0].status === "loaded" && loads[0].source, "network");
});

test("loadBarSeries keeps loaded sessions only and grades volume for each loaded session", async () => {
  const fiveMinuteFrom = new Date(sessionWindow("2026-11-23").from).toISOString();
  const net = routeFetch((url) => (url.searchParams.get("from") === fiveMinuteFrom ? okFor(url, "5m") : okFor(url)));
  const data = await loadBarSeries(["2026-11-23", "2026-11-24"], { fetch: net.fetch, cache: memoryCache().cache, now: () => NOW });
  const excludedDates = data.loads.filter((load) => load.status === "excluded").map((load) => load.date);
  assert.deepEqual(excludedDates, ["2026-11-23"]);
  assert.equal(data.series.sessions.some((session) => session.date === "2026-11-23"), false);
  assert.equal(data.series.sessions.some((session) => session.date === "2026-11-24"), true);
  assert.deepEqual(data.volume.map((grade) => grade.date), ["2026-11-24"]);
});

test("volume grades: ok at zero missing, degraded at up to 2% of RTH, missing above 2%", () => {
  const date = "2026-11-25";
  const bounds = equityIndexSessionBounds(date);
  const rthMinutes = Array.from({ length: 390 }, (_, i) => bounds.rthOpen + i * MINUTE_MS);
  const build = (missing: Set<number>, zero: Set<number>) => {
    const bars: SourceBar[] = rthMinutes
      .map((time, i) => ({ time, open: 1, high: 2, low: 0.5, close: 1.5, volume: zero.has(i) ? 0 : 100 }))
      .filter((_, i) => !missing.has(i));
    return buildBarSeries("MES", bars);
  };

  const ok = volumeIntegrity(build(new Set(), new Set()), date);
  assert.equal(ok.grade, "ok");
  assert.equal(ok.rthBars, 390);
  assert.equal(ok.volumeMissing, 0);

  const oneZero = volumeIntegrity(build(new Set(), new Set([10])), date);
  assert.equal(oneZero.grade, "degraded");
  assert.equal(oneZero.volumeMissing, 1);

  const oneAbsent = volumeIntegrity(build(new Set([5]), new Set()), date);
  assert.equal(oneAbsent.grade, "degraded");
  assert.equal(oneAbsent.absent, 1);
  assert.equal(oneAbsent.volumeMissing, 1);

  // 8 of 390 is 2.05%, just over the limit.
  const eightMissing = volumeIntegrity(build(new Set([0, 1, 2, 3, 4, 5, 6, 7]), new Set()), date);
  assert.equal(eightMissing.grade, "missing");
  assert.equal(eightMissing.absent, 8);
  assert.equal(volumeIntegrity(build(new Set(), new Set(rthMinutes.map((_, i) => i))), date).grade, "missing");
});

test("recent sessions skip weekends and end on the given session", () => {
  assert.deepEqual(recentSessionDates("2026-11-23", 3), ["2026-11-19", "2026-11-20", "2026-11-23"]);
  assert.deepEqual(recentSessionDates("2026-11-25", 1), ["2026-11-25"]);
  assert.equal(recentSessionDates("2026-11-25", 22).length, 22);
});
