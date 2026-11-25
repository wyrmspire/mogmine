// DR-3: the "Share day" sheet (docs/06 §4). Pure data builder (buildDaySheetModel, buildReviewCardCopy) and a
// Canvas 2D composer on the shared obsidian / specular-gold frame (OD-8: no html-to-image). The Day Card summary
// sits on top and one review card per linked trade follows: one column in portrait, two in landscape.
// Shield (OD-46a) hides dollars and contract size everywhere in this file; prices, points and account R stay.
import { formatDuration, formatMoney, formatPrice, formatUsdAmount } from "./format.ts";
import { buildDayCardData } from "./day-card.ts";
import type { DayCardData } from "./day-card.ts";
import { playbookName } from "./playbooks.ts";
import { DEFAULT_CARD_THEME } from "./shareCard.ts";
import { getTheme } from "./theme.ts";
import type { ChartTheme } from "./theme.ts";
import { DEFAULT_TIME_ZONE, formatListTime } from "./time.ts";
import type { ReviewCardOrientation } from "./prefs-sanitize.ts";
import { resolveRSize, riskCents, riskComparison, resultR } from "./r-size.ts";
import type { ResolvedRSize } from "./r-size.ts";
import { EXIT_REASONS, adherence, holdSeconds, isOpen, tradePnl } from "./trades.ts";
import type { RSizeOptions, TradeRecord } from "./trades.ts";

/** The six review-card lines of docs/06 §4, in display order, plus the header. Shield-aware. */
export interface ReviewCardCopy {
  header: string;
  fills: string;
  stop: string;
  target: string;
  result: string;
  risk: string;
  holdAndRules: string;
}

const SIGN_MINUS = "−";
const signedR = (r: number) => `${r < 0 ? SIGN_MINUS : "+"}${Math.abs(r).toFixed(2)}R`;
const rText = (r: number) => `${r.toFixed(2)}R`;

/**
 * Card copy for one trade (docs/06 §4, D-A: result and risk use account R). Under Shield the header drops the
 * contract size, the result drops dollars and the risk drops dollars. Prices, points, times and R stay.
 */
export function buildReviewCardCopy(trade: TradeRecord, rSize: ResolvedRSize, shield: boolean, zone: string): ReviewCardCopy {
  const sym = trade.symbol;
  const open = isOpen(trade) || trade.exit_price == null;

  // Header: side, size (hidden under Shield), playbook.
  const playbook = trade.playbook_id == null ? "No setup" : (playbookName(trade.playbook_id) ?? trade.playbook_id);
  const header = `${trade.direction}${shield ? "" : ` ${trade.quantity}`} · ${playbook}`;

  // Fills: entry → exit, then the exit reason when the trade is closed and the reason is known.
  const reasonLabel = EXIT_REASONS.find((reason) => reason.value === trade.exit_reason)?.label;
  const exitText = open ? "Open" : formatPrice(trade.exit_price, sym);
  const fills = `${formatPrice(trade.entry_price, sym)} → ${exitText}${!open && reasonLabel ? ` · ${reasonLabel}` : ""}`;

  // Stop: first stop → working stop, with the time of the last move. An untimed move says so.
  const initial = trade.initial_stop_price ?? null;
  const current = trade.stop_loss_price ?? null;
  let stop = "—";
  if (initial != null && current != null && initial !== current) {
    const lastMove = trade.stop_moves?.length ? trade.stop_moves[trade.stop_moves.length - 1] : null;
    const when = lastMove ? `moved ${formatListTime(lastMove.time, zone)}` : "time?";
    stop = `${formatPrice(initial, sym)} → ${formatPrice(current, sym)} (${when})`;
  } else if (initial != null || current != null) {
    stop = formatPrice(initial ?? current, sym);
  }

  const target = trade.planned_target_price != null ? formatPrice(trade.planned_target_price, sym) : "—";

  // Result: account R (D-A). Money is the gross P&L, dropped under Shield.
  let result = "Open";
  if (!open) {
    const r = resultR(trade, rSize);
    const rPart = r == null ? "—" : signedR(r);
    const pnl = shield ? null : tradePnl(trade);
    result = pnl == null || shield ? rPart : `${rPart} · ${formatMoney(pnl)}`;
  }

  // Risk: actual stop dollars in account R, and what the trader said (stated risk), when they differ.
  const comparison = riskComparison(trade, rSize);
  const cents = riskCents(trade);
  const actual = comparison.actual_r != null ? rText(comparison.actual_r) : null;
  const said = comparison.stated_r != null ? ` · said ${rText(comparison.stated_r)}` : "";
  let risk: string;
  if (actual != null) {
    const dollars = !shield && cents != null ? ` (${formatUsdAmount(cents / 100)})` : "";
    risk = `${actual}${dollars}${comparison.differs ? said : ""}`;
  } else {
    risk = comparison.stated_r != null ? `said ${rText(comparison.stated_r)}` : "—";
  }

  // Hold and rules: rules only when the trade carries a checklist.
  const score = adherence(trade);
  const holdAndRules = `${formatDuration(holdSeconds(trade))}${score ? ` · rules ${score.followed}/${score.total}` : ""}`;

  return { header, fills, stop, target, result, risk, holdAndRules };
}

export interface BuildDaySheetOptions extends RSizeOptions {
  zone?: string;
}

export interface DaySheetCard {
  tradeId: string;
  direction: "LONG" | "SHORT";
  copy: ReviewCardCopy;
  x: number;
  y: number;
  width: number;
  height: number;
  chart: { x: number; y: number; width: number; height: number };
}

export interface DaySheetModel {
  sessionDate: string;
  orientation: ReviewCardOrientation;
  shield: boolean;
  width: number;
  height: number;
  headerHeight: number;
  lineHeight: number;
  footerY: number;
  summary: DayCardData;
  cards: DaySheetCard[];
}

export const DAY_SHEET_WIDTH = 1080;
const PAD = 52;
const GAP = 24;
const CARD_INSET = 16;
const HEADER_HEIGHT = 220;
const EMPTY_HEIGHT = 220;
const DETAIL_LINES = 7;

/**
 * Pure layout for the day sheet. Portrait is one column with 560 px charts; landscape is two columns of 16:9
 * charts. Trades are the linked, non-sample trades in the order given. Summary totals come from buildDayCardData.
 */
export function buildDaySheetModel(
  sessionDate: string,
  linkedTrades: readonly TradeRecord[],
  orientation: ReviewCardOrientation,
  shield: boolean,
  opts: BuildDaySheetOptions = {},
): DaySheetModel {
  const zone = opts.zone ?? DEFAULT_TIME_ZONE;
  const trades = linkedTrades.filter((trade) => !trade.is_sample);
  const summary = buildDayCardData(sessionDate, trades, shield, opts);
  const landscape = orientation === "landscape";
  const columns = landscape ? 2 : 1;
  const cardWidth = landscape ? (DAY_SHEET_WIDTH - PAD * 2 - GAP) / 2 : DAY_SHEET_WIDTH - PAD * 2;
  const chartWidth = cardWidth - CARD_INSET * 2;
  const chartHeight = landscape ? Math.round((chartWidth * 9) / 16) : 560;
  const lineHeight = landscape ? 30 : 34;
  const cardHeight = CARD_INSET + chartHeight + CARD_INSET + DETAIL_LINES * lineHeight + CARD_INSET;
  const rows = Math.ceil(trades.length / columns);
  const bodyHeight = rows > 0 ? rows * cardHeight + (rows - 1) * GAP : EMPTY_HEIGHT;
  const cards: DaySheetCard[] = trades.map((trade, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = PAD + column * (cardWidth + GAP);
    const y = HEADER_HEIGHT + row * (cardHeight + GAP);
    return {
      tradeId: trade.id,
      direction: trade.direction,
      copy: buildReviewCardCopy(trade, resolveRSize(trade, opts.accounts, opts.prefs), shield, zone),
      x,
      y,
      width: cardWidth,
      height: cardHeight,
      chart: { x: x + CARD_INSET, y: y + CARD_INSET, width: chartWidth, height: chartHeight },
    };
  });
  const footerY = HEADER_HEIGHT + bodyHeight + 56;
  return {
    sessionDate,
    orientation,
    shield,
    width: DAY_SHEET_WIDTH,
    height: footerY + 40,
    headerHeight: HEADER_HEIGHT,
    lineHeight,
    footerY,
    summary,
    cards,
  };
}

/** `day-2026-11-20-review-landscape.png`: the session date and orientation only. No dollars, quantities or account IDs. */
export function daySheetFileName(sessionDate: string, orientation: ReviewCardOrientation): string {
  const cleanDate = sessionDate.replace(/[^0-9-]/g, "");
  return `day-${cleanDate}-review-${orientation}.png`;
}

export type DaySheetSnapshot = CanvasImageSource & { width: number; height: number };
/** Chart snapshots by trade id, drawn with the same privacy as the export. A missing entry gets a placeholder. */
export type DaySheetSnapshots = Partial<Record<string, DaySheetSnapshot | null>>;

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let shortened = text;
  while (shortened.length > 1 && ctx.measureText(`${shortened}…`).width > maxWidth) shortened = shortened.slice(0, -1);
  return `${shortened}…`;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

function drawHeader(ctx: CanvasRenderingContext2D, model: DaySheetModel, theme: ChartTheme) {
  const { summary } = model;
  ctx.fillStyle = theme.textMuted;
  ctx.font = "700 24px system-ui";
  ctx.fillText(`DAY · ${model.sessionDate}`, PAD, 60);
  if (model.shield) {
    ctx.textAlign = "right";
    ctx.fillStyle = theme.goldMid;
    ctx.fillText("SHIELD", DAY_SHEET_WIDTH - PAD, 60);
    ctx.textAlign = "left";
  }
  ctx.fillStyle = theme.textPrimary;
  ctx.font = "850 54px system-ui";
  ctx.fillText(fitText(ctx, summary.dateLabel, DAY_SHEET_WIDTH - PAD * 2), PAD, 122);

  const money = summary.formattedNetMoney ? ` · ${summary.formattedNetMoney}` : "";
  const rules = summary.rulesTotal > 0 ? ` · RULES ${summary.rulesFollowed}/${summary.rulesTotal}` : "";
  ctx.fillStyle = summary.netR != null && summary.netR < 0 ? theme.risk : theme.profit;
  ctx.font = "750 30px ui-monospace, monospace";
  ctx.fillText(fitText(ctx, `${summary.tradeCount} ${summary.tradeCount === 1 ? "trade" : "trades"} · NET ${summary.formattedNetR}${money}${rules}`, DAY_SHEET_WIDTH - PAD * 2), PAD, 172);

  ctx.fillStyle = theme.textMuted;
  ctx.font = "600 20px system-ui";
  const winRate = summary.winRate != null ? ` · ${summary.winRate}% WIN RATE` : "";
  ctx.fillText(`${summary.winCount}W · ${summary.lossCount}L · ${summary.scratchCount}BE${winRate}`, PAD, 202);
}

function drawCard(ctx: CanvasRenderingContext2D, card: DaySheetCard, snapshot: DaySheetSnapshot | null | undefined, model: DaySheetModel, theme: ChartTheme) {
  ctx.fillStyle = theme.surface;
  roundedRect(ctx, card.x, card.y, card.width, card.height, 16);
  ctx.fill();
  ctx.strokeStyle = theme.chartBorder;
  ctx.lineWidth = 1;
  ctx.stroke();

  const box = card.chart;
  ctx.fillStyle = theme.chartBg;
  ctx.fillRect(box.x, box.y, box.width, box.height);
  if (snapshot && snapshot.width > 0 && snapshot.height > 0) {
    const scale = Math.min(box.width / snapshot.width, box.height / snapshot.height);
    const w = snapshot.width * scale;
    const h = snapshot.height * scale;
    ctx.drawImage(snapshot, box.x + (box.width - w) / 2, box.y + (box.height - h) / 2, w, h);
  } else {
    ctx.fillStyle = theme.textMuted;
    ctx.font = "600 22px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("Chart not in this export", box.x + box.width / 2, box.y + box.height / 2);
    ctx.textAlign = "left";
  }

  const { copy } = card;
  const lines: Array<{ text: string; font: string; color: string }> = [
    { text: copy.header, font: "800 24px system-ui", color: theme.goldLight },
    { text: `Fills  ${copy.fills}`, font: "600 20px ui-monospace, monospace", color: theme.textPrimary },
    { text: `Stop  ${copy.stop}`, font: "600 20px ui-monospace, monospace", color: theme.textPrimary },
    { text: `Target  ${copy.target}`, font: "600 20px ui-monospace, monospace", color: theme.textPrimary },
    {
      text: `Result  ${copy.result}`,
      font: "750 22px ui-monospace, monospace",
      color: copy.result.startsWith(SIGN_MINUS) ? theme.risk : copy.result.startsWith("+") ? theme.profit : theme.textPrimary,
    },
    { text: `Risk  ${copy.risk}`, font: "600 20px ui-monospace, monospace", color: theme.textPrimary },
    { text: copy.holdAndRules, font: "600 20px system-ui", color: theme.textMuted },
  ];
  const textX = card.x + CARD_INSET + 4;
  const maxWidth = card.width - CARD_INSET * 2 - 8;
  const firstY = box.y + box.height + CARD_INSET + model.lineHeight * 0.7;
  lines.forEach((line, index) => {
    ctx.font = line.font;
    ctx.fillStyle = line.color;
    ctx.fillText(fitText(ctx, line.text, maxWidth), textX, firstY + index * model.lineHeight);
  });
}

/**
 * Draws the day sheet. The caller sizes the canvas to model.width × model.height. Renders cleanly with zero trades
 * (a "no trades" state) and with a missing snapshot (a placeholder in the chart box).
 */
export function renderDaySheetCanvas(
  ctx: CanvasRenderingContext2D,
  model: DaySheetModel,
  snapshots: DaySheetSnapshots,
  theme: ChartTheme = DEFAULT_CARD_THEME,
) {
  const gradient = ctx.createLinearGradient(0, 0, model.width, model.height);
  gradient.addColorStop(0, theme.elevated);
  gradient.addColorStop(1, theme.chartBg);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, model.width, model.height);
  ctx.fillStyle = theme.goldMid;
  ctx.fillRect(0, 0, model.width, 1);
  ctx.strokeStyle = theme.chartBorder;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, model.width - 1, model.height - 1);

  drawHeader(ctx, model, theme);

  if (model.cards.length === 0) {
    ctx.textAlign = "center";
    ctx.fillStyle = theme.goldMid;
    ctx.font = "800 32px system-ui";
    ctx.fillText("NO TRADES EXECUTED", model.width / 2, model.headerHeight + 90);
    ctx.fillStyle = theme.textMuted;
    ctx.font = "550 22px system-ui";
    ctx.fillText("A day without trades is still a review.", model.width / 2, model.headerHeight + 136);
    ctx.textAlign = "left";
  }
  for (const card of model.cards) drawCard(ctx, card, snapshots[card.tradeId], model, theme);

  ctx.fillStyle = theme.textMuted;
  ctx.font = "500 20px ui-monospace, monospace";
  ctx.fillText(`MOGMINE · ${model.sessionDate}`, PAD, model.footerY);
  ctx.textAlign = "right";
  ctx.fillText(`n = ${model.summary.tradeCount}`, model.width - PAD, model.footerY);
  ctx.textAlign = "left";
}

/** Encodes the sheet to a PNG. Called before the Share tap so the tap has a Blob ready (UX-70). Browser only. */
export function encodeDaySheet(model: DaySheetModel, snapshots: DaySheetSnapshots, theme?: ChartTheme): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = model.width;
    canvas.height = model.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return reject(new Error("Canvas unavailable"));
    renderDaySheetCanvas(ctx, model, snapshots, theme ?? (typeof document !== "undefined" ? getTheme() : DEFAULT_CARD_THEME));
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Image export failed"))), "image/png");
  });
}
