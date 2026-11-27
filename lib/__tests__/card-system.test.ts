import assert from "node:assert/strict";
import test from "node:test";
import {
  CARD_SIZES,
  DEFAULT_CARD_THEME,
  formatBlindAnswer,
  getCardLayout,
  renderCardCanvas,
  shareCardContent,
  shareCardFileName,
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
    note: "Followed the ORB reclaim cleanly.",
    playbook_id: "pb-orb-reclaim",
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
    moveTo(x: number, y: number) {
      calls.push({ method: "moveTo", args: [x, y] });
    },
    lineTo(x: number, y: number) {
      calls.push({ method: "lineTo", args: [x, y] });
    },
    drawImage(img: unknown, dx: number, dy: number, dw: number, dh: number) {
      calls.push({ method: "drawImage", args: [img, dx, dy, dw, dh] });
    },
    fillText(text: string, x: number, y: number) {
      textStrings.push(text);
      calls.push({ method: "fillText", args: [text, x, y] });
    },
    measureText(text: string) {
      return { width: text.length * 10 };
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
  };

  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, textStrings };
}

test("CD-1a: shared frame layout tables for 4:5, 9:16 and 1:1", () => {
  const sizes: CardSize[] = ["4:5", "9:16", "1:1"];

  for (const size of sizes) {
    const layout = getCardLayout(size);
    const expectedDim = CARD_SIZES[size];

    assert.equal(layout.width, 1080, `Width should be 1080 for ${size}`);
    assert.equal(layout.height, expectedDim.height, `Height should match ${expectedDim.height} for ${size}`);

    // Main area must occupy 55% to 60% of total card height (docs/23 §2, §3)
    const mainRatio = layout.main.height / layout.height;
    assert.ok(
      mainRatio >= 0.55 && mainRatio <= 0.60,
      `Main area height ratio ${mainRatio.toFixed(4)} for ${size} must be between 55% and 60%`,
    );

    // Verify non-overlapping bands within canvas
    assert.ok(layout.header.y >= 0, `Header y must be >= 0 for ${size}`);
    assert.ok(layout.header.y + layout.header.height <= layout.main.y, `Header must not overlap main for ${size}`);
    assert.ok(layout.main.y + layout.main.height <= layout.stats.y, `Main must not overlap stats for ${size}`);
    assert.ok(layout.stats.y + layout.stats.height <= layout.context.y, `Stats must not overlap context for ${size}`);
    assert.ok(layout.context.y + layout.context.height <= layout.footer.y, `Context must not overlap footer for ${size}`);
    assert.ok(
      layout.footer.y + layout.footer.height <= layout.height,
      `Footer must fit inside canvas height for ${size}`,
    );

    // Padding bounds
    assert.ok(layout.main.x >= layout.paddingX, `Main area x should respect padding for ${size}`);
    assert.ok(
      layout.main.x + layout.main.width <= layout.width,
      `Main area width should fit within canvas for ${size}`,
    );
  }

  // Unknown size falls back to 4:5
  const fallback = getCardLayout("unknown" as unknown as CardSize);
  assert.equal(fallback.size, "4:5");
  assert.equal(fallback.height, 1350);
});

test("CD-1a: shareCardFileName formats size suffix and preserves backward compatibility", () => {
  const trade = createMockTrade();

  // Default / 4:5 keeps exact existing filename (UX-72)
  assert.equal(shareCardFileName(trade), "mes-long-2026-11-10-trade-card.png");
  assert.equal(shareCardFileName(trade, "4:5"), "mes-long-2026-11-10-trade-card.png");

  // 9:16 and 1:1 add standard size suffix
  assert.equal(shareCardFileName(trade, "9:16"), "mes-long-2026-11-10-trade-card-9x16.png");
  assert.equal(shareCardFileName(trade, "1:1"), "mes-long-2026-11-10-trade-card-1x1.png");

  // CD-1b: back side adds -back suffix
  assert.equal(shareCardFileName(trade, "4:5", "back"), "mes-long-2026-11-10-trade-card-back.png");
  assert.equal(shareCardFileName(trade, "9:16", "back"), "mes-long-2026-11-10-trade-card-9x16-back.png");
  assert.equal(shareCardFileName(trade, "1:1", "back"), "mes-long-2026-11-10-trade-card-1x1-back.png");

  // Never leaks privacy data into file name
  for (const size of ["4:5", "9:16", "1:1"] as CardSize[]) {
    const fn = shareCardFileName(trade, size);
    assert.doesNotMatch(fn, /\$|usd|contract|3|71\.25/i);
    const fnBack = shareCardFileName(trade, size, "back");
    assert.doesNotMatch(fnBack, /\$|usd|contract|3|71\.25/i);
  }
});

test("CD-1a: Shield copy verification across all sizes", () => {
  const trade = createMockTrade({
    checklist_state: [
      { id: "rule-1", label: "Rule 1", checked: true },
      { id: "rule-2", label: "Rule 2", checked: true },
      { id: "rule-3", label: "Rule 3", checked: true },
      { id: "rule-4", label: "Rule 4", checked: true },
    ],
    take_again: "yes",
  });

  const contentShield = shareCardContent(trade, "America/Chicago", true);

  // 1. Shield privacy check: strictly no money, contract quantity, or account identifiers
  const serialized = JSON.stringify(contentShield);
  assert.doesNotMatch(serialized, /\$|usd|contract|3×/i);
  assert.doesNotMatch(serialized, /acc-1|default-user/i);

  // 2. Process beats outcome: hero R and process seal present.
  // Account R: +4.75 pts x 3 MES x $5 = $71.25 ÷ $300 default R = 0.2375R, formatted (1 dp) as +0.2R.
  assert.equal(contentShield.heroResult, "+0.2R");
  assert.equal(contentShield.outcomeDetail, "+4.75 pts");
  assert.equal(contentShield.processSeal, "4/4 RULES · TAKE AGAIN ✓");
  assert.equal(contentShield.ruleSeal, "4/4 FOLLOWED");
  assert.equal(contentShield.typeLabel, "TRADE");
  assert.equal(contentShield.subject, "MES LONG");

  // 3. Unshielded copy retains dollars and contract quantity
  const contentUnshielded = shareCardContent(trade, "America/Chicago", false);
  assert.match(contentUnshielded.outcome, /\+\$71\.25/);
  assert.match(contentUnshielded.direction, /3 contracts/);
});

test("CD-1a: blind review verdicts in process seal", () => {
  const tradeYes = createMockTrade({ take_again: "yes" });
  assert.equal(formatBlindAnswer(tradeYes.take_again), "TAKE AGAIN ✓");
  const contentYes = shareCardContent(tradeYes, "America/Chicago", true);
  assert.match(contentYes.processSeal!, /TAKE AGAIN ✓/);

  const tradeSmaller = createMockTrade({ take_again: "smaller" });
  assert.equal(formatBlindAnswer(tradeSmaller.take_again), "SMALLER");
  const contentSmaller = shareCardContent(tradeSmaller, "America/Chicago", true);
  assert.match(contentSmaller.processSeal!, /SMALLER/);

  const tradePass = createMockTrade({ take_again: "pass" });
  assert.equal(formatBlindAnswer(tradePass.take_again), "PASS");
  const contentPass = shareCardContent(tradePass, "America/Chicago", true);
  assert.match(contentPass.processSeal!, /PASS/);

  const tradeNull = createMockTrade({ take_again: null });
  assert.equal(formatBlindAnswer(tradeNull.take_again), null);
  const contentNull = shareCardContent(tradeNull, "America/Chicago", true);
  assert.equal(contentNull.processSeal, "2/2 RULES");
});

test("CD-1a: open trade handling (OD-38, R-03c)", () => {
  const openTrade = createMockTrade({
    exit_time: null,
    exit_price: null,
    status: "open",
  });

  const content = shareCardContent(openTrade, "America/Chicago", true);
  assert.equal(content.exit, "OPEN");
  assert.equal(content.outcome, "OPEN");
  assert.equal(content.heroResult, "OPEN");
  assert.equal(content.outcomeDetail, "");
  assert.doesNotMatch(JSON.stringify(content), /\$|usd/i);
});

test("CD-1a: renderCardCanvas draws specular 1px gold highlight, main chart and stats for 4:5, 9:16 and 1:1", () => {
  const sizes: CardSize[] = ["4:5", "9:16", "1:1"];
  const trade = createMockTrade();
  const mockSnapshot = { width: 900, height: 600 } as unknown as CanvasImageSource & { width: number; height: number };

  for (const size of sizes) {
    const { ctx, calls, textStrings } = createMockContext();
    const layout = getCardLayout(size);

    renderCardCanvas(ctx, mockSnapshot, trade, "America/Chicago", true, null, {
      size,
      theme: DEFAULT_CARD_THEME,
    });

    // 1. Specular 1px gold top edge highlight (Invariant 5, docs/23 §2)
    const goldTopEdge = calls.find(
      (c) => c.method === "fillRect" && c.args[0] === 0 && c.args[1] === 0 && c.args[2] === layout.width && c.args[3] === 1,
    );
    assert.ok(goldTopEdge, `1px gold top edge must be drawn for ${size}`);

    // 2. Carbon hairline border
    const hairlineBorder = calls.find(
      (c) => c.method === "strokeRect" && c.args[0] === 0.5 && c.args[1] === 0.5,
    );
    assert.ok(hairlineBorder, `Hairline border must be drawn for ${size}`);

    // 3. Chart snapshot scaled and drawn inside main area
    const chartDraw = calls.find((c) => c.method === "drawImage");
    assert.ok(chartDraw, `Chart snapshot must be drawn for ${size}`);
    const [, drawX, drawY, drawW, drawH] = chartDraw.args as [unknown, number, number, number, number];
    assert.ok(drawX >= layout.main.x, `Snapshot X must be >= main.x for ${size}`);
    assert.ok(drawY >= layout.main.y, `Snapshot Y must be >= main.y for ${size}`);
    assert.ok(drawX + drawW <= layout.main.x + layout.main.width, `Snapshot right must fit in main for ${size}`);
    assert.ok(drawY + drawH <= layout.main.y + layout.main.height, `Snapshot bottom must fit in main for ${size}`);

    // 4. Privacy sweep: no dollar amounts or contract counts in rendered text
    for (const str of textStrings) {
      assert.doesNotMatch(str, /\$|usd/i, `Rendered text must not contain money under Shield for ${size}: ${str}`);
      assert.doesNotMatch(str, /contract|3×/i, `Rendered text must not contain contract count under Shield for ${size}: ${str}`);
    }

    // 5. Hero R, Entry, Exit, Shield badge rendered
    assert.ok(textStrings.includes("SHIELD"), `SHIELD badge must be drawn for ${size}`);
    assert.ok(textStrings.includes("ENTRY"), `ENTRY label must be drawn for ${size}`);
    assert.ok(textStrings.includes("EXIT"), `EXIT label must be drawn for ${size}`);
    assert.ok(textStrings.some((s) => s.includes("+0.2R")), `Hero R must be drawn for ${size}`);
    assert.ok(textStrings.some((s) => s.includes("MES LONG")), `Subject must be drawn for ${size}`);
  }
});

test("CD-1b: renderCardCanvas draws back side with thesis, management, post-exit notes and checklist", () => {
  const sizes: CardSize[] = ["4:5", "9:16", "1:1"];
  const trade = createMockTrade();
  const mockSnapshot = { width: 900, height: 600 } as unknown as CanvasImageSource & { width: number; height: number };

  for (const size of sizes) {
    const { ctx, calls, textStrings } = createMockContext();
    const layout = getCardLayout(size);

    renderCardCanvas(ctx, mockSnapshot, trade, "America/Chicago", true, null, {
      size,
      side: "back",
      theme: DEFAULT_CARD_THEME,
    });

    // 1. Specular 1px gold top edge highlight (Invariant 5, docs/23 §2)
    const goldTopEdge = calls.find(
      (c) => c.method === "fillRect" && c.args[0] === 0 && c.args[1] === 0 && c.args[2] === layout.width && c.args[3] === 1,
    );
    assert.ok(goldTopEdge, `1px gold top edge must be drawn for ${size} back side`);

    // 2. Chart snapshot drawImage should NOT be called for back side
    const chartDraw = calls.find((c) => c.method === "drawImage");
    assert.equal(chartDraw, undefined, `Chart snapshot must NOT be drawn on back side for ${size}`);

    // 3. Back side sections: thesis, management, post-exit, checklist
    assert.ok(textStrings.includes("PRE-TRADE THESIS"), `PRE-TRADE THESIS label must be drawn for ${size}`);
    assert.ok(textStrings.some((s) => s.includes("ORB reclaim setup")), `Pre-trade thesis text must be drawn for ${size}`);
    assert.ok(textStrings.includes("TRADE MANAGEMENT"), `TRADE MANAGEMENT label must be drawn for ${size}`);
    assert.ok(textStrings.some((s) => s.includes("Hold through first pull")), `Management notes text must be drawn for ${size}`);
    assert.ok(textStrings.includes("POST-EXIT NOTES"), `POST-EXIT NOTES label must be drawn for ${size}`);
    assert.ok(textStrings.some((s) => s.includes("Clean exit at target")), `Post-exit notes text must be drawn for ${size}`);
    assert.ok(textStrings.some((s) => s.includes("PLAYBOOK CHECKLIST")), `Playbook checklist label must be drawn for ${size}`);
    assert.ok(textStrings.some((s) => s.includes("Hard stop placed")), `Rule item must be drawn for ${size}`);

    // 4. Header includes BACK label
    assert.ok(textStrings.some((s) => s.includes("BACK")), `Header must contain BACK indicator for ${size}`);

    // 5. Privacy sweep under Shield
    for (const str of textStrings) {
      assert.doesNotMatch(str, /\$|usd/i, `Rendered text must not contain money under Shield for ${size}: ${str}`);
      assert.doesNotMatch(str, /contract|3×/i, `Rendered text must not contain contract count under Shield for ${size}: ${str}`);
    }
  }
});

