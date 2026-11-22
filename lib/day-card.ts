// CD-4 Day Card pure builder and canvas renderer (docs/23 §2, §6, OD-46).
// Shared card frame (CARD_LAYOUT_TABLE for 4:5, 9:16, 1:1), 1px specular gold top edge,
// process beats outcome (rules adherence %, net R, Shield privacy mode).
import { formatDuration, formatMoney, formatPoints, formatR } from "./format.ts";
import { playbookName } from "./playbooks.ts";
import { formatSessionDate, sessionDate } from "./session.ts";
import { DEFAULT_CARD_THEME, getCardLayout } from "./shareCard.ts";
import type { CardLayoutDimensions, CardSize } from "./shareCard.ts";
import { getTheme } from "./theme.ts";
import type { ChartTheme } from "./theme.ts";
import { adherence, holdSeconds, isOpen, rMultiple, tradePnl, tradePoints } from "./trades.ts";
import type { TradeRecord } from "./trades.ts";

export interface DayCardTradeItem {
  id: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  entryTime: string;
  exitTime: string | null;
  holdTimeText: string;
  rMultiple: number | null;
  formattedR: string;
  points: number | null;
  formattedPoints: string;
  pnl: number | null;
  formattedPnl: string | null;
  playbookName: string | null;
  rulesFollowed: number;
  rulesTotal: number;
  adherenceText: string;
  status: "open" | "closed";
}

export interface PlaybookDayCount {
  playbookId: string;
  name: string;
  count: number;
  netR: number | null;
}

export interface DayCardData {
  sessionDate: string;
  dateLabel: string;
  shield: boolean;
  tradeCount: number;
  closedTradeCount: number;
  openTradeCount: number;
  netR: number | null;
  formattedNetR: string;
  netPoints: number;
  formattedNetPoints: string;
  netMoney: number | null;
  formattedNetMoney: string | null;
  winCount: number;
  lossCount: number;
  scratchCount: number;
  winRate: number | null;
  rulesFollowed: number;
  rulesTotal: number;
  adherencePercent: number | null;
  playbookBreakdown: PlaybookDayCount[];
  trades: DayCardTradeItem[];
}

/**
 * File name for an exported Day Card PNG (docs/23 §2, §6, UX-72).
 * Never includes dollar figures, contract quantity, account IDs or balance.
 */
export function dayCardFileName(sessionDateStr: string, size: CardSize = "4:5"): string {
  const cleanDate = sessionDateStr.replace(/[^0-9\-]/g, "");
  const sizeSuffix = size === "4:5" ? "" : `-${size.replace(":", "x")}`;
  return `day-${cleanDate}-card${sizeSuffix}.png`;
}

/**
 * Pure data builder for a trading day (docs/23 §6, CD-4).
 * Filters real trades for the given session date, computes Net R, integer-tick points,
 * process checklist adherence, and strips all dollars / contract sizes when shield is true.
 */
export function buildDayCardData(
  targetDate: string,
  trades: readonly TradeRecord[],
  shield = true,
): DayCardData {
  const matchingTrades = trades
    .filter((trade) => {
      if (trade.is_sample) return false;
      if (!trade.entry_time) return false;
      try {
        const d = sessionDate(trade.entry_time);
        return d === targetDate || trade.entry_time.startsWith(targetDate);
      } catch {
        return trade.entry_time.startsWith(targetDate);
      }
    })
    .sort((a, b) => Date.parse(a.entry_time) - Date.parse(b.entry_time));

  let closedTradeCount = 0;
  let openTradeCount = 0;
  let winCount = 0;
  let lossCount = 0;
  let scratchCount = 0;
  let netPoints = 0;
  let netMoneyTotal = 0;
  let tradesWithMoney = 0;
  let rulesFollowed = 0;
  let rulesTotal = 0;

  const rValues: number[] = [];
  const playbookMap = new Map<string, { name: string; count: number; rList: number[] }>();

  const tradeItems: DayCardTradeItem[] = matchingTrades.map((t) => {
    const tradeOpen = isOpen(t);
    if (tradeOpen) {
      openTradeCount++;
    } else {
      closedTradeCount++;
    }

    const r = tradeOpen ? null : rMultiple(t);
    if (r != null) {
      rValues.push(r);
    }

    const pts = tradeOpen ? null : tradePoints(t);
    if (!tradeOpen && pts != null) {
      netPoints += pts;
      const rawPnl = tradePnl(t);
      if (rawPnl != null) {
        netMoneyTotal += rawPnl;
        tradesWithMoney++;
      }

      if (pts > 0) winCount++;
      else if (pts < 0) lossCount++;
      else scratchCount++;
    }

    const score = adherence(t);
    if (score) {
      rulesFollowed += score.followed;
      rulesTotal += score.total;
    }

    const resolvedPlaybookName =
      playbookName(t.playbook_id) ??
      (t.playbook_id ? playbookName(t.playbook_id.replace(/^pb-/, "")) ?? t.playbook_id : null);

    const pbKey = t.playbook_id || "unassigned";
    const pbEntry = playbookMap.get(pbKey) ?? {
      name: resolvedPlaybookName || "Unassigned",
      count: 0,
      rList: [],
    };
    pbEntry.count++;
    if (r != null) pbEntry.rList.push(r);
    playbookMap.set(pbKey, pbEntry);

    const pnlVal = shield || tradeOpen ? null : tradePnl(t);

    return {
      id: t.id,
      symbol: t.symbol,
      direction: t.direction,
      entryTime: t.entry_time,
      exitTime: t.exit_time,
      holdTimeText: formatDuration(holdSeconds(t)),
      rMultiple: r,
      formattedR: tradeOpen ? "OPEN" : formatR(r),
      points: pts,
      formattedPoints: tradeOpen ? "" : formatPoints(pts, t.symbol),
      pnl: pnlVal,
      formattedPnl: pnlVal != null ? formatMoney(pnlVal) : null,
      playbookName: resolvedPlaybookName,
      rulesFollowed: score ? score.followed : 0,
      rulesTotal: score ? score.total : 0,
      adherenceText: score ? `${score.followed}/${score.total}` : "—",
      status: tradeOpen ? "open" : "closed",
    };
  });

  const netR = rValues.length > 0 ? rValues.reduce((sum, val) => sum + val, 0) : null;
  const formattedNetR = formatR(netR);
  const formattedNetPoints = formatPoints(netPoints);
  const netMoney = shield || tradesWithMoney === 0 ? null : netMoneyTotal;
  const formattedNetMoney = netMoney != null ? formatMoney(netMoney) : null;

  const winRate = closedTradeCount > 0 ? Math.round((winCount / closedTradeCount) * 100) : null;
  const adherencePercent = rulesTotal > 0 ? Math.round((rulesFollowed / rulesTotal) * 100) : null;

  const playbookBreakdown: PlaybookDayCount[] = Array.from(playbookMap.entries()).map(([key, val]) => ({
    playbookId: key,
    name: val.name,
    count: val.count,
    netR: val.rList.length > 0 ? val.rList.reduce((s, r) => s + r, 0) : null,
  }));

  let formattedDateLabel = targetDate;
  try {
    formattedDateLabel = formatSessionDate(targetDate, true);
  } catch {
    formattedDateLabel = targetDate;
  }

  return {
    sessionDate: targetDate,
    dateLabel: formattedDateLabel,
    shield,
    tradeCount: matchingTrades.length,
    closedTradeCount,
    openTradeCount,
    netR,
    formattedNetR,
    netPoints,
    formattedNetPoints,
    netMoney,
    formattedNetMoney,
    winCount,
    lossCount,
    scratchCount,
    winRate,
    rulesFollowed,
    rulesTotal,
    adherencePercent,
    playbookBreakdown,
    trades: tradeItems,
  };
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let shortened = text;
  while (shortened.length > 1 && ctx.measureText(`${shortened}…`).width > maxWidth) {
    shortened = shortened.slice(0, -1);
  }
  return `${shortened}…`;
}

export interface RenderDayCardOptions {
  theme?: ChartTheme;
  size?: CardSize;
}

/**
 * Render Day Card onto a 2D canvas context using the shared CARD_LAYOUT_TABLE frame (docs/23 §2, §6).
 * Supports 4:5, 9:16 and 1:1 layouts. Respects Shield privacy mode and Invariant 5 (no hardcoded gold).
 */
export function renderDayCardCanvas(
  ctx: CanvasRenderingContext2D,
  data: DayCardData,
  themeOrOptions?: ChartTheme | RenderDayCardOptions,
  sizeArg?: CardSize,
) {
  let theme: ChartTheme;
  let size: CardSize = "4:5";

  if (themeOrOptions && "chartBg" in themeOrOptions) {
    theme = themeOrOptions;
    if (sizeArg) size = sizeArg;
  } else if (themeOrOptions && typeof themeOrOptions === "object") {
    theme = themeOrOptions.theme ?? (typeof document !== "undefined" ? getTheme() : DEFAULT_CARD_THEME);
    size = themeOrOptions.size ?? sizeArg ?? "4:5";
  } else {
    theme = typeof document !== "undefined" ? getTheme() : DEFAULT_CARD_THEME;
    if (sizeArg) size = sizeArg;
  }

  const layout: CardLayoutDimensions = getCardLayout(size);

  // 1. Frame: Background gradient
  const gradient = ctx.createLinearGradient(0, 0, layout.width, layout.height);
  gradient.addColorStop(0, theme.elevated);
  gradient.addColorStop(1, theme.chartBg);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, layout.width, layout.height);

  // 1px gold top edge specular highlight (Invariant 5, docs/23 §2)
  ctx.fillStyle = theme.goldMid;
  ctx.fillRect(0, 0, layout.width, 1);

  // Carbon hairline border
  ctx.strokeStyle = theme.chartBorder;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, layout.width - 1, layout.height - 1);

  // 2. Header Band: DAY · session date on left; SHIELD on right
  const headerY = layout.header.y;
  ctx.fillStyle = theme.textMuted;
  ctx.font = "700 24px system-ui";
  ctx.fillText(`DAY · ${data.sessionDate}`, layout.paddingX, headerY + 28);

  if (data.shield) {
    ctx.textAlign = "right";
    ctx.font = "700 24px system-ui";
    ctx.fillStyle = theme.goldMid;
    ctx.fillText("SHIELD", layout.width - layout.paddingX, headerY + 28);
    ctx.textAlign = "left";
  }

  // Session Date Label in bold
  ctx.fillStyle = theme.textPrimary;
  ctx.font = "850 54px system-ui";
  const dateHeading = fitText(ctx, data.dateLabel, layout.width - layout.paddingX * 2 - 160);
  ctx.fillText(dateHeading, layout.paddingX, headerY + 92);

  // 3. Main Area: Session Trades breakdown or empty discipline state (55%–60% of card height)
  ctx.fillStyle = theme.surface;
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(layout.main.x, layout.main.y, layout.main.width, layout.main.height, 20);
  } else {
    ctx.rect(layout.main.x, layout.main.y, layout.main.width, layout.main.height);
  }
  ctx.fill();

  ctx.strokeStyle = theme.chartBorder;
  ctx.lineWidth = 1;
  ctx.stroke();

  const mainPadding = layout.main.innerMargin + 16;
  const mainX = layout.main.x + mainPadding;
  const mainW = layout.main.width - mainPadding * 2;
  const mainTopY = layout.main.y + 40;

  if (data.tradeCount === 0) {
    // Zero-trade session: clean disciplined state (process beats outcome)
    const centerY = layout.main.y + layout.main.height / 2;
    ctx.textAlign = "center";
    ctx.fillStyle = theme.goldMid;
    ctx.font = "800 32px system-ui";
    ctx.fillText("NO TRADES EXECUTED", layout.width / 2, centerY - 24);

    ctx.fillStyle = theme.textMuted;
    ctx.font = "550 22px system-ui";
    ctx.fillText("Discipline maintained · Zero forced setups", layout.width / 2, centerY + 18);

    ctx.font = "600 20px ui-monospace, monospace";
    ctx.fillText("n = 0 trades", layout.width / 2, centerY + 54);
    ctx.textAlign = "left";
  } else {
    // Header inside main container
    ctx.fillStyle = theme.goldMid;
    ctx.font = "800 22px system-ui";
    ctx.fillText(`SESSION TRADES (${data.tradeCount})`, mainX, mainTopY);

    const maxRows = size === "1:1" ? 4 : size === "4:5" ? 6 : 9;
    const tradesToRender = data.trades.slice(0, maxRows);
    const rowH = Math.min(84, Math.floor((layout.main.height - 80) / maxRows));

    tradesToRender.forEach((tr, idx) => {
      const rowY = mainTopY + 24 + idx * rowH;

      // Subtle row card surface
      ctx.fillStyle = theme.elevated;
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(mainX, rowY, mainW, rowH - 10, 10);
      } else {
        ctx.rect(mainX, rowY, mainW, rowH - 10);
      }
      ctx.fill();

      // Hairline border for row
      ctx.strokeStyle = theme.chartBorder;
      ctx.lineWidth = 1;
      ctx.stroke();

      const itemMidY = rowY + (rowH - 10) / 2;

      // Col 1: Symbol & Direction arrow
      ctx.fillStyle = tr.direction === "LONG" ? theme.profit : theme.risk;
      ctx.font = "800 22px ui-monospace, monospace";
      const dirSymbol = tr.direction === "LONG" ? "▲" : "▼";
      ctx.fillText(`${tr.symbol} ${dirSymbol}`, mainX + 16, itemMidY + 6);

      // Col 2: Playbook tag pill
      if (tr.playbookName) {
        ctx.font = "700 16px system-ui";
        const pbText = tr.playbookName.toUpperCase();
        const pbW = ctx.measureText(pbText).width;
        const pillLeft = mainX + 130;
        ctx.fillStyle = theme.surface;
        ctx.fillRect(pillLeft, itemMidY - 14, pbW + 16, 26);
        ctx.strokeStyle = theme.goldMid;
        ctx.lineWidth = 1;
        ctx.strokeRect(pillLeft, itemMidY - 14, pbW + 16, 26);

        ctx.fillStyle = theme.goldLight;
        ctx.fillText(pbText, pillLeft + 8, itemMidY + 5);
      }

      // Col 3: Rules adherence text
      if (tr.rulesTotal > 0) {
        ctx.fillStyle = tr.rulesFollowed === tr.rulesTotal ? theme.profit : theme.textMuted;
        ctx.font = "650 18px system-ui";
        ctx.fillText(`✓ ${tr.adherenceText} RULES`, mainX + 370, itemMidY + 6);
      }

      // Col 4: Outcome (Hero R / points). Privacy sweep: NEVER show dollars or contracts!
      ctx.textAlign = "right";
      ctx.font = "750 24px ui-monospace, monospace";
      const outcomeTone = tr.rMultiple != null ? (tr.rMultiple >= 0 ? theme.profit : theme.risk) : theme.textPrimary;
      ctx.fillStyle = outcomeTone;
      ctx.fillText(tr.formattedR, mainX + mainW - 16, itemMidY + 6);
      ctx.textAlign = "left";
    });

    // Overflow note if trades exceed visible rows
    if (data.tradeCount > maxRows) {
      const overflowCount = data.tradeCount - maxRows;
      ctx.fillStyle = theme.textMuted;
      ctx.font = "600 18px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(`+ ${overflowCount} more ${overflowCount === 1 ? "trade" : "trades"} in session`, layout.width / 2, layout.main.y + layout.main.height - 18);
      ctx.textAlign = "left";
    }
  }

  // 4. Stats Row: 3 cells max (docs/23 §2)
  const statsY = layout.stats.y;
  const colWidth = Math.floor(layout.main.width / 3);

  // Cell 1: TRADES count
  const x0 = layout.paddingX + 16;
  ctx.fillStyle = theme.textMuted;
  ctx.font = "650 22px system-ui";
  ctx.fillText("TRADES", x0, statsY + 28);

  ctx.fillStyle = theme.textPrimary;
  ctx.font = "750 32px ui-monospace, monospace";
  ctx.fillText(`n = ${data.tradeCount}`, x0, statsY + 68);

  // Cell 2: NET R (Process outcome)
  const x1 = layout.paddingX + colWidth + 16;
  ctx.fillStyle = theme.textMuted;
  ctx.font = "650 22px system-ui";
  ctx.fillText("NET R", x1, statsY + 28);

  const netRTone = data.netR != null ? (data.netR >= 0 ? theme.profit : theme.risk) : theme.textPrimary;
  ctx.fillStyle = netRTone;
  ctx.font = "750 32px ui-monospace, monospace";
  ctx.fillText(data.formattedNetR, x1, statsY + 68);

  // Secondary detail under Net R: net points (safe under Shield)
  ctx.fillStyle = theme.textMuted;
  ctx.font = "600 18px ui-monospace, monospace";
  ctx.fillText(data.formattedNetPoints, x1, statsY + 94);

  // Cell 3: PROCESS ADHERENCE (Process beats outcome!)
  const x2 = layout.paddingX + colWidth * 2 + 16;
  ctx.fillStyle = theme.textMuted;
  ctx.font = "650 22px system-ui";
  ctx.fillText("PROCESS", x2, statsY + 28);

  ctx.fillStyle = data.adherencePercent != null && data.adherencePercent >= 80 ? theme.profit : theme.goldMid;
  ctx.font = "750 32px ui-monospace, monospace";
  const adherenceLabel = data.adherencePercent != null ? `${data.adherencePercent}%` : "—";
  ctx.fillText(adherenceLabel, x2, statsY + 68);

  ctx.fillStyle = theme.textMuted;
  ctx.font = "600 18px system-ui";
  const rulesDetail = data.rulesTotal > 0 ? `${data.rulesFollowed}/${data.rulesTotal} RULES` : "NO RULES";
  ctx.fillText(rulesDetail, x2, statsY + 94);

  // 5. Context Band: Playbooks, Win/Loss breakdown, discipline reminder
  let ctxY = layout.context.y + 24;

  if (data.playbookBreakdown.length > 0) {
    ctx.fillStyle = theme.goldMid;
    ctx.font = "800 22px system-ui";
    ctx.fillText("PLAYBOOKS", layout.paddingX + 16, ctxY);

    const pbSummary = data.playbookBreakdown.map((pb) => `${pb.name} (${pb.count})`).join(" · ");
    ctx.fillStyle = theme.textPrimary;
    ctx.font = "650 22px system-ui";
    ctx.fillText(fitText(ctx, pbSummary, layout.main.width - 200), layout.paddingX + 180, ctxY);
    ctxY += 34;
  }

  // Win / Loss / Scratch summary
  if (data.closedTradeCount > 0) {
    ctx.fillStyle = theme.textMuted;
    ctx.font = "650 20px system-ui";
    const winRateText = data.winRate != null ? ` · ${data.winRate}% WIN RATE` : "";
    const sessionRecord = `${data.winCount}W · ${data.lossCount}L · ${data.scratchCount}BE${winRateText}`;
    ctx.fillText(sessionRecord, layout.paddingX + 16, ctxY);
    ctxY += 30;
  }

  // Core philosophy badge
  ctx.fillStyle = theme.goldLight;
  ctx.font = "700 20px system-ui";
  ctx.fillText("PROCESS BEATS OUTCOME · DISCIPLINED EXECUTION", layout.paddingX + 16, ctxY);

  // 6. Footer Band: MOGMINE · session date · n = sample
  const footerY = layout.footer.y + 24;
  ctx.fillStyle = theme.textMuted;
  ctx.font = "500 20px ui-monospace, monospace";
  ctx.fillText(`MOGMINE · ${data.sessionDate}`, layout.paddingX + 16, footerY);

  ctx.textAlign = "right";
  ctx.fillText(`n = ${data.tradeCount}`, layout.width - layout.paddingX - 16, footerY);
  ctx.textAlign = "left";
}
