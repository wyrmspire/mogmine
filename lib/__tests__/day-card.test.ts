import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDayCardData,
  dayCardFileName,
  renderDayCardCanvas,
} from "../day-card.ts";
import {
  DEFAULT_CARD_THEME,
  getCardLayout,
  renderCardCanvas,
  shareCardContent,
} from "../shareCard.ts";
import type { CardSize } from "../shareCard.ts";
import type { TradeRecord } from "../trades.ts";

function createMockTrade(overrides: Partial<TradeRecord> = {}): TradeRecord {
  return {
    id: "trade-mock-1",
    user_id: "default-user",
    account_id: "acc-1",
    symbol: "MES",
    yahoo_ticker: "MES=F",
    direction: "LONG",
    quantity: 3,
    entry_time: "2026-11-10T15:43:00.000Z",
    exit_time: "2026-11-10T15:45:00.000Z",
    entry_price: 5980.25,
    exit_price: 5985.0,
    stop_loss_price: 5977.25,
    planned_target_price: 5990.0,
    initial_stop_price: 5977.25,
    initial_stop_set_at: "2026-11-10T15:43:00.000Z",
    key_level_price: null,
    note: "Clean breakout and hold.",
    playbook_id: "orb-reclaim",
    quick_tags: ["Opening Drive", "A+ Patience"],
    checklist_state: [
      { id: "hard-stop", label: "Hard stop placed", checked: true },
      { id: "planned-target", label: "2:1 target defined", checked: true },
    ],
    is_sample: false,
    trade_style: "scalp",
    status: "closed",
    review_status: "tagged",
    pre_trade_thesis: "ORB reclaim setup",
    management_notes: "Hold through first pull",
    post_exit_notes: "Clean exit at target",
    flagged: false,
    sparkline: [5980, 5982, 5985],
    take_again: null,
    take_again_at: null,
    ...overrides,
  };
}

interface MockCanvasCall {
  method: string;
  args: unknown[];
}

function createMockContext() {
  const calls: MockCanvasCall[] = [];
  const textStrings: string[] = [];

  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "left",
    globalAlpha: 1,
    lineDash: [] as number[],
    setLineDash(dash: number[]) {
      this.lineDash = dash;
      calls.push({ method: "setLineDash", args: [dash] });
    },
    createLinearGradient(x0: number, y0: number, x1: number, y1: number) {
      calls.push({ method: "createLinearGradient", args: [x0, y0, x1, y1] });
      return {
        addColorStop(offset: number, color: string) {
          calls.push({ method: "addColorStop", args: [offset, color] });
        },
      };
    },
    fillRect(x: number, y: number, w: number, h: number) {
      calls.push({ method: "fillRect", args: [x, y, w, h] });
    },
    strokeRect(x: number, y: number, w: number, h: number) {
      calls.push({ method: "strokeRect", args: [x, y, w, h] });
    },
    beginPath() {
      calls.push({ method: "beginPath", args: [] });
    },
    roundRect(x: number, y: number, w: number, h: number, r: number) {
      calls.push({ method: "roundRect", args: [x, y, w, h, r] });
    },
    rect(x: number, y: number, w: number, h: number) {
      calls.push({ method: "rect", args: [x, y, w, h] });
    },
    fill() {
      calls.push({ method: "fill", args: [] });
    },
    stroke() {
      calls.push({ method: "stroke", args: [] });
    },
    save() {
      calls.push({ method: "save", args: [] });
    },
    restore() {
      calls.push({ method: "restore", args: [] });
    },
    translate(x: number, y: number) {
      calls.push({ method: "translate", args: [x, y] });
    },
    measureText(text: string) {
      return { width: text.length * 11 };
    },
    fillText(text: string, x: number, y: number) {
      calls.push({ method: "fillText", args: [text, x, y] });
      textStrings.push(text);
    },
    drawImage(img: unknown, ...args: unknown[]) {
      calls.push({ method: "drawImage", args: [img, ...args] });
    },
  };

  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, textStrings };
}

test("CD-4: dayCardFileName formats size suffix and preserves clean names", () => {
  assert.equal(dayCardFileName("2026-11-10"), "day-2026-11-10-card.png");
  assert.equal(dayCardFileName("2026-11-10", "4:5"), "day-2026-11-10-card.png");
  assert.equal(dayCardFileName("2026-11-10", "9:16"), "day-2026-11-10-card-9x16.png");
  assert.equal(dayCardFileName("2026-11-10", "1:1"), "day-2026-11-10-card-1x1.png");
});

test("CD-4: buildDayCardData aggregates Net R, points, and process adherence", () => {
  const trade1 = createMockTrade({
    id: "t1",
    entry_time: "2026-11-10T14:35:00.000Z",
    exit_time: "2026-11-10T14:40:00.000Z",
    entry_price: 5980.0,
    exit_price: 5985.0, // +5.0 pts
    stop_loss_price: 5977.0,
    initial_stop_price: 5977.0, // risk 3.0 pts -> +1.666R -> ~1.7R
    checklist_state: [
      { id: "r1", label: "Rule 1", checked: true },
      { id: "r2", label: "Rule 2", checked: true },
    ],
  });

  const trade2 = createMockTrade({
    id: "t2",
    entry_time: "2026-11-10T15:10:00.000Z",
    exit_time: "2026-11-10T15:15:00.000Z",
    entry_price: 5990.0,
    exit_price: 5987.0, // -3.0 pts
    stop_loss_price: 5987.0,
    initial_stop_price: 5987.0, // risk 3.0 pts -> -1.0R
    checklist_state: [
      { id: "r1", label: "Rule 1", checked: true },
      { id: "r2", label: "Rule 2", checked: false },
    ],
  });

  const data = buildDayCardData("2026-11-10", [trade1, trade2], true);

  assert.equal(data.sessionDate, "2026-11-10");
  assert.equal(data.tradeCount, 2);
  assert.equal(data.closedTradeCount, 2);
  assert.equal(data.openTradeCount, 0);
  assert.equal(data.winCount, 1);
  assert.equal(data.lossCount, 1);
  assert.equal(data.winRate, 50);

  // Net R: +1.6666 - 1.0 = +0.6666R -> +0.7R
  assert.equal(data.formattedNetR, "+0.7R");
  assert.equal(data.formattedNetPoints, "+2.00 pts");

  // Process adherence: 3 checked out of 4 total = 75%
  assert.equal(data.rulesFollowed, 3);
  assert.equal(data.rulesTotal, 4);
  assert.equal(data.adherencePercent, 75);

  // Shield privacy: netMoney is null
  assert.equal(data.netMoney, null);
  assert.equal(data.formattedNetMoney, null);
  assert.equal(data.shield, true);
});

test("CD-4: Shield privacy sweep across DayCardData", () => {
  const trade = createMockTrade({
    entry_time: "2026-11-10T14:35:00.000Z",
    exit_time: "2026-11-10T14:40:00.000Z",
    quantity: 5,
    entry_price: 5980.0,
    exit_price: 5990.0,
    initial_stop_price: 5975.0,
  });

  const shielded = buildDayCardData("2026-11-10", [trade], true);
  const serializedShield = JSON.stringify(shielded);

  // No money signs, usd or contract counts
  assert.doesNotMatch(serializedShield, /\$|usd|contract|5×/i);
  assert.equal(shielded.netMoney, null);
  assert.equal(shielded.formattedNetMoney, null);
  assert.equal(shielded.trades[0].pnl, null);
  assert.equal(shielded.trades[0].formattedPnl, null);

  // Unshielded allows money
  const unshielded = buildDayCardData("2026-11-10", [trade], false);
  assert.notEqual(unshielded.netMoney, null);
  assert.match(unshielded.formattedNetMoney ?? "", /\$/);
  assert.match(unshielded.trades[0].formattedPnl ?? "", /\$/);
});

test("CD-4: zero-trade session edge case", () => {
  const data = buildDayCardData("2026-11-10", [], true);

  assert.equal(data.sessionDate, "2026-11-10");
  assert.equal(data.tradeCount, 0);
  assert.equal(data.closedTradeCount, 0);
  assert.equal(data.openTradeCount, 0);
  assert.equal(data.netR, null);
  assert.equal(data.formattedNetR, "—R");
  assert.equal(data.winRate, null);
  assert.equal(data.adherencePercent, null);
  assert.equal(data.rulesFollowed, 0);
  assert.equal(data.rulesTotal, 0);
  assert.deepEqual(data.playbookBreakdown, []);
  assert.deepEqual(data.trades, []);

  // Renderer handles zero-trade gracefully across all sizes
  const sizes: CardSize[] = ["4:5", "9:16", "1:1"];
  for (const size of sizes) {
    const { ctx, calls, textStrings } = createMockContext();
    renderDayCardCanvas(ctx, data, DEFAULT_CARD_THEME, size);

    // Specular 1px gold highlight
    const goldTop = calls.find(
      (c) => c.method === "fillRect" && c.args[0] === 0 && c.args[1] === 0 && c.args[3] === 1,
    );
    assert.ok(goldTop, `1px gold top edge must be drawn for zero trades on ${size}`);

    // Empty state text
    assert.ok(textStrings.includes("NO TRADES EXECUTED"), `Zero-trade header must be drawn for ${size}`);
    assert.ok(textStrings.some((s) => s.includes("n = 0")), `n = 0 must be drawn for ${size}`);
  }
});

test("CD-4: no-stop edge case (Guardrail 4: R is null without a stop, never 0)", () => {
  const tradeNoStop = createMockTrade({
    entry_time: "2026-11-10T14:35:00.000Z",
    exit_time: "2026-11-10T14:40:00.000Z",
    entry_price: 5980.0,
    exit_price: 5985.0,
    stop_loss_price: null,
    initial_stop_price: null,
  });

  const data = buildDayCardData("2026-11-10", [tradeNoStop], true);

  assert.equal(data.tradeCount, 1);
  assert.equal(data.netR, null);
  assert.equal(data.formattedNetR, "—R");
  assert.equal(data.trades[0].rMultiple, null);
  assert.equal(data.trades[0].formattedR, "—R");
  assert.equal(data.formattedNetPoints, "+5.00 pts");
});

test("CD-4: renderDayCardCanvas draws shared frame across 4:5, 9:16 and 1:1", () => {
  const sizes: CardSize[] = ["4:5", "9:16", "1:1"];
  const trade = createMockTrade({
    entry_time: "2026-11-10T14:35:00.000Z",
    exit_time: "2026-11-10T14:40:00.000Z",
    checklist_state: [
      { id: "r1", label: "Rule 1", checked: true },
      { id: "r2", label: "Rule 2", checked: true },
    ],
  });
  const data = buildDayCardData("2026-11-10", [trade], true);

  for (const size of sizes) {
    const { ctx, calls, textStrings } = createMockContext();
    const layout = getCardLayout(size);

    renderDayCardCanvas(ctx, data, DEFAULT_CARD_THEME, size);

    // 1. Specular 1px gold top edge
    const goldTopEdge = calls.find(
      (c) => c.method === "fillRect" && c.args[0] === 0 && c.args[1] === 0 && c.args[2] === layout.width && c.args[3] === 1,
    );
    assert.ok(goldTopEdge, `1px gold top edge must be drawn for ${size}`);

    // 2. Carbon hairline border
    const hairlineBorder = calls.find(
      (c) => c.method === "strokeRect" && c.args[0] === 0.5 && c.args[1] === 0.5,
    );
    assert.ok(hairlineBorder, `Hairline border must be drawn for ${size}`);

    // 3. Header: DAY label, date, SHIELD badge
    assert.ok(textStrings.some((s) => s.includes("DAY · 2026-11-10")), `DAY label must be drawn for ${size}`);
    assert.ok(textStrings.includes("SHIELD"), `SHIELD badge must be drawn for ${size}`);

    // 4. Stats row cells: TRADES (n = 1), NET R, PROCESS (100%)
    assert.ok(textStrings.includes("TRADES"), `TRADES label must be drawn for ${size}`);
    assert.ok(textStrings.some((s) => s.includes("n = 1")), `n = 1 must be drawn for ${size}`);
    assert.ok(textStrings.includes("NET R"), `NET R label must be drawn for ${size}`);
    assert.ok(textStrings.includes("PROCESS"), `PROCESS label must be drawn for ${size}`);
    assert.ok(textStrings.some((s) => s.includes("100%")), `100% adherence must be drawn for ${size}`);

    // 5. Privacy sweep under Shield
    for (const str of textStrings) {
      assert.doesNotMatch(str, /\$|usd/i, `Rendered text must not contain money under Shield for ${size}: ${str}`);
      assert.doesNotMatch(str, /contract|3×/i, `Rendered text must not contain contract count under Shield for ${size}: ${str}`);
    }

    // 6. Footer
    assert.ok(textStrings.some((s) => s.includes("MOGMINE")), `MOGMINE footer must be drawn for ${size}`);
  }
});

test("M3-Card: Trade Card renders Playbook tag in header and context band across all sizes", () => {
  const sizes: CardSize[] = ["4:5", "9:16", "1:1"];
  const trade = createMockTrade({
    playbook_id: "orb-reclaim",
  });
  const mockSnapshot = { width: 900, height: 600 } as unknown as CanvasImageSource & { width: number; height: number };

  const content = shareCardContent(trade, "America/Chicago", true);
  assert.equal(content.playbook, "ORB Reclaim");

  for (const size of sizes) {
    const { ctx, textStrings } = createMockContext();

    renderCardCanvas(ctx, mockSnapshot, trade, "America/Chicago", true, null, {
      size,
      theme: DEFAULT_CARD_THEME,
    });

    // 1. Playbook tag in header band (uppercase)
    assert.ok(
      textStrings.includes("ORB RECLAIM"),
      `ORB RECLAIM playbook pill text must be rendered in header for ${size}`,
    );

    // 2. Playbook in context band
    assert.ok(
      textStrings.includes("PLAYBOOK"),
      `PLAYBOOK label must be rendered in context band for ${size}`,
    );
    assert.ok(
      textStrings.some((s) => s.includes("ORB Reclaim")),
      `ORB Reclaim playbook name must be rendered in context band for ${size}`,
    );

    // 3. Privacy sweep
    for (const str of textStrings) {
      assert.doesNotMatch(str, /\$|usd/i, `Rendered text must not contain money under Shield for ${size}: ${str}`);
      assert.doesNotMatch(str, /contract|3×/i, `Rendered text must not contain contract count under Shield for ${size}: ${str}`);
    }
  }
});
