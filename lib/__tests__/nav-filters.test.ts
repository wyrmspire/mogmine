// Trading-day navigation and Feed URL filters (NAV-1). Pure selectors only: no DOM, no store.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyFilters,
  describeFilterParts,
  describeFilters,
  filtersToQuery,
  parseFilters,
  parseSessionDateParam,
  resolveViewedDate,
  stepRegularSessionDate,
} from "../selectors.ts";
import type { FeedFilters } from "../selectors.ts";
import { normalizeTrade } from "../trades.ts";
import type { TradeRecord } from "../trades.ts";

const base = { symbol: "MES", direction: "LONG" as const, exit_time: "2026-11-20T16:00:00.000Z", entry_price: 7500, exit_price: 7502 };

function trade(id: string, patch: Partial<TradeRecord> & { entry_time: string }): TradeRecord {
  return normalizeTrade({ ...base, id, ...patch });
}

// Entries are 10:00 ET on their day, well inside one regular session.
const fixtures: TradeRecord[] = [
  trade("scalp-sweep", { entry_time: "2026-11-20T15:00:00.000Z", playbook_id: "orb-reclaim", quick_tags: ["Level Sweep", "A+ Patience"], account_id: "acct-main" }),
  trade("chased", { entry_time: "2026-11-20T15:30:00.000Z", playbook_id: "orb-reclaim", quick_tags: ["Chased Entry"], account_id: "acct-main" }),
  trade("onl-sweep", { entry_time: "2026-11-23T15:00:00.000Z", playbook_id: "onl-sweep-smt", quick_tags: ["Level Sweep"], account_id: null }),
  trade("no-playbook", { entry_time: "2026-11-23T16:00:00.000Z", playbook_id: null, quick_tags: [], account_id: null }),
];

const EMPTY: FeedFilters = { status: "all", date: null, account: null, playbook: null, tag: null };

test("parseFilters returns explicit nulls for an empty URL, and filtersToQuery of the default is empty", () => {
  assert.deepEqual(parseFilters(new URLSearchParams()), EMPTY);
  assert.equal(filtersToQuery({ status: "all" }), "");
  assert.equal(filtersToQuery(EMPTY), "");
});

test("parseFilters and filtersToQuery round-trip every filter, including the sentinel values", () => {
  const cases: FeedFilters[] = [
    { ...EMPTY, status: "unreviewed" },
    { ...EMPTY, status: "flagged" },
    { ...EMPTY, date: "2026-11-20" },
    { ...EMPTY, account: "acct-main" },
    { ...EMPTY, account: "unassigned" },
    { ...EMPTY, playbook: "orb-reclaim" },
    { ...EMPTY, playbook: "none" },
    { ...EMPTY, tag: "Level Sweep" },
    { ...EMPTY, tag: "no-setup-tag" },
    { status: "unreviewed", date: "2026-11-20", account: "acct-main", playbook: "orb-reclaim", tag: "Level Sweep" },
  ];
  for (const filters of cases) {
    const query = filtersToQuery(filters);
    assert.deepEqual(parseFilters(new URLSearchParams(query.slice(1))), filters, query);
  }
});

test("the Lab's deep link encodes a multi-word tag and parses back exactly", () => {
  const query = filtersToQuery({ playbook: "orb-reclaim", tag: "Level Sweep" });
  assert.equal(query, "?playbook=orb-reclaim&tag=Level+Sweep");
  const parsed = parseFilters(new URLSearchParams("playbook=orb-reclaim&tag=Level%20Sweep"));
  assert.equal(parsed.playbook, "orb-reclaim");
  assert.equal(parsed.tag, "Level Sweep");
});

test("invalid session dates in the URL are dropped rather than matching nothing", () => {
  assert.equal(parseFilters(new URLSearchParams("date=2026-02-30")).date, null);
  assert.equal(parseFilters(new URLSearchParams("date=Nov-20")).date, null);
  assert.equal(parseFilters(new URLSearchParams("date=2026-11-20")).date, "2026-11-20");
  assert.equal(parseSessionDateParam("2024-02-29"), "2024-02-29");
});

test("the deep link /feed?playbook=orb-reclaim&tag=Level%20Sweep returns exactly the matching subset", () => {
  const filters = parseFilters(new URLSearchParams("playbook=orb-reclaim&tag=Level%20Sweep"));
  assert.deepEqual(applyFilters(fixtures, filters).map((item) => item.id), ["scalp-sweep"]);
});

test("date matches the trade's session date from entry_time", () => {
  assert.deepEqual(applyFilters(fixtures, { ...EMPTY, date: "2026-11-20" }).map((item) => item.id), ["scalp-sweep", "chased"]);
  assert.deepEqual(applyFilters(fixtures, { ...EMPTY, date: "2026-11-23" }).map((item) => item.id), ["onl-sweep", "no-playbook"]);
});

test("playbook=none and account=unassigned match trades with a null id", () => {
  assert.deepEqual(applyFilters(fixtures, { ...EMPTY, playbook: "none" }).map((item) => item.id), ["no-playbook"]);
  assert.deepEqual(applyFilters(fixtures, { ...EMPTY, account: "unassigned" }).map((item) => item.id), ["onl-sweep", "no-playbook"]);
  assert.deepEqual(applyFilters(fixtures, { ...EMPTY, account: "acct-main" }).map((item) => item.id), ["scalp-sweep", "chased"]);
});

test("tag=no-setup-tag matches trades with no SETUP_TAGS, so it lines up with the Lab's gap count", () => {
  // "Chased Entry" and "A+ Patience" are execution tags; "Level Sweep" is a setup tag.
  assert.deepEqual(applyFilters(fixtures, { ...EMPTY, tag: "no-setup-tag" }).map((item) => item.id), ["chased", "no-playbook"]);
});

test("stepRegularSessionDate skips weekends in both directions", () => {
  assert.equal(stepRegularSessionDate("2026-11-20", 1), "2026-11-23", "Friday +1 is Monday");
  assert.equal(stepRegularSessionDate("2026-11-23", -1), "2026-11-20", "Monday -1 is Friday");
  assert.equal(stepRegularSessionDate("2026-11-25", 1), "2026-11-26", "Wednesday +1 is Thursday");
  assert.equal(stepRegularSessionDate("2026-11-24", -1), "2026-11-23", "Tuesday -1 is Monday");
  assert.equal(stepRegularSessionDate("2026-11-21", 1), "2026-11-23", "Saturday +1 is Monday");
  assert.equal(stepRegularSessionDate("2026-11-23", -1), "2026-11-20", "Monday -1 skips Sunday and Saturday");
});

test("resolveViewedDate falls back to today for missing, malformed or future dates", () => {
  const today = "2026-11-25";
  assert.equal(resolveViewedDate(null, today), today);
  assert.equal(resolveViewedDate("garbage", today), today);
  assert.equal(resolveViewedDate("2026-12-01", today), today, "a future day is not viewable");
  assert.equal(resolveViewedDate("2026-11-20", today), "2026-11-20");
});

test("describeFilters reads as plain language", () => {
  assert.equal(describeFilters({ ...EMPTY, playbook: "orb-reclaim", tag: "Level Sweep" }), "ORB Reclaim · Level Sweep");
  assert.equal(describeFilters(EMPTY), "All trades");
  assert.equal(describeFilters({ ...EMPTY, status: "unreviewed" }), "Needs review");
  assert.equal(describeFilters({ ...EMPTY, playbook: "none", tag: "no-setup-tag" }), "No playbook · No setup tag");
  assert.equal(describeFilters({ ...EMPTY, date: "2026-11-20" }), "Fri, Nov 20");
  assert.equal(
    describeFilters({ ...EMPTY, account: "acct-main" }, { accountName: (id) => (id === "acct-main" ? "Main" : null) }),
    "Main",
  );
});

test("describeFilterParts keeps the filter key so each chip can remove itself", () => {
  const parts = describeFilterParts({ status: "flagged", date: null, account: "unassigned", playbook: "orb-reclaim", tag: "Level Sweep" });
  assert.deepEqual(parts.map((part) => part.key), ["status", "account", "playbook", "tag"]);
  assert.equal(parts.find((part) => part.key === "account")?.label, "Unassigned");
});
