// Trade Card image, composed on a canvas from the chart snapshot (OD-8: no html-to-image).
import { formatDuration, formatMoney, formatPoints, formatPrice, formatR } from "./format.ts";
import { describeMood, knownCount, moodPath } from "./mood.ts";
import type { MoodVector } from "./mood.ts";
import { playbookName } from "./playbooks.ts";
import { sessionDate } from "./session.ts";
import { getTheme } from "./theme.ts";
import { formatDateTime } from "./time.ts";
import { adherence, holdSeconds, rMultiple, tradePnl, tradePoints } from "./trades.ts";
import type { ChecklistItem, TradeRecord } from "./trades.ts";

/**
 * File name for a shared or saved Trade Card PNG (UX-72).
 * Never includes dollar P&L, contract quantity, account identifiers or balance.
 */
export function shareCardFileName(trade: Pick<TradeRecord, "symbol" | "direction" | "entry_time">) {
  const symbol = trade.symbol.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const side = trade.direction === "LONG" ? "long" : "short";
  return `${symbol}-${side}-${sessionDate(trade.entry_time)}-trade-card.png`;
}

export const shareCardFilename = shareCardFileName;

export interface ShareCardContent {
  direction: string;
  entry: string;
  exit: string;
  outcome: string;
  outcomeDetail: string;
  playbook: string | null;
  tags: string[];
  rules: ChecklistItem[];
  ruleSeal: string | null;
}

/** Pure card copy keeps the privacy sweep and exported-time rules testable without a DOM. */
export function shareCardContent(trade: TradeRecord, zone: string, privacy: boolean): ShareCardContent {
  const score = adherence(trade);
  const quantity = `${trade.quantity} ${trade.quantity === 1 ? "contract" : "contracts"}`;
  const points = formatPoints(tradePoints(trade), trade.symbol);
  const r = formatR(rMultiple(trade));
  return {
    direction: `${trade.direction === "LONG" ? "▲" : "▼"} ${trade.direction} · ${privacy ? "" : `${quantity} · `}${formatDuration(holdSeconds(trade))}`,
    entry: `ENTRY ${formatDateTime(trade.entry_time, zone)}`,
    exit: trade.exit_time == null ? "OPEN" : `EXIT ${formatDateTime(trade.exit_time, zone)}`,
    // An open trade is labelled OPEN and shows no result (OD-38, R-03c).
    outcome: trade.exit_time == null ? "OPEN" : privacy ? r : formatMoney(tradePnl(trade)),
    outcomeDetail: trade.exit_time == null ? "" : privacy ? points : `${r} · ${points}`,
    playbook: playbookName(trade.playbook_id),
    tags: trade.quick_tags,
    rules: trade.checklist_state,
    ruleSeal: score ? `${score.followed}/${score.total} FOLLOWED` : null,
  };
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let shortened = text;
  while (shortened.length > 1 && ctx.measureText(`${shortened}…`).width > maxWidth) shortened = shortened.slice(0, -1);
  return `${shortened}…`;
}

/** Word-wrap a line instead of ellipsizing, so outcome R/points never clip. */
function fillWrapped(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
) {
  if (ctx.measureText(text).width <= maxWidth) {
    ctx.fillText(text, x, y);
    return y;
  }
  const words = text.split(/\s+/);
  let line = "";
  let cursor = y;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      ctx.fillText(line, x, cursor);
      line = word;
      cursor += lineHeight;
    } else {
      line = next;
    }
  }
  if (line) ctx.fillText(line, x, cursor);
  return cursor;
}

/** First phrase of the mood description for the card: "FOMO high", "Balanced". Null when nothing is scored. */
export function moodCardCaption(vector: MoodVector | null | undefined) {
  if (!vector || !knownCount(vector)) return null;
  return describeMood(vector).split(" · ")[0];
}

/** The Mood Shape in the card's top-right corner: faint spokes, a soft fill, solid and dashed outline. */
function drawMood(ctx: CanvasRenderingContext2D, vector: MoodVector, theme: ReturnType<typeof getTheme>) {
  // Right of the symbol, above the chart panel (y 266), clear of the SHIELD badge (y 76).
  const size = 128;
  const left = 1012 - size;
  const top = 92;
  const geometry = moodPath(vector.values, { size, padding: 6 });
  const ring = moodPath(vector.values.map(() => 1), { size, padding: 6 });
  if (!geometry || !ring) return;
  ctx.save();
  ctx.translate(left, top);
  ctx.strokeStyle = theme.textMuted;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1;
  for (const point of ring.points) {
    ctx.beginPath();
    ctx.moveTo(ring.center, ring.center);
    ctx.lineTo(point.axisX, point.axisY);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = theme.textPrimary;
  ctx.fill(new Path2D(geometry.fill));
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = theme.textPrimary;
  ctx.lineWidth = 3;
  if (geometry.solid) ctx.stroke(new Path2D(geometry.solid));
  if (geometry.dashed) {
    ctx.setLineDash([6, 6]);
    ctx.globalAlpha = 0.5;
    ctx.stroke(new Path2D(geometry.dashed));
    ctx.setLineDash([]);
  }
  ctx.restore();
  const caption = moodCardCaption(vector);
  if (caption) {
    ctx.fillStyle = theme.textMuted;
    ctx.font = "650 22px system-ui";
    ctx.textAlign = "right";
    ctx.fillText(fitText(ctx, caption, 300), 1012, top + size + 24);
    ctx.textAlign = "left";
  }
}

export function buildShareCard(snapshot: HTMLCanvasElement, trade: TradeRecord, zone: string, privacy = false, mood: MoodVector | null = null) {
  return new Promise<Blob>((resolve, reject) => {
    const theme = getTheme();
    const content = shareCardContent(trade, zone, privacy);
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1350;
    const ctx = canvas.getContext("2d");
    if (!ctx) return reject(new Error("Canvas unavailable"));

    const gradient = ctx.createLinearGradient(0, 0, 1080, 1350);
    gradient.addColorStop(0, theme.elevated);
    gradient.addColorStop(1, theme.chartBg);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1080, 1350);

    // Gold is reserved for good process (#80): only the RULES seal below keeps it.
    // Brand heading, the SHIELD badge and the PLAYBOOK label are neutral metadata.
    ctx.fillStyle = theme.textMuted;
    ctx.font = "700 28px system-ui";
    ctx.fillText("MOGMINE / TRADE REVIEW", 68, 76);
    if (privacy) {
      ctx.textAlign = "right";
      ctx.fillText("SHIELD", 1012, 76);
      ctx.textAlign = "left";
    }

    ctx.fillStyle = theme.textPrimary;
    ctx.font = "850 86px system-ui";
    ctx.fillText(trade.symbol, 68, 180);
    ctx.font = "700 30px ui-monospace, monospace";
    ctx.fillStyle = trade.direction === "LONG" ? theme.profit : theme.risk;
    ctx.fillText(content.direction, 72, 228);
    // Mood is the trader's state, not a result: neutral colours, no gold (#80), drawn only when scored.
    if (mood && knownCount(mood)) drawMood(ctx, mood, theme);

    ctx.fillStyle = theme.surface;
    ctx.beginPath();
    ctx.roundRect(52, 266, 976, 548, 28);
    ctx.fill();
    const scale = Math.min(910 / snapshot.width, 482 / snapshot.height);
    const width = snapshot.width * scale;
    const height = snapshot.height * scale;
    ctx.drawImage(snapshot, 85 + (910 - width) / 2, 299 + (482 - height) / 2, width, height);

    const metricLabels = ["ENTRY", "EXIT", privacy ? "R / POINTS" : "OUTCOME"];
    const metricValues = [formatPrice(trade.entry_price, trade.symbol), formatPrice(trade.exit_price, trade.symbol), content.outcome];
    const pnl = tradePnl(trade);
    metricLabels.forEach((label, index) => {
      const x = 68 + index * 330;
      ctx.fillStyle = theme.textMuted;
      ctx.font = "650 28px system-ui";
      ctx.fillText(label, x, 868);
      ctx.fillStyle = index === 2 && pnl != null ? (pnl >= 0 ? theme.profit : theme.risk) : theme.textPrimary;
      ctx.font = index === 2 ? "750 32px ui-monospace, monospace" : "750 38px ui-monospace, monospace";
      ctx.fillText(fitText(ctx, metricValues[index], 300), x, 922);
    });
    ctx.fillStyle = theme.textMuted;
    ctx.font = "600 24px ui-monospace, monospace";
    fillWrapped(ctx, content.outcomeDetail, 728, 970, 1080 - 68 - 728, 32);

    let metadataY = 1028;
    if (content.playbook) {
      ctx.fillStyle = theme.textMuted;
      ctx.font = "700 28px system-ui";
      ctx.fillText("PLAYBOOK", 68, metadataY);
      ctx.fillStyle = theme.textPrimary;
      ctx.fillText(fitText(ctx, content.playbook, 720), 255, metadataY);
      metadataY += 44;
    }
    if (content.tags.length) {
      ctx.fillStyle = theme.textMuted;
      ctx.font = "650 28px system-ui";
      ctx.fillText(fitText(ctx, content.tags.map((tag) => `#${tag.replaceAll(" ", "")}`).join("  "), 944), 68, metadataY);
      metadataY += 46;
    }
    if (content.ruleSeal) {
      ctx.fillStyle = theme.goldMid;
      ctx.font = "800 28px system-ui";
      ctx.fillText(`RULES · ${content.ruleSeal}`, 68, metadataY);
      metadataY += 40;
      content.rules.forEach((rule, index) => {
        ctx.fillStyle = rule.checked ? theme.textPrimary : theme.textMuted;
        ctx.font = "600 28px system-ui";
        ctx.fillText(fitText(ctx, `${rule.checked ? "✓" : "○"} ${rule.label}`, 944), 68, metadataY + index * 34);
      });
    }

    ctx.fillStyle = theme.textMuted;
    ctx.font = "500 28px ui-monospace, monospace";
    ctx.fillText(fitText(ctx, content.entry, 944), 68, 1288);
    ctx.fillText(fitText(ctx, content.exit, 944), 68, 1324);

    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Image export failed")), "image/png");
  });
}

/** Why a Trade Card encode was requested. Notes typing must never encode a PNG. */
export type ShareCardBuildReason = "sheet-open" | "share" | "privacy" | "view-change" | "notes" | "chart-render";

/**
 * Encode the 1080×1350 Trade Card only when the trader is looking at or sharing it,
 * or when an already-open sheet must pick up a new chart view. A notes keystroke
 * never encodes. A background chart redraw encodes only if the sheet is open.
 */
export function shouldBuildShareCard(reason: ShareCardBuildReason, sheetOpen: boolean): boolean {
  if (reason === "notes") return false;
  if (reason === "sheet-open" || reason === "share" || reason === "privacy") return true;
  if (reason === "view-change" || reason === "chart-render") return sheetOpen;
  return false;
}
