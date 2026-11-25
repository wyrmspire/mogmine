import test from "node:test";
import assert from "node:assert/strict";
import { checkExitStopConsistency, lockedR, widestRisk, workingStopAtExit } from "../stop-facts.ts";
import { collectDataNotes } from "../data-notes.ts";
import { normalizeTrade } from "../trades.ts";
import type { TradeRecord } from "../trades.ts";
import { resultR, riskR } from "../r-size.ts";

// MNQ: tick 0.25 = $0.50, so 1 point = $2. Whole-tick money keeps every expected value exact.
// $300 account R = 30_000 cents.
const R_CENTS = 30_000;
const ENTRY = "2026-11-20T15:00:00Z";
const EXIT = "2026-11-20T15:30:00Z";

const trade = (over: Partial<TradeRecord> & Record<string, unknown> = {}): TradeRecord => normalizeTrade({
  id: "t-1", symbol: "MNQ", direction: "LONG", quantity: 1,
  entry_time: ENTRY, exit_time: EXIT, entry_price: 7600, exit_price: 7600,
  stop_loss_price: 7580, initial_stop_price: 7580, initial_stop_set_at: ENTRY,
  ...over,
} as Parameters<typeof normalizeTrade>[0]);

test("widestRisk is null when no move widened the stop", () => {
  assert.equal(widestRisk(trade(), R_CENTS), null);
  // A stop trailed up (locking profit) never widened risk.
  const trailed = trade({
    stop_loss_price: 7618, stop_moves: [{ price: 7618, time: "2026-11-20T15:10:00Z" }],
  });
  assert.equal(widestRisk(trailed, R_CENTS), null);
});

test("widestRisk is the largest risk the stop carried, in account R", () => {
  // Initial stop 7580 (80 ticks = $40), widened to 7540 (240 ticks = $120). $120 at $300 = 0.40R.
  const widened = trade({
    stop_loss_price: 7540, stop_moves: [{ price: 7540, time: "2026-11-20T15:10:00Z" }],
  });
  assert.deepEqual(widestRisk(widened, R_CENTS), { cents: 12_000, r: 0.4 });
});

test("riskR and resultR stay on the frozen initial stop after a widen", () => {
  const widened = trade({
    exit_price: 7540, exit_reason: "stop",
    stop_loss_price: 7540, stop_moves: [{ price: 7540, time: "2026-11-20T15:10:00Z" }],
  });
  // Risk is 80 ticks on the initial stop ($40), not the $120 the widened stop would show.
  assert.equal(riskR(widened, R_CENTS), 4_000 / R_CENTS);
  // Result is gross P&L: 240 ticks × $0.50 = −$120, so −0.40R.
  assert.equal(resultR(widened, R_CENTS), -0.4);
});

test("lockedR is the profit a trailed stop locks at exit, in account R", () => {
  // Stop trailed to 7618: 18 points = 72 ticks = $36 on the profit side. $36 at $300 = 0.12R.
  const locked = trade({
    exit_price: 7618.25, exit_reason: "trail",
    stop_loss_price: 7618, stop_moves: [{ price: 7618, time: "2026-11-20T15:10:00Z" }],
  });
  assert.equal(workingStopAtExit(locked), 7618);
  assert.deepEqual(lockedR(locked, R_CENTS), { cents: 3_600, r: 0.12 });
});

test("lockedR is null when the working stop is still on the risk side or at entry", () => {
  const risk = trade({ stop_loss_price: 7590, stop_moves: [{ price: 7590, time: "2026-11-20T15:10:00Z" }] });
  assert.equal(lockedR(risk, R_CENTS), null);
  const atEntry = trade({ stop_loss_price: 7600, stop_moves: [{ price: 7600, time: "2026-11-20T15:10:00Z" }] });
  assert.equal(lockedR(atEntry, R_CENTS), null);
});

test("checkExitStopConsistency flags an exit more than 2 ticks past a trailed stop (05 §3.2)", () => {
  // MES: 7260.00 working stop, exit 7258.75 is 5 ticks away.
  const base = {
    symbol: "MES", entry_price: 7250, exit_reason: "trail" as const,
    stop_loss_price: 7260, initial_stop_price: 7250, stop_moves: [{ price: 7260, time: "2026-11-20T15:10:00Z" }],
  };
  const far = trade({ ...base, exit_price: 7258.75 });
  assert.deepEqual(checkExitStopConsistency(far), { exitPrice: 7258.75, workingStopPrice: 7260, diffTicks: 5 });
  const near = trade({ ...base, exit_price: 7259.5 });
  assert.equal(checkExitStopConsistency(near), null);
});

test("checkExitStopConsistency ignores open trades and exit reasons other than stop or trail", () => {
  const stopped = { symbol: "MES", stop_loss_price: 7260, exit_price: 7250, stop_moves: [{ price: 7260, time: "2026-11-20T15:10:00Z" }] };
  assert.equal(checkExitStopConsistency(trade({ ...stopped, exit_reason: "manual" })), null);
  assert.equal(checkExitStopConsistency(trade({ ...stopped, exit_reason: "stop", status: "open", exit_time: null, exit_price: null })), null);
});

test("the slippage note is quiet and matches 05 §3.2", () => {
  const input = {
    noCandles: false, base: "1m", misaligned: false, ticker: "MES=F", coverage: "complete" as const,
    chronologyUnresolved: false, findings: [], symbol: "MES", zone: "UTC",
  };
  const notes = collectDataNotes({
    ...input,
    exitStopMismatch: { exitPrice: 7258.75, workingStopPrice: 7260, diffTicks: 5 },
  });
  const slippage = notes.find((note) => note.id === "exit_stop_mismatch");
  assert.equal(slippage?.text, "Exit 7258.75 is 5 ticks past the working stop 7260.00 (slippage?)");
  assert.equal(slippage?.tone, "quiet");
  assert.equal(collectDataNotes({ ...input, exitStopMismatch: null }).some((note) => note.id === "exit_stop_mismatch"), false);
});
