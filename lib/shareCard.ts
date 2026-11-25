// Trade Card image, composed on a canvas from the chart snapshot (OD-8: no html-to-image).
// Extends docs/23 (Card System: shared frame, layout tables for 4:5, 9:16, 1:1, hero R with process seal).
import { formatDuration, formatMoney, formatPoints, formatPrice, formatR } from "./format.ts";
import { describeMood, knownCount, moodPath } from "./mood.ts";
import type { MoodVector } from "./mood.ts";
import { playbookName } from "./playbooks.ts";
import { sessionDate } from "./session.ts";
import { getTheme } from "./theme.ts";
import type { ChartTheme } from "./theme.ts";
import { CHART_TOKENS } from "./chart-paint.ts";
import { formatDateTime } from "./time.ts";
import { adherence, holdSeconds, tradePnl, tradePoints } from "./trades.ts";
import type { RSizeOptions } from "./trades.ts";
import { resolveRSize, resultR } from "./r-size.ts";
import type { ChecklistItem, TradeRecord } from "./trades.ts";

export type CardSize = "4:5" | "9:16" | "1:1";
export type CardSide = "front" | "back";
export type CardType = "TRADE" | "DRILL" | "PLAYBOOK" | "DAY" | "PLAN" | "MISTAKE" | "CHALLENGE";

export interface CardBand {
  y: number;
  height: number;
}

export interface CardMainBand extends CardBand {
  x: number;
  width: number;
  innerMargin: number;
}

export interface CardLayoutDimensions {
  size: CardSize;
  width: number;
  height: number;
  aspectRatio: string;
  paddingX: number;
  header: CardBand;
  main: CardMainBand;
  stats: CardBand;
  context: CardBand;
  footer: CardBand;
}

export const CARD_SIZES: Record<CardSize, { width: number; height: number; aspectRatio: string }> = {
  "4:5": { width: 1080, height: 1350, aspectRatio: "4/5" },
  "9:16": { width: 1080, height: 1920, aspectRatio: "9/16" },
  "1:1": { width: 1080, height: 1080, aspectRatio: "1/1" },
};

/**
 * Shared card frame layout tables (docs/23 §2).
 * Each size is a layout table of band heights:
 * - The chart main area occupies 55% to 60% of total height across all sizes.
 * - The context band adapts to available space below the stats row.
 */
export const CARD_LAYOUT_TABLE: Record<CardSize, CardLayoutDimensions> = {
  "4:5": {
    size: "4:5",
    width: 1080,
    height: 1350,
    aspectRatio: "4/5",
    paddingX: 52,
    header: { y: 32, height: 128 },
    main: { x: 52, y: 176, width: 976, height: 770, innerMargin: 16 }, // 770 / 1350 = 57.04%
    stats: { y: 966, height: 84 },
    context: { y: 1066, height: 214 },
    footer: { y: 1294, height: 36 },
  },
  "9:16": {
    size: "9:16",
    width: 1080,
    height: 1920,
    aspectRatio: "9/16",
    paddingX: 52,
    header: { y: 44, height: 144 },
    main: { x: 52, y: 208, width: 976, height: 1100, innerMargin: 16 }, // 1100 / 1920 = 57.29%
    stats: { y: 1332, height: 100 },
    context: { y: 1456, height: 384 },
    footer: { y: 1858, height: 42 },
  },
  "1:1": {
    size: "1:1",
    width: 1080,
    height: 1080,
    aspectRatio: "1/1",
    paddingX: 52,
    header: { y: 24, height: 96 },
    main: { x: 52, y: 132, width: 976, height: 600, innerMargin: 14 }, // 600 / 1080 = 55.56%
    stats: { y: 746, height: 76 },
    context: { y: 836, height: 180 },
    footer: { y: 1030, height: 34 },
  },
};

export function getCardLayout(size: CardSize = "4:5"): CardLayoutDimensions {
  return CARD_LAYOUT_TABLE[size] ?? CARD_LAYOUT_TABLE["4:5"];
}

/**
 * File name for a shared or saved Trade Card PNG (UX-72, docs/23 §2).
 * Never includes dollar P&L, contract quantity, account identifiers or balance.
 */
export function shareCardFileName(
  trade: Pick<TradeRecord, "symbol" | "direction" | "entry_time">,
  size: CardSize = "4:5",
  side: CardSide = "front",
) {
  const symbol = trade.symbol.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const dir = trade.direction === "LONG" ? "long" : "short";
  const sizeSuffix = size === "4:5" ? "" : `-${size.replace(":", "x")}`;
  const sideSuffix = side === "back" ? "-back" : "";
  return `${symbol}-${dir}-${sessionDate(trade.entry_time)}-trade-card${sizeSuffix}${sideSuffix}.png`;
}

export const shareCardFilename = shareCardFileName;

/** Blind review verdict string representation (docs/23 §3, BET-03). */
export function formatBlindAnswer(takeAgain: TradeRecord["take_again"]): string | null {
  if (takeAgain === "yes") return "TAKE AGAIN ✓";
  if (takeAgain === "smaller") return "SMALLER";
  if (takeAgain === "pass") return "PASS";
  return null;
}

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
  // CD-1 additions (docs/23 §2–3):
  typeLabel: CardType;
  subject: string;
  heroResult: string;
  processSeal: string | null;
  blindAnswer: string | null;
  sampleSize?: number;
}

/** Pure card copy keeps the privacy sweep and exported-time rules testable without a DOM. */
export function shareCardContent(
  trade: TradeRecord,
  zone: string,
  privacy: boolean,
  options?: { cardType?: CardType; sampleSize?: number } & RSizeOptions,
): ShareCardContent {
  const score = adherence(trade);
  const quantity = `${trade.quantity} ${trade.quantity === 1 ? "contract" : "contracts"}`;
  const points = formatPoints(tradePoints(trade), trade.symbol);
  const r = resultR(trade, resolveRSize(trade, options?.accounts, options?.prefs));
  const formattedR = formatR(r);
  const blindAnswer = formatBlindAnswer(trade.take_again);
  const rulesText = score ? `${score.followed}/${score.total} RULES` : null;
  const processSeal = rulesText && blindAnswer ? `${rulesText} · ${blindAnswer}` : rulesText ?? blindAnswer;

  const heroResult = trade.exit_time == null ? "OPEN" : r != null ? formattedR : points;
  const typeLabel: CardType = options?.cardType ?? "TRADE";
  const subject = `${trade.symbol} ${trade.direction}`;

  return {
    direction: `${trade.direction === "LONG" ? "▲" : "▼"} ${trade.direction} · ${privacy ? "" : `${quantity} · `}${formatDuration(holdSeconds(trade))}`,
    entry: `ENTRY ${formatDateTime(trade.entry_time, zone)}`,
    exit: trade.exit_time == null ? "OPEN" : `EXIT ${formatDateTime(trade.exit_time, zone)}`,
    // An open trade is labelled OPEN and shows no result (OD-38, R-03c).
    outcome: trade.exit_time == null ? "OPEN" : privacy ? formattedR : formatMoney(tradePnl(trade)),
    outcomeDetail: trade.exit_time == null ? "" : privacy ? points : `${formattedR} · ${points}`,
    playbook: playbookName(trade.playbook_id) ?? (trade.playbook_id ? (playbookName(trade.playbook_id.replace(/^pb-/, "")) ?? trade.playbook_id) : null),
    tags: trade.quick_tags,
    rules: trade.checklist_state,
    ruleSeal: score ? `${score.followed}/${score.total} FOLLOWED` : null,
    typeLabel,
    subject,
    heroResult,
    processSeal,
    blindAnswer,
    sampleSize: options?.sampleSize,
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

/** The Mood Shape in the card's header area: faint spokes, a soft fill, solid and dashed outline. */
function drawMood(
  ctx: CanvasRenderingContext2D,
  vector: MoodVector,
  theme: ChartTheme,
  layout: CardLayoutDimensions,
) {
  const size = Math.min(108, layout.header.height - 20);
  const right = layout.width - layout.paddingX - 16;
  const left = right - size;
  const top = layout.header.y + Math.max(0, (layout.header.height - size) / 2) - 8;
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
  if (typeof Path2D !== "undefined") {
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
  }
  ctx.restore();
  const caption = moodCardCaption(vector);
  if (caption) {
    ctx.fillStyle = theme.textMuted;
    ctx.font = "650 18px system-ui";
    ctx.textAlign = "right";
    ctx.fillText(fitText(ctx, caption, 240), right, top + size + 18);
    ctx.textAlign = "left";
  }
}

export const DEFAULT_CARD_THEME: ChartTheme = {
  chartBg: "#07080C",
  gridH: "#161922",
  gridV: "#12141C",
  chartAxis: "#71788B",
  chartBorder: "#1B1E2B",
  crosshair: "#4B5563",
  candleUp: "#10B981",
  candleDown: "#EF4444",
  profit: "#10B981",
  risk: "#EF4444",
  profitText: "#10B981",
  lossText: "#EF4444",
  boxActual: "#10B981",
  boxPlanned: "#3B82F6",
  goldMid: "#D4AF37",
  goldLight: "#F3E5AB",
  textPrimary: "#F3F4F6",
  textMuted: "#9CA3AF",
  surface: "#0D0F17",
  elevated: "#131622",
  boxOpacity: 0.28,
  levelResistance: "#EF4444",
  levelSupport: "#10B981",
  levelAdr: "#F59E0B",
  levelNeutral: "#6B7280",
  levelLabelText: "#F3F4F6",
  vwap: "#F472B6",
  crosshairLabel: CHART_TOKENS.surface.crosshairLabel,
  zoneReward: CHART_TOKENS.zone.reward,
  zoneRisk: CHART_TOKENS.zone.risk,
  entryLine: CHART_TOKENS.line.entry,
  labelMuted: CHART_TOKENS.line.labelMuted,
  chipReward: CHART_TOKENS.chip.reward,
  chipRisk: CHART_TOKENS.chip.risk,
  chipNeutral: CHART_TOKENS.chip.neutral,
  chipWarn: CHART_TOKENS.chip.warn,
  chipGhost: CHART_TOKENS.chip.ghost,
  fontMono: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSans: "ui-sans-serif, system-ui, sans-serif",
};

export interface RenderCardCanvasOptions {
  size?: CardSize;
  side?: "front" | "back";
  blindAnswer?: string | null;
  theme?: ChartTheme;
  sampleSize?: number;
}

/**
 * Render the shared card frame and contents onto a 2D canvas context (docs/23 §2–3).
 * Pure composition function testable with mock canvas contexts.
 */
export function renderCardCanvas(
  ctx: CanvasRenderingContext2D,
  snapshot: CanvasImageSource & { width: number; height: number },
  trade: TradeRecord,
  zone: string,
  privacy = false,
  mood: MoodVector | null = null,
  options?: RenderCardCanvasOptions,
) {
  const size = options?.size ?? "4:5";
  const side = options?.side ?? "front";
  const layout = getCardLayout(size);
  const theme = options?.theme ?? (typeof document !== "undefined" ? getTheme() : DEFAULT_CARD_THEME);
  const content = shareCardContent(trade, zone, privacy, {
    cardType: "TRADE",
    sampleSize: options?.sampleSize,
  });

  // Background gradient
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

  // Header band: TYPE LABEL · subject on left; SHIELD on right
  const headerY = layout.header.y;
  ctx.fillStyle = theme.textMuted;
  ctx.font = "700 24px system-ui";
  const headerTag = side === "back" ? `${content.typeLabel} · ${content.subject} · BACK` : `${content.typeLabel} · ${content.subject}`;
  ctx.fillText(headerTag, layout.paddingX, headerY + 28);

  // Playbook tag in header band if present (M3-Card, #42, docs/23 §2)
  if (content.playbook) {
    const headerTagWidth = ctx.measureText(headerTag).width;
    const pbTagText = content.playbook.toUpperCase();
    ctx.font = "700 18px system-ui";
    const pbTagWidth = ctx.measureText(pbTagText).width;
    const pillX = layout.paddingX + headerTagWidth + 18;
    const maxPillRight = privacy ? layout.width - layout.paddingX - 120 : layout.width - layout.paddingX - 16;
    if (pillX + pbTagWidth + 24 <= maxPillRight) {
      const pillW = pbTagWidth + 20;
      const pillH = 26;
      const pillY = headerY + 8;
      ctx.fillStyle = theme.surface;
      ctx.strokeStyle = theme.goldMid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(pillX, pillY, pillW, pillH, 6);
      } else {
        ctx.rect(pillX, pillY, pillW, pillH);
      }
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = theme.goldLight;
      ctx.fillText(pbTagText, pillX + 10, pillY + 19);
    }
  }

  if (privacy) {
    ctx.textAlign = "right";
    ctx.font = "700 24px system-ui";
    ctx.fillStyle = theme.goldMid;
    ctx.fillText("SHIELD", layout.width - layout.paddingX, headerY + 28);
    ctx.textAlign = "left";
  }

  // Symbol & Direction/Hold
  ctx.fillStyle = theme.textPrimary;
  ctx.font = "850 68px system-ui";
  ctx.fillText(trade.symbol, layout.paddingX, headerY + 98);

  ctx.font = "700 24px ui-monospace, monospace";
  ctx.fillStyle = trade.direction === "LONG" ? theme.profit : theme.risk;
  ctx.fillText(content.direction, layout.paddingX + 220, headerY + 92);

  // Mood shape in header
  if (mood && knownCount(mood)) {
    drawMood(ctx, mood, theme, layout);
  }

  // Main Area: Chart Snapshot on front, full thesis/notes/checklist on back (occupies 55% to 60% of card height)
  ctx.fillStyle = theme.surface;
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(layout.main.x, layout.main.y, layout.main.width, layout.main.height, 20);
  } else {
    ctx.rect(layout.main.x, layout.main.y, layout.main.width, layout.main.height);
  }
  ctx.fill();

  if (side === "front") {
    const availW = layout.main.width - layout.main.innerMargin * 2;
    const availH = layout.main.height - layout.main.innerMargin * 2;
    const scale = Math.min(availW / snapshot.width, availH / snapshot.height);
    const dw = snapshot.width * scale;
    const dh = snapshot.height * scale;
    const dx = layout.main.x + (layout.main.width - dw) / 2;
    const dy = layout.main.y + (layout.main.height - dh) / 2;
    ctx.drawImage(snapshot, dx, dy, dw, dh);
  } else {
    // Back side: full thesis, management and post-exit notes, full rule list (docs/23 §3)
    let backY = layout.main.y + 36;
    const backX = layout.main.x + 32;
    const maxBackW = layout.main.width - 64;

    // Thesis
    ctx.fillStyle = theme.goldMid;
    ctx.font = "800 20px system-ui";
    ctx.fillText("PRE-TRADE THESIS", backX, backY);
    backY += 28;

    ctx.fillStyle = theme.textPrimary;
    ctx.font = "550 22px system-ui";
    const thesisText = trade.pre_trade_thesis || trade.note || "No thesis recorded";
    backY = fillWrapped(ctx, thesisText, backX, backY, maxBackW, 28);
    backY += 32;

    // Management Notes
    if (trade.management_notes) {
      ctx.fillStyle = theme.goldMid;
      ctx.font = "800 20px system-ui";
      ctx.fillText("TRADE MANAGEMENT", backX, backY);
      backY += 28;

      ctx.fillStyle = theme.textPrimary;
      ctx.font = "550 22px system-ui";
      backY = fillWrapped(ctx, trade.management_notes, backX, backY, maxBackW, 28);
      backY += 32;
    }

    // Post-Exit Notes
    if (trade.post_exit_notes) {
      ctx.fillStyle = theme.goldMid;
      ctx.font = "800 20px system-ui";
      ctx.fillText("POST-EXIT NOTES", backX, backY);
      backY += 28;

      ctx.fillStyle = theme.textPrimary;
      ctx.font = "550 22px system-ui";
      backY = fillWrapped(ctx, trade.post_exit_notes, backX, backY, maxBackW, 28);
      backY += 32;
    }

    // Checklist
    if (content.rules.length > 0) {
      ctx.fillStyle = theme.goldMid;
      ctx.font = "800 20px system-ui";
      const sealInfo = content.ruleSeal ? ` · ${content.ruleSeal}` : "";
      ctx.fillText(`PLAYBOOK CHECKLIST${sealInfo}`, backX, backY);
      backY += 28;

      const maxBackRules = size === "1:1" ? 4 : size === "4:5" ? 6 : 9;
      const rulesToShow = content.rules.slice(0, maxBackRules);
      rulesToShow.forEach((rule, idx) => {
        ctx.fillStyle = rule.checked ? theme.textPrimary : theme.textMuted;
        ctx.font = "600 20px system-ui";
        ctx.fillText(fitText(ctx, `${rule.checked ? "✓" : "○"} ${rule.label}`, maxBackW), backX, backY + idx * 26);
      });
    }
  }

  // Stats Row: tabular-nums, 3 cells max
  const statsY = layout.stats.y;
  const colWidth = Math.floor(layout.main.width / 3);
  const pnl = tradePnl(trade);

  // Cell 1: ENTRY
  const x0 = layout.paddingX + 16;
  ctx.fillStyle = theme.textMuted;
  ctx.font = "650 22px system-ui";
  ctx.fillText("ENTRY", x0, statsY + 28);
  ctx.fillStyle = theme.textPrimary;
  ctx.font = "750 32px ui-monospace, monospace";
  ctx.fillText(fitText(ctx, formatPrice(trade.entry_price, trade.symbol), colWidth - 24), x0, statsY + 68);

  // Cell 2: EXIT
  const x1 = layout.paddingX + colWidth + 16;
  ctx.fillStyle = theme.textMuted;
  ctx.font = "650 22px system-ui";
  ctx.fillText("EXIT", x1, statsY + 28);
  ctx.fillStyle = theme.textPrimary;
  ctx.font = "750 32px ui-monospace, monospace";
  ctx.fillText(fitText(ctx, trade.exit_time == null ? "OPEN" : formatPrice(trade.exit_price, trade.symbol), colWidth - 24), x1, statsY + 68);

  // Cell 3: OUTCOME / HERO R with process seal beside it (docs/23 §3)
  const x2 = layout.paddingX + colWidth * 2 + 16;
  ctx.fillStyle = theme.textMuted;
  ctx.font = "650 22px system-ui";
  ctx.fillText(privacy ? "HERO R · PROCESS" : "OUTCOME", x2, statsY + 28);

  if (privacy) {
    ctx.font = "750 30px ui-monospace, monospace";
    ctx.fillStyle = pnl != null && pnl >= 0 ? theme.profit : theme.risk;
    const heroText = content.heroResult;
    ctx.fillText(heroText, x2, statsY + 68);

    if (content.processSeal) {
      const heroWidth = ctx.measureText(heroText).width;
      ctx.fillStyle = theme.goldMid;
      ctx.font = "700 20px system-ui";
      const maxSealWidth = layout.width - layout.paddingX - (x2 + heroWidth + 16);
      ctx.fillText(fitText(ctx, content.processSeal, maxSealWidth), x2 + heroWidth + 16, statsY + 66);
    }
  } else {
    ctx.fillStyle = pnl != null ? (pnl >= 0 ? theme.profit : theme.risk) : theme.textPrimary;
    ctx.font = "750 30px ui-monospace, monospace";
    ctx.fillText(fitText(ctx, content.outcome, colWidth - 24), x2, statsY + 68);
  }

  // Outcome detail (points or R · points)
  if (content.outcomeDetail) {
    ctx.fillStyle = theme.textMuted;
    ctx.font = "600 20px ui-monospace, monospace";
    fillWrapped(ctx, content.outcomeDetail, x2, statsY + 98, colWidth - 24, 24);
  }

  // Context Band: why: playbook · thesis · rules
  let ctxY = layout.context.y + 24;
  if (content.playbook) {
    ctx.fillStyle = theme.goldMid;
    ctx.font = "800 22px system-ui";
    ctx.fillText("PLAYBOOK", layout.paddingX + 16, ctxY);
    ctx.fillStyle = theme.textPrimary;
    ctx.font = "650 22px system-ui";
    ctx.fillText(fitText(ctx, content.playbook, layout.main.width - 200), layout.paddingX + 180, ctxY);
    ctxY += 34;
  }

  if (content.tags.length) {
    ctx.fillStyle = theme.textMuted;
    ctx.font = "650 22px system-ui";
    ctx.fillText(fitText(ctx, content.tags.map((t) => `#${t.replaceAll(" ", "")}`).join("  "), layout.main.width - 32), layout.paddingX + 16, ctxY);
    ctxY += 34;
  }

  if (content.ruleSeal) {
    ctx.fillStyle = theme.goldMid;
    ctx.font = "800 22px system-ui";
    ctx.fillText(`RULES · ${content.ruleSeal}`, layout.paddingX + 16, ctxY);
    ctxY += 32;

    const maxRules = size === "1:1" ? 2 : size === "4:5" ? 4 : 6;
    const rulesToDisplay = content.rules.slice(0, maxRules);
    rulesToDisplay.forEach((rule, idx) => {
      ctx.fillStyle = rule.checked ? theme.textPrimary : theme.textMuted;
      ctx.font = "600 22px system-ui";
      ctx.fillText(fitText(ctx, `${rule.checked ? "✓" : "○"} ${rule.label}`, layout.main.width - 32), layout.paddingX + 16, ctxY + idx * 28);
    });
  }

  // Footer Band: mogmine · date · n = sample
  const footerY = layout.footer.y + 24;
  ctx.fillStyle = theme.textMuted;
  ctx.font = "500 20px ui-monospace, monospace";
  ctx.fillText(fitText(ctx, `MOGMINE · ${content.entry.replace("ENTRY ", "")}`, 600), layout.paddingX + 16, footerY);

  ctx.textAlign = "right";
  const footerRight = content.sampleSize ? `n = ${content.sampleSize}` : content.exit;
  ctx.fillText(fitText(ctx, footerRight, 350), layout.width - layout.paddingX - 16, footerY);
  ctx.textAlign = "left";
}

export function buildShareCard(
  snapshot: HTMLCanvasElement,
  trade: TradeRecord,
  zone: string,
  privacy = false,
  mood: MoodVector | null = null,
  options?: RenderCardCanvasOptions,
) {
  return new Promise<Blob>((resolve, reject) => {
    const size = options?.size ?? "4:5";
    const layout = getCardLayout(size);
    const canvas = document.createElement("canvas");
    canvas.width = layout.width;
    canvas.height = layout.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return reject(new Error("Canvas unavailable"));

    renderCardCanvas(ctx, snapshot, trade, zone, privacy, mood, options);

    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Image export failed")), "image/png");
  });
}

/** Why a Trade Card encode was requested. Notes typing must never encode a PNG. */
export type ShareCardBuildReason = "sheet-open" | "share" | "privacy" | "view-change" | "notes" | "chart-render";

/**
 * Encode the Trade Card only when the trader is looking at or sharing it,
 * or when an already-open sheet must pick up a new chart view. A notes keystroke
 * never encodes. A background chart redraw encodes only if the sheet is open.
 */
export function shouldBuildShareCard(reason: ShareCardBuildReason, sheetOpen: boolean): boolean {
  if (reason === "notes") return false;
  if (reason === "sheet-open" || reason === "share" || reason === "privacy") return true;
  if (reason === "view-change" || reason === "chart-render") return sheetOpen;
  return false;
}
