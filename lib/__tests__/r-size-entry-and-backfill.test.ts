// RS-4: the stated-risk entry helpers, and the R-size backfill over mocked (in-memory) repositories only.
// Nothing here touches a real account, Supabase or /api/v1.
import test from "node:test";
import assert from "node:assert/strict";
import { createLocalAdapter, createMemoryCandleStore, createMemoryKeyValueStore } from "../persistence/local-adapter.ts";
import { makeAccount } from "../accounts.ts";
import { normalizeTrade, DEFAULT_OWNER_USER_ID } from "../trades.ts";
import type { TradeRecord } from "../trades.ts";
import { freshEntryDraft, statedRiskError, suggestedStopFromRiskR, upgradeDraft } from "../entry-form.ts";
// @ts-expect-error the backfill script is plain .mjs with no declaration file
import { parseCsv, proposeStatedRiskFromNotes, runBackfillApply, runBackfillDryRun, toCsv } from "../../scripts/r-size-backfill.mjs";

const NOW = new Date("2026-11-25T14:00:00Z");

test("suggestedStopFromRiskR: 1 MES LONG at 7137.00 with $300 R and 0.25R is $75 = 15 pts = 7122.00", () => {
  assert.equal(suggestedStopFromRiskR(7137, "LONG", "MES", 1, 30000, 0.25), 7122);
  // SHORT mirrors it above entry.
  assert.equal(suggestedStopFromRiskR(7137, "SHORT", "MES", 1, 30000, 0.25), 7152);
  // Contracts scale the points down: 2 MES at $75 is 7.5 pts.
  assert.equal(suggestedStopFromRiskR(7137, "LONG", "MES", 2, 30000, 0.25), 7129.5);
});

test("suggestedStopFromRiskR: rounds away from entry on the tick grid and refuses bad inputs", () => {
  // 0.26R on $300 is $78 = 15.6 pts = 62.4 ticks, so the stop moves one more tick away from entry: 15.75 pts.
  assert.equal(suggestedStopFromRiskR(7137, "LONG", "MES", 1, 30000, 0.26), 7121.25);
  assert.equal(suggestedStopFromRiskR(7137.1, "LONG", "MES", 1, 30000, 0.25), null, "off-tick entry");
  assert.equal(suggestedStopFromRiskR(7137, "LONG", "MES", 0, 30000, 0.25), null, "zero contracts");
  assert.equal(suggestedStopFromRiskR(7137, "LONG", "NOPE", 1, 30000, 0.25), null, "unknown symbol");
  assert.equal(suggestedStopFromRiskR(7137, "LONG", "MES", 1, 30000, 0), null, "zero R");
});

test("stated risk text: empty is fine, 0.01 to 10 with at most two decimals is valid", () => {
  assert.equal(statedRiskError(""), undefined);
  assert.equal(statedRiskError("0.25"), undefined);
  assert.equal(statedRiskError("10"), undefined);
  assert.ok(statedRiskError("11"));
  assert.ok(statedRiskError("0.255"));
  assert.ok(statedRiskError("abc"));
});

test("upgradeDraft keeps statedRiskR and defaults a missing one to empty", () => {
  const kept = upgradeDraft({ status: "closed", symbol: "MES", statedRiskR: "0.5" }, NOW, "America/Chicago");
  assert.equal(kept.statedRiskR, "0.5");
  const missing = upgradeDraft({ status: "closed", symbol: "MES", entryPrice: "7137" }, NOW, "America/Chicago");
  assert.equal(missing.statedRiskR, "");
  assert.equal(freshEntryDraft(NOW, "America/Chicago").statedRiskR, "");
});

test("proposeStatedRiskFromNotes: reads R amounts from notes as a proposal, and reports null with no R mention", () => {
  assert.deepEqual(proposeStatedRiskFromNotes({ note: "Risked $75 = 0.25R on ORB" }), { proposed_stated_risk_r: 0.25, notes_have_risk_text: true });
  assert.deepEqual(proposeStatedRiskFromNotes({ post_exit_notes: "stopped at .5 R, fine" }), { proposed_stated_risk_r: 0.5, notes_have_risk_text: true });
  assert.equal(proposeStatedRiskFromNotes({ note: "held the shelf, no stop moves" }), null);
  // Two different amounts are ambiguous: flagged, but no proposal.
  assert.deepEqual(proposeStatedRiskFromNotes({ note: "0.25R then 0.5R", management_notes: "" }), { proposed_stated_risk_r: null, notes_have_risk_text: true });
});

// ── Backfill over in-memory repositories ─────────────────────────────────────────────────────────────

const OWNER = DEFAULT_OWNER_USER_ID;
const NOTE_FIELDS = ["note", "pre_trade_thesis", "management_notes", "post_exit_notes"] as const;

/** A fresh in-memory adapter; `updated_at` advances on every write so concurrency checks mean something. */
function memoryRepos() {
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 10, 25, 12, 0, 0) + ++tick * 1000).toISOString();
  const adapter = createLocalAdapter({ kind: "mock", store: createMemoryKeyValueStore(), candles: createMemoryCandleStore(), owner: OWNER, now });
  const puts: string[] = [];
  const base = adapter.repositories;
  const repos = { ...base, trades: { ...base.trades, put: async (owner: string, record: TradeRecord, options?: { expectedUpdatedAt?: string }) => { puts.push(record.id); return base.trades.put(owner, record, options); } } };
  return { repos, base, puts };
}

const trade = (over: Record<string, unknown>) => normalizeTrade({
  id: "t", symbol: "MES", direction: "LONG", quantity: 1,
  entry_time: "2026-11-24T15:00:00Z", exit_time: "2026-11-24T15:30:00Z",
  entry_price: 7137, exit_price: 7137, stop_loss_price: null,
  ...over,
} as Parameters<typeof normalizeTrade>[0]);

/** A's account has $300 R; B has no account (default $250, prefs null); C is a sample; D has no stop. */
async function seed(base: ReturnType<typeof memoryRepos>["base"]) {
  const account = makeAccount({ id: "acct-1", name: "SIM Eval 50K", starting_balance_cents: 5_000_000, now: "2026-11-01T00:00:00Z", r_size_cents: 30000 });
  assert.ok((await base.accounts.put(OWNER, account)).ok);
  const rows = [
    trade({ id: "A", account_id: "acct-1", entry_price: 7137, stop_loss_price: 7119.5, exit_price: 7174, note: "Risked $75 = 0.25R on ORB", pre_trade_thesis: "ORB, 0.25R", management_notes: "", post_exit_notes: "stop held" }),
    trade({ id: "B", entry_price: 7137, stop_loss_price: 7122, exit_price: 7147, note: "held the shelf" }),
    trade({ id: "C", is_sample: true, entry_price: 7137, stop_loss_price: 7122, exit_price: 7127, note: "fixture" }),
    trade({ id: "D", entry_price: 7137, exit_price: 7140, stop_loss_price: null, note: "no stop, scalp" }),
  ];
  for (const row of rows) assert.ok((await base.trades.put(OWNER, row)).ok, `seed ${row.id}`);
}

const snapshotNotes = async (base: ReturnType<typeof memoryRepos>["base"]) => {
  const listed = await base.trades.list(OWNER);
  assert.ok(listed.ok);
  return Object.fromEntries(listed.value.map((row) => [row.id, NOTE_FIELDS.map((field) => row[field] ?? null)]));
};

test("dry run: zero writes, samples skipped, accurate sizes, results and proposals", async () => {
  const { repos, base, puts } = memoryRepos();
  await seed(base);
  const { rows, skippedSamples } = await runBackfillDryRun({ repos, owner: OWNER });
  assert.equal(puts.length, 0, "dry run must not call put");
  assert.equal(skippedSamples, 1);
  assert.deepEqual(rows.map((row: { id: string }) => row.id), ["A", "B", "D"]);
  const [a, b, d] = rows;
  // A: $300 account R, 17.5 pts × $5 = $87.50 risked, +37 pts = $185 won.
  assert.equal(a.r_size_cents, 30000);
  assert.equal(a.r_size_source, "account");
  assert.equal(a.risk_cents, 8750);
  assert.equal(a.new_result_r, 0.62);
  assert.equal(a.new_risk_r, 0.29);
  assert.equal(a.proposed_stated_risk_r, 0.25);
  assert.equal(a.notes_have_risk_text, true);
  // B: no account, default $300 (30000 cents). 15 pts = $75 risked, +10 pts = $50 won.
  assert.equal(b.r_size_source, "prefs");
  assert.equal(b.r_size_cents, 30000);
  assert.equal(b.risk_cents, 7500);
  assert.equal(b.new_result_r, 0.17);
  assert.equal(b.new_risk_r, 0.25);
  assert.equal(b.proposed_stated_risk_r, "");
  assert.equal(b.notes_have_risk_text, false);
  // D: no stop, so no risk and no risk dollars, but a result still exists.
  assert.equal(d.new_risk_r, null);
  assert.equal(d.risk_cents, "");
});

test("apply: first run writes R size, risk and confirmed stated risk; notes stay byte-identical; second run writes nothing", async () => {
  const { repos, base, puts } = memoryRepos();
  await seed(base);
  const before = await snapshotNotes(base);
  const { rows } = await runBackfillDryRun({ repos, owner: OWNER });
  const csv = toCsv(rows);
  const reviewed = parseCsv(csv);

  const first = await runBackfillApply({ repos, owner: OWNER }, reviewed);
  // D has no stop, so it gets only its frozen R size (25000 from the default) and no risk.
  assert.deepEqual(first.map((r: { outcome: string }) => r.outcome), ["written", "written", "written"]);
  assert.deepEqual(puts, ["A", "B", "D"]);
  assert.deepEqual(await snapshotNotes(base), before, "note fields must not change");
  const a = (await base.trades.get(OWNER, "A")) as { ok: true; value: { record: TradeRecord } };
  assert.equal(a.value.record.r_size_cents, 30000);
  assert.equal(a.value.record.risk_cents, 8750);
  assert.equal(a.value.record.stated_risk_r, 0.25);
  const b = (await base.trades.get(OWNER, "B")) as { ok: true; value: { record: TradeRecord } };
  assert.equal(b.value.record.r_size_cents, 30000);
  assert.equal(b.value.record.stated_risk_r, null, "no proposal, nothing stated");

  // The same CSV again (its updated_at values are now stale, but nothing needs writing): zero puts.
  puts.length = 0;
  const second = await runBackfillApply({ repos, owner: OWNER }, reviewed);
  assert.equal(puts.length, 0, "idempotent: no writes on a second run");
  assert.ok(second.every((r: { outcome: string }) => r.outcome === "unchanged"));
});

test("apply: an edit made between dry run and apply returns conflict and does not clobber it", async () => {
  const { repos, base, puts } = memoryRepos();
  await seed(base);
  const { rows } = await runBackfillDryRun({ repos, owner: OWNER });
  // Chris edits trade A on another screen after the dry run.
  const current = (await base.trades.get(OWNER, "A")) as { ok: true; value: { record: TradeRecord } };
  assert.ok((await base.trades.put(OWNER, { ...current.value.record, note: "edited on the phone" })).ok);
  puts.length = 0;

  const results = await runBackfillApply({ repos, owner: OWNER }, parseCsv(toCsv(rows)));
  const outcomes = Object.fromEntries(results.map((r: { id: string; outcome: string }) => [r.id, r.outcome]));
  assert.equal(outcomes.A, "conflict");
  assert.equal(outcomes.B, "written", "an untouched trade still applies");
  assert.equal(outcomes.D, "written");
  // A's put was attempted with its expected updated_at and refused as a conflict, so its row is untouched (checked below).
  assert.deepEqual(puts, ["A", "B", "D"], "A's write is attempted with expectedUpdatedAt, then refused");
  const after = (await base.trades.get(OWNER, "A")) as { ok: true; value: { record: TradeRecord } };
  assert.equal(after.value.record.note, "edited on the phone");
  assert.equal(after.value.record.r_size_cents, null);
});

test("CSV: quoted cells round-trip and blank cells stay blank", () => {
  const rows = parseCsv('id,account_id,r_size_cents\n"a,1","q""x",\n');
  assert.deepEqual(rows, [{ id: "a,1", account_id: 'q"x', r_size_cents: "" }]);
});
