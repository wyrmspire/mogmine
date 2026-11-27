// DR-3: review card copy (docs/06 §4), the 16:9 card layout, and the "Share day" sheet model and renderer.
// Fixtures only: no network, no Supabase, no real accounts. The canvas is a recording fake, so no DOM is needed.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DAY_SHEET_WIDTH,
  buildDaySheetModel,
  buildReviewCardCopy,
  daySheetFileName,
  renderDaySheetCanvas,
} from "../day-sheet.ts";
import type { DaySheetSnapshot } from "../day-sheet.ts";
import { CARD_LAYOUT_TABLE, CARD_SIZES, DEFAULT_CARD_THEME, shareCardFileName } from "../shareCard.ts";
import type { ResolvedRSize } from "../r-size.ts";
import { normalizeTrade } from "../trades.ts";
import type { TradeRecord } from "../trades.ts";

const ZONE = "America/Chicago";
// $300 account R: 123 MES points on one contract is $615, so +2.05R. The initial stop is 70 ticks away: $87.50, 0.29R.
const R_SIZE: ResolvedRSize = { cents: 30000, source: "account", account_id: "acct-eval" };

function trade(patch: Partial<TradeRecord> = {}): TradeRecord {
  return normalizeTrade({
    id: "trade-1",
    symbol: "MES",
    direction: "LONG",
    entry_time: "2026-11-20T14:10:00.000Z",
    exit_time: "2026-11-20T14:45:00.000Z",
    entry_price: 7137,
    exit_price: 7260,
    exit_reason: "trail",
    quantity: 1,
    initial_stop_price: 7119.5,
    stop_loss_price: 7260,
    stop_moves: [{ price: 7260, time: "2026-11-20T14:30:00.000Z" }],
    planned_target_price: 7180,
    playbook_id: "orb-reclaim",
    stated_risk_r: 0.25,
    account_id: "acct-eval",
    checklist_state: [
      { id: "a", label: "Level", checked: true },
      { id: "b", label: "Trend", checked: true },
      { id: "c", label: "Volume", checked: true },
      { id: "d", label: "Size", checked: false },
    ],
    ...patch,
  });
}

describe("CARD_LAYOUT_TABLE 16:9 (Q-5)", () => {
  it("is 1920×1080 with the chart main band at 55%–60% of the height", () => {
    const layout = CARD_LAYOUT_TABLE["16:9"];
    assert.equal(layout.width, 1920);
    assert.equal(layout.height, 1080);
    assert.equal(CARD_SIZES["16:9"].width, 1920);
    assert.equal(CARD_SIZES["16:9"].aspectRatio, "16/9");
    const share = layout.main.height / layout.height;
    assert.ok(share >= 0.55 && share <= 0.6, `main band is ${(share * 100).toFixed(1)}% of the height`);
    assert.ok(layout.main.x + layout.main.width <= layout.width - layout.paddingX, "main band stays inside the side padding");
    assert.ok(layout.footer.y + layout.footer.height <= layout.height, "footer stays on the card");
  });

  it("names the 16:9 file with a 16x9 suffix and no account data", () => {
    const name = shareCardFileName(trade(), "16:9");
    assert.equal(name, "mes-long-2026-11-20-trade-card-16x9.png");
    assert.equal(daySheetFileName("2026-11-20", "landscape"), "day-2026-11-20-review-landscape.png");
  });
});

describe("buildReviewCardCopy (docs/06 §4, D-A)", () => {
  it("builds the non-Shield lines with account R and dollars", () => {
    const copy = buildReviewCardCopy(trade(), R_SIZE, false, ZONE);
    assert.equal(copy.header, "LONG 1 · ORB Reclaim");
    assert.equal(copy.fills, "7137.00 → 7260.00 · Trailed");
    assert.equal(copy.stop, "7119.50 → 7260.00 (moved 08:30)");
    assert.equal(copy.target, "7180.00");
    assert.equal(copy.result, "+2.05R · +$615.00");
    // 1 MES at $87.50 vs $75 stated (0.25R): overshoot < 1 micro, valid ceiling sizing -> no "said" mismatch.
    assert.equal(copy.risk, "0.29R ($87.50)");
    assert.equal(copy.holdAndRules, "35m · rules 3/4");
    const undersized = buildReviewCardCopy(trade({ stated_risk_r: 0.5 }), R_SIZE, false, ZONE);
    assert.equal(undersized.risk, "0.29R ($87.50) · said 0.50R");
  });

  it("marks an untimed stop move (time?)", () => {
    const copy = buildReviewCardCopy(trade({ stop_moves: [] }), R_SIZE, false, ZONE);
    assert.equal(copy.stop, "7119.50 → 7260.00 (time?)");
  });

  it("shows an unmoved stop as one price", () => {
    const copy = buildReviewCardCopy(trade({ initial_stop_price: 7119.5, stop_loss_price: 7119.5, stop_moves: [] }), R_SIZE, false, ZONE);
    assert.equal(copy.stop, "7119.50");
  });

  it("shows no stop as an em dash", () => {
    const copy = buildReviewCardCopy(trade({ initial_stop_price: null, stop_loss_price: null, stop_moves: [], stated_risk_r: null }), R_SIZE, false, ZONE);
    assert.equal(copy.stop, "—");
    assert.equal(copy.risk, "—");
  });

  it("drops the said R when the stated and actual risk agree", () => {
    const copy = buildReviewCardCopy(trade({ stated_risk_r: 0.29 }), R_SIZE, false, ZONE);
    assert.equal(copy.risk, "0.29R ($87.50)");
  });

  it("shows an open trade as Open with no result, and no rules line when ungraded", () => {
    const copy = buildReviewCardCopy(trade({ status: "open", exit_time: null, exit_price: null, exit_reason: null, stop_moves: [], checklist_state: [] }), R_SIZE, false, ZONE);
    assert.equal(copy.fills, "7137.00 → Open");
    assert.equal(copy.result, "Open");
    assert.equal(copy.holdAndRules.includes("rules"), false);
  });

  it("says No setup when the trade has no playbook", () => {
    const copy = buildReviewCardCopy(trade({ playbook_id: null }), R_SIZE, false, ZONE);
    assert.equal(copy.header, "LONG 1 · No setup");
  });

  it("keeps prices, points and account R under Shield, and drops every $ and the contract size", () => {
    const copy = buildReviewCardCopy(trade(), R_SIZE, true, ZONE);
    assert.equal(copy.header, "LONG · ORB Reclaim");
    assert.equal(copy.result, "+2.05R");
    assert.equal(copy.risk, "0.29R");
    const shieldedDiff = buildReviewCardCopy(trade({ stated_risk_r: 0.5 }), R_SIZE, true, ZONE);
    assert.equal(shieldedDiff.risk, "0.29R · said 0.50R");
    assert.equal(copy.fills, "7137.00 → 7260.00 · Trailed");
    assert.equal(copy.stop, "7119.50 → 7260.00 (moved 08:30)");
    assert.equal(copy.target, "7180.00");
    assert.equal(copy.holdAndRules, "35m · rules 3/4");
    for (const value of Object.values(copy)) {
      assert.equal(String(value).includes("$"), false, `dollar sign in "${value}"`);
    }
  });
});

describe("buildDaySheetModel", () => {
  const trades = [trade(), trade({ id: "trade-2", direction: "SHORT", entry_price: 7200, exit_price: 7185, exit_reason: "stop", stop_loss_price: 7215, initial_stop_price: 7215, stop_moves: [] })];
  const opts = { accounts: [{ id: "acct-eval", r_size_cents: 30000 }], prefs: { riskBudgetUsd: 250 }, zone: ZONE };

  it("Shield sweep: no $ and no contract quantity anywhere in the model", () => {
    const model = buildDaySheetModel("2026-11-20", trades, "portrait", true, opts);
    const text = JSON.stringify(model);
    assert.equal(text.includes("$"), false, "the model contains a dollar sign under Shield");
    assert.equal(model.summary.formattedNetMoney, null);
    for (const card of model.cards) assert.equal(card.copy.header.includes(" 1 ·"), false, "quantity leaked into the header");
    assert.equal(model.cards[0].copy.result, "+2.05R");
  });

  it("Portrait is one column; landscape is two columns of 16:9 charts", () => {
    const portrait = buildDaySheetModel("2026-11-20", trades, "portrait", false, opts);
    assert.equal(portrait.cards.every((card) => card.x === portrait.cards[0].x), true);
    assert.ok(portrait.cards[1].y > portrait.cards[0].y);
    const landscape = buildDaySheetModel("2026-11-20", trades, "landscape", false, opts);
    assert.ok(landscape.cards[1].x > landscape.cards[0].x);
    assert.equal(landscape.cards[1].y, landscape.cards[0].y);
    const chart = landscape.cards[0].chart;
    assert.ok(Math.abs(chart.width / chart.height - 16 / 9) < 0.02, "landscape chart is 16:9");
    assert.ok(landscape.cards[1].x + landscape.cards[1].width <= landscape.width, "no card runs off the sheet");
    assert.equal(landscape.width, DAY_SHEET_WIDTH);
  });

  it("drops samples and reports an empty day without cards", () => {
    const empty = buildDaySheetModel("2026-11-20", [], "portrait", true, opts);
    assert.equal(empty.cards.length, 0);
    assert.equal(empty.summary.tradeCount, 0);
    const withSample = buildDaySheetModel("2026-11-20", [trade({ is_sample: true })], "portrait", true, opts);
    assert.equal(withSample.cards.length, 0);
  });
});

/** A recording fake of the 2D context: every drawing call is kept, text measures at 10 px per character. */
function fakeContext() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop === "measureText") return (text: string) => ({ width: String(text).length * 10 });
      if (prop === "createLinearGradient") return () => ({ addColorStop: () => undefined });
      if (prop in target) return target[prop];
      return (...args: unknown[]) => { calls.push({ method: prop, args }); };
    },
    set(target, prop, value) {
      target[prop as string] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, texts: () => calls.filter((c) => c.method === "fillText").map((c) => String(c.args[0])) };
}

describe("renderDaySheetCanvas", () => {
  const opts = { accounts: [{ id: "acct-eval", r_size_cents: 30000 }], prefs: null, zone: ZONE };
  const snapshot: DaySheetSnapshot = { width: 800, height: 450 } as unknown as DaySheetSnapshot;

  it("renders a zero-trade day in both orientations", () => {
    for (const orientation of ["portrait", "landscape"] as const) {
      const model = buildDaySheetModel("2026-11-20", [], orientation, true, opts);
      const fake = fakeContext();
      renderDaySheetCanvas(fake.ctx, model, {}, DEFAULT_CARD_THEME);
      assert.ok(fake.texts().includes("NO TRADES EXECUTED"), `${orientation} shows the no-trades state`);
      assert.ok(fake.texts().some((text) => text.startsWith("MOGMINE · 2026-11-20")), "footer is drawn");
    }
  });

  it("draws a chart snapshot when present and a placeholder when it is missing", () => {
    const model = buildDaySheetModel("2026-11-20", [trade(), trade({ id: "trade-2" })], "landscape", true, opts);
    const withChart = fakeContext();
    renderDaySheetCanvas(withChart.ctx, model, { "trade-1": snapshot, "trade-2": snapshot }, DEFAULT_CARD_THEME);
    assert.equal(withChart.calls.filter((c) => c.method === "drawImage").length, 2);
    assert.equal(withChart.texts().includes("Chart not in this export"), false);

    const missing = fakeContext();
    renderDaySheetCanvas(missing.ctx, model, { "trade-1": snapshot }, DEFAULT_CARD_THEME);
    assert.equal(missing.calls.filter((c) => c.method === "drawImage").length, 1);
    assert.equal(missing.texts().filter((text) => text === "Chart not in this export").length, 1, "one card falls back to the placeholder");
    assert.ok(missing.texts().some((text) => text.startsWith("Result  +2.05R")), "the card lines still render without a chart");
  });

  it("Shield render shows no dollar sign on any drawn text", () => {
    const model = buildDaySheetModel("2026-11-20", [trade()], "portrait", true, opts);
    const fake = fakeContext();
    renderDaySheetCanvas(fake.ctx, model, {}, DEFAULT_CARD_THEME);
    assert.equal(fake.texts().some((text) => text.includes("$")), false);
  });
});
