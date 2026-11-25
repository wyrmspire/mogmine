import test from "node:test";
import assert from "node:assert/strict";
import { playbookCardFileName, playbookImageContent, renderPlaybookCardCanvas } from "../playbook-card-image.ts";
import { playbookCardData } from "../playbook-card.ts";
import { DEFAULT_CARD_THEME, getCardLayout } from "../shareCard.ts";
import type { CardSide, CardSize } from "../shareCard.ts";
import type { TradeRecord } from "../trades.ts";

const now = Date.parse("2026-11-22T18:00:00Z");
const book = { id: "orb", name: "ORB Reclaim", checklist_rules: [{ id: "a", label: "Bias set" }, { id: "b", label: "Stop placed" }] };
let n = 0;
const trade = (points: number): TradeRecord => {
  n += 1;
  const entry = Date.parse("2026-11-10T15:00:00Z") + n * 600_000;
  return {
    id: `t${n}`, symbol: "MES", direction: "LONG", quantity: 3, status: "closed", is_sample: false, playbook_id: "orb",
    entry_time: new Date(entry).toISOString(), exit_time: new Date(entry + 300_000).toISOString(),
    entry_price: 7600, exit_price: 7600 + points, stop_loss_price: 7596, quick_tags: [], take_again: "yes",
    checklist_state: [{ id: "a", label: "Bias set", checked: true }, { id: "b", label: "Stop placed", checked: true }],
  } as unknown as TradeRecord;
};
const data = playbookCardData(book, Array.from({ length: 12 }, (_, i) => trade(i < 8 ? 8 : -4)), [], now);
const SIZES: CardSize[] = ["4:5", "9:16", "1:1"];
const SIDES: CardSide[] = ["front", "back"];

/** Records every string and every drawn rectangle; measures text at 10 px a character. */
function mockContext() {
  const texts: string[] = [];
  const images: number[][] = [];
  const ctx = {
    fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textAlign: "left",
    createLinearGradient: () => ({ addColorStop() {} }),
    fillRect() {}, strokeRect() {}, beginPath() {}, roundRect() {}, rect() {}, fill() {},
    fillText(text: string) { texts.push(text); },
    measureText(text: string) { return { width: text.length * 10 }; },
    drawImage(_img: unknown, x: number, y: number, w: number, h: number) { images.push([x, y, w, h]); },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts, images };
}

test("CD-3c: Shield prints rules and the example, never a result, dollar, size or account", () => {
  for (const size of SIZES) for (const side of SIDES) {
    const { ctx, texts } = mockContext();
    renderPlaybookCardCanvas(ctx, null, data, { size, side, shield: true, theme: DEFAULT_CARD_THEME, dateLabel: "Nov 22, 2026" });
    const all = texts.join(" | ");
    assert.doesNotMatch(all, /\$|contract|account|balance|Win rate|Avg R|%|[+−-]\d+(\.\d)?R/i, `${size} ${side}: ${all}`);
    if (side === "back") assert.match(all, /1\. Bias set/);
    if (side === "back") assert.match(all, /Hidden by Shield/);
  }
});

test("CD-3c: without Shield the stats row prints the R-08a numbers", () => {
  const { ctx, texts } = mockContext();
  renderPlaybookCardCanvas(ctx, null, data, { size: "4:5", side: "front", shield: false, theme: DEFAULT_CARD_THEME, dateLabel: "Nov 22, 2026" });
  assert.ok(texts.includes("67%"), texts.join(" | "));
  // 8 × +0.48R (+$120 ÷ $250) and 4 × −0.24R (−$60 ÷ $250) over 12 trades = +0.24R avg → +0.2R.
  assert.ok(texts.includes("+0.2R"), texts.join(" | "));
  assert.ok(texts.includes("12"));
});

test("CD-3c: the example snapshot fits inside the main area at every size", () => {
  for (const size of SIZES) {
    const { ctx, images } = mockContext();
    const snapshot = { width: 780, height: 900 } as unknown as HTMLCanvasElement;
    renderPlaybookCardCanvas(ctx, snapshot, data, { size, side: "front", shield: true, theme: DEFAULT_CARD_THEME, dateLabel: "Nov 22" });
    const main = getCardLayout(size).main;
    const [[x, y, w, h]] = images;
    assert.ok(x >= main.x && y >= main.y && x + w <= main.x + main.width + 0.01 && y + h <= main.y + main.height + 0.01, `${size}: ${[x, y, w, h]}`);
  }
});

test("CD-3c: no snapshot says why, and never draws an empty chart", () => {
  const none = playbookCardData(book, [], [], now);
  const { ctx, texts, images } = mockContext();
  renderPlaybookCardCanvas(ctx, null, none, { side: "front", shield: true, theme: DEFAULT_CARD_THEME, dateLabel: "Nov 22" });
  assert.equal(images.length, 0);
  assert.ok(texts.includes("No example yet"));
  const { ctx: ctx2, texts: texts2 } = mockContext();
  renderPlaybookCardCanvas(ctx2, null, data, { side: "front", shield: true, theme: DEFAULT_CARD_THEME, dateLabel: "Nov 22" });
  assert.ok(texts2.includes("No saved bars for the example"));
});

test("CD-3c: content and file names carry the size and side, never a result", () => {
  assert.equal(playbookCardFileName("ORB Reclaim"), "playbook-orb-reclaim-card.png");
  assert.equal(playbookCardFileName("ONL Sweep + SMT", "9:16", "back"), "playbook-onl-sweep-smt-card-9x16-back.png");
  assert.equal(playbookCardFileName("!!!", "1:1"), "playbook-playbook-card-1x1.png");
  const content = playbookImageContent(data, true, "back", "Nov 22");
  assert.equal(content.header, "PLAYBOOK · BACK · SHIELD");
  assert.deepEqual(content.stats, []);
  assert.equal(content.footerRight, "n = 12");
});
