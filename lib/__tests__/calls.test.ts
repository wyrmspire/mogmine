// Discretionary calls, DC-1 (docs/25, OD-52).
import assert from "node:assert/strict";
import { test } from "node:test";
import { CALL_KINDS, freezeReason, gradeCall, isAfterTheFact, reasonChipsFor, seedReasonId, validateCall } from "../calls.ts";
import type { DiscretionCall, FrozenReason, SeedReason } from "../calls.ts";
import type { Candle } from "../trades.ts";

const minute = 60_000;
const exitIso = "2026-11-10T20:00:00.000Z"; // Tuesday 15:00 ET; session closes 17:00 ET, 120 minutes later
const exit = Date.parse(exitIso);

function bar(minutes: number, low: number, high: number): Candle {
  return { time: exit + minutes * minute, open: (low + high) / 2, high, low, close: (low + high) / 2, volume: 1 };
}

function seed(kind: Parameters<typeof reasonChipsFor>[0], label: string): FrozenReason {
  const chip = reasonChipsFor(kind).find((item) => item.label === label);
  assert.ok(chip, `no ${kind} chip "${label}"`);
  return freezeReason(chip);
}

function call(patch: Partial<DiscretionCall> = {}): DiscretionCall {
  return {
    id: "c1",
    user_id: "demo-owner",
    kind: "cut",
    made_at: exitIso,
    recorded_at: "2026-11-10T20:01:00.000Z",
    trade_id: "t1",
    plan_session_id: null,
    playbook_id: null,
    price: null,
    price_ticks: null,
    signal_direction: null,
    reasons: [seed("cut", "Stalled at level")],
    note: "",
    conviction: 2,
    ...patch,
  };
}

// Long MES from 6000, stop 5990 (40 ticks risk), target 6020, cut at 5996.
const longCut = {
  symbol: "MES",
  direction: "LONG" as const,
  entry_price: 6000,
  exit_price: 5996,
  exit_time: exitIso,
  stop_loss_price: 5990,
  initial_stop_price: 5990,
  planned_target_price: 6020,
};

test("seven kinds, each with its own reasons plus the shared ones", () => {
  assert.deepEqual(CALL_KINDS.map((k) => k.kind), ["skip", "flip", "cut", "early_take", "stop_here", "hold", "size"]);
  const labels = reasonChipsFor("cut").map((chip) => chip.label);
  assert.ok(labels.includes("Thesis broken"));
  assert.ok(labels.includes("Gut"));
  assert.ok(!labels.includes("Into a level"));
});

test("seed chips have stable, unique ids and a family", () => {
  assert.equal(seedReasonId("cut", "thesis-broken"), "seed:cut:thesis-broken");
  assert.equal(seedReasonId("size", "a-plus-setup"), "seed:size:a-plus-setup");
  assert.equal(seedReasonId("stop_here", "atr-adr"), "seed:stop_here:atr-adr");
  const original: SeedReason = ["thesis-broken", "Thesis broken", "plan"];
  const renamed: SeedReason = [original[0], "Thesis failed", "plan"];
  assert.equal(seedReasonId("cut", original[0]), seedReasonId("cut", renamed[0]), "wording does not define the id");
  assert.equal(reasonChipsFor("cut").find((chip) => chip.label === "Gut")?.id, "seed:shared:gut");
  for (const spec of CALL_KINDS) {
    const chips = reasonChipsFor(spec.kind);
    assert.equal(new Set(chips.map((chip) => chip.id)).size, chips.length, `${spec.kind} ids unique`);
    for (const chip of chips) {
      assert.ok(["market", "plan", "risk", "state", "other"].includes(chip.family));
      assert.ok(chip.label.length <= 32);
      assert.equal(chip.retired, false);
    }
  }
  // "Scared" is offered by Cut and Early take as two chips, so their stats stay apart.
  assert.notEqual(seed("cut", "Scared").id, seed("early_take", "Scared").id);
});

test("a valid call has no problems", () => {
  assert.deepEqual(validateCall(call()), []);
});

test("validation: trade link, flip direction, reasons, time order, ticks, conviction", () => {
  assert.match(validateCall(call({ trade_id: null })).join(" "), /Cut belongs to a trade/);
  assert.match(validateCall(call({ kind: "skip", reasons: [] })).join(" "), /no trade/);
  assert.deepEqual(validateCall(call({ kind: "skip", trade_id: null, reasons: [seed("skip", "Chop")] })), []);
  assert.match(validateCall(call({ kind: "flip", reasons: [] })).join(" "), /signal's direction/);
  assert.match(validateCall(call({ reasons: [seed("skip", "Chop")] })).join(" "), /not a Cut reason/);
  assert.match(validateCall(call({ reasons: [seed("cut", "Gut"), seed("cut", "Gut")] })).join(" "), /twice/);
  assert.match(validateCall(call({ recorded_at: "2026-11-10T19:00:00.000Z" })).join(" "), /before it was made/);
  assert.match(validateCall(call({ price: 5990 })).join(" "), /go together/);
  assert.match(validateCall(call({ price: 5990, price_ticks: 23960.5 })).join(" "), /whole number/);
  assert.match(validateCall(call({ conviction: 4 as 1 })).join(" "), /Conviction/);
  assert.match(validateCall(call({ user_id: "" })).join(" "), /user_id/);
  assert.deepEqual(validateCall(call({ kind: "bogus" as "cut" })), ['Unknown call kind "bogus".']);
});

test("frozen reasons: renamed and retired chips keep old calls valid", () => {
  const original = call({ reasons: [seed("cut", "NQ turned")] });
  // The owner renames the chip; the id stays, the saved call keeps its own label.
  const renamed = reasonChipsFor("cut").map((chip) => (chip.label === "NQ turned" ? { ...chip, label: "NQ rolled over" } : chip));
  assert.deepEqual(validateCall(original, renamed), []);
  assert.equal(original.reasons[0].label, "NQ turned");
  // Retired chips still validate, they are only hidden from pickers.
  const retired = reasonChipsFor("cut").map((chip) => ({ ...chip, retired: chip.label === "NQ turned" }));
  assert.deepEqual(validateCall(original, retired), []);
  // A chip deleted from the library stays valid on the call that already had it, but not on a new one.
  const deleted = reasonChipsFor("cut").filter((chip) => chip.label !== "NQ turned");
  assert.match(validateCall(original, deleted).join(" "), /not a Cut reason/);
  assert.deepEqual(validateCall(original, deleted, original), []);
  // Owner-made chips validate when the library offers them.
  const own = { id: "own:vix-spike", label: "VIX spike", family: "market" as const, retired: false };
  assert.deepEqual(validateCall(call({ reasons: [freezeReason(own)] }), [...reasonChipsFor("cut"), own]), []);
});

test("frozen reason labels and families are checked", () => {
  const gut = seed("cut", "Gut");
  assert.match(validateCall(call({ reasons: [{ ...gut, label: " " }] })).join(" "), /1–32 characters/);
  assert.match(validateCall(call({ reasons: [{ ...gut, label: "x".repeat(33) }] })).join(" "), /1–32 characters/);
  assert.match(validateCall(call({ reasons: [{ ...gut, family: "mood" as "state" }] })).join(" "), /unknown family/);
});

test("after the fact: more than five minutes between decision and writing it down", () => {
  assert.equal(isAfterTheFact(call({ recorded_at: "2026-11-10T20:05:00.000Z" })), false);
  assert.equal(isAfterTheFact(call({ recorded_at: "2026-11-10T20:05:01.000Z" })), true);
  assert.equal(isAfterTheFact(call({ made_at: "nope" })), null);
});

test("cut paid: the stop was hit later, saving exit-to-stop", () => {
  const fact = gradeCall(call(), longCut, [bar(5, 5994, 5999), bar(20, 5988, 5995)]);
  assert.equal(fact.grade, "paid");
  assert.equal(fact.ticks, 24); // (5996 − 5990) / 0.25
  assert.equal(fact.r, 0.6);
  assert.equal(fact.hindsight, true);
  assert.match(fact.sentence, /^Hindsight: paid.*24 ticks \(\+0\.6R\)/);
});

test("early take cost: the target was hit later, leaving exit-to-target", () => {
  const trade = { ...longCut, exit_price: 6010 };
  const fact = gradeCall(call({ kind: "early_take", reasons: [seed("early_take", "Into a level")] }), trade, [bar(10, 6005, 6012), bar(30, 6015, 6021)]);
  assert.equal(fact.grade, "cost");
  assert.equal(fact.ticks, -40);
  assert.equal(fact.r, -1);
  assert.match(fact.sentence, /left 40 ticks \(−1\.0R\)/);
});

test("short trades grade with the sign flipped", () => {
  const short = { ...longCut, direction: "SHORT" as const, entry_price: 6000, exit_price: 6004, stop_loss_price: 6010, initial_stop_price: 6010, planned_target_price: 5980 };
  const fact = gradeCall(call(), short, [bar(5, 6003, 6011)]);
  assert.equal(fact.grade, "paid");
  assert.equal(fact.ticks, 24);
  assert.equal(fact.r, 0.6);
});

test("same bar, partial bars, neither by close, no plan, open trade, other kinds", () => {
  assert.equal(gradeCall(call(), longCut, [bar(5, 5989, 6021)]).grade, "unknown");
  assert.equal(gradeCall(call(), longCut, [bar(5, 5994, 5999)]).grade, "unknown"); // bars stop well before close
  const toClose = Array.from({ length: 120 }, (_, i) => bar(i, 5994, 5999));
  const even = gradeCall(call(), longCut, toClose);
  assert.equal(even.grade, "even");
  assert.equal(even.ticks, null);
  assert.equal(even.r, null);
  assert.equal(gradeCall(call(), { ...longCut, stop_loss_price: null, initial_stop_price: null, planned_target_price: null }, []).grade, "not_graded");
  assert.equal(gradeCall(call(), { ...longCut, exit_time: null, exit_price: null }, []).grade, "not_graded");
  assert.equal(gradeCall(call({ kind: "hold" }), longCut, []).grade, "not_graded");
});

test("R uses the frozen initial stop; no stop on record means no R", () => {
  const trailed = { ...longCut, stop_loss_price: 5994, initial_stop_price: 5990 };
  const fact = gradeCall(call(), trailed, [bar(5, 5993, 5997)]);
  assert.equal(fact.ticks, 8);
  assert.equal(fact.r, 0.2); // 8 / 40 initial-risk ticks
  const targetOnly = { ...longCut, exit_price: 6010, stop_loss_price: null, initial_stop_price: null };
  const cost = gradeCall(call({ kind: "early_take" }), targetOnly, [bar(5, 6015, 6021)]);
  assert.equal(cost.grade, "cost");
  assert.equal(cost.r, null);
});
