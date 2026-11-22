// CD-3c: the playbook card as a PNG (docs/23 §2, §5). Same frame and layout tables as the Trade Card
// (`getCardLayout`); only the main area, stats row and context band differ. Canvas only (OD-8).
// Shield hides results entirely (§5.4): no stats, no drill result. Rules and the example stay.
import { playbookDrillLine, playbookExampleCaption, playbookSampleLine, playbookStatCells } from "./playbook-binder.ts";
import type { StatCell } from "./playbook-binder.ts";
import type { PlaybookCardData } from "./playbook-card.ts";
import { DEFAULT_CARD_THEME, getCardLayout } from "./shareCard.ts";
import type { CardSide, CardSize } from "./shareCard.ts";
import { getTheme } from "./theme.ts";
import type { ChartTheme } from "./theme.ts";

export interface PlaybookImageContent {
  header: string;
  name: string;
  /** Empty under Shield. */
  stats: StatCell[];
  caption: string;
  rules: string[];
  /** "Hidden by Shield" under Shield. */
  drill: string;
  footerLeft: string;
  footerRight: string;
}

/** Every word the PNG prints, so the Shield sweep is testable without a canvas. */
export function playbookImageContent(data: PlaybookCardData, shield: boolean, side: CardSide, dateLabel: string): PlaybookImageContent {
  return {
    header: `PLAYBOOK${side === "back" ? " · BACK" : ""}${shield ? " · SHIELD" : ""}`,
    name: data.name,
    stats: playbookStatCells(data, shield),
    caption: playbookExampleCaption(data),
    rules: data.rules,
    drill: playbookDrillLine(data, shield),
    footerLeft: `MOGMINE · ${dateLabel}`,
    // Under Shield the sample size still prints: it is a count of trades, not a result.
    footerRight: playbookSampleLine(data),
  };
}

/** `playbook-orb-reclaim-card-9x16-back.png`. Never a result, size or account (UX-72). */
export function playbookCardFileName(name: string, size: CardSize = "4:5", side: CardSide = "front") {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "playbook";
  const sizeSuffix = size === "4:5" ? "" : `-${size.replace(":", "x")}`;
  return `playbook-${slug}-card${sizeSuffix}${side === "back" ? "-back" : ""}.png`;
}

function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let short = text;
  while (short.length > 1 && ctx.measureText(`${short}…`).width > maxWidth) short = short.slice(0, -1);
  return `${short}…`;
}

/** Wraps by words; stops at `maxY` with an ellipsis so text never runs out of its band. Returns the next y. */
function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxY: number) {
  let line = "";
  let cursor = y;
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      if (cursor + lineHeight > maxY) { ctx.fillText(fit(ctx, `${line}…`, maxWidth), x, cursor); return cursor + lineHeight; }
      ctx.fillText(line, x, cursor);
      line = word;
      cursor += lineHeight;
    } else line = next;
  }
  if (line) ctx.fillText(fit(ctx, line, maxWidth), x, cursor);
  return cursor + lineHeight;
}

export interface RenderPlaybookCardOptions {
  size?: CardSize;
  side?: CardSide;
  shield?: boolean;
  theme?: ChartTheme;
  dateLabel: string;
}

/** Draws the card. `snapshot` is the example chart (`takeScreenshot(true)`), or null for `No example yet`. */
export function renderPlaybookCardCanvas(
  ctx: CanvasRenderingContext2D,
  snapshot: (CanvasImageSource & { width: number; height: number }) | null,
  data: PlaybookCardData,
  options: RenderPlaybookCardOptions,
) {
  const size = options.size ?? "4:5";
  const side = options.side ?? "front";
  const shield = options.shield ?? true;
  const layout = getCardLayout(size);
  const theme = options.theme ?? (typeof document !== "undefined" ? getTheme() : DEFAULT_CARD_THEME);
  const content = playbookImageContent(data, shield, side, options.dateLabel);
  const left = layout.paddingX + 16;
  const textWidth = layout.width - layout.paddingX * 2 - 32;

  // Frame: background, 1px gold top edge only, carbon hairline (docs/23 §2, invariant 5).
  const gradient = ctx.createLinearGradient(0, 0, layout.width, layout.height);
  gradient.addColorStop(0, theme.elevated);
  gradient.addColorStop(1, theme.chartBg);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.fillStyle = theme.goldMid;
  ctx.fillRect(0, 0, layout.width, 1);
  ctx.strokeStyle = theme.chartBorder;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, layout.width - 1, layout.height - 1);

  // Header band.
  ctx.textAlign = "left";
  ctx.fillStyle = theme.textMuted;
  ctx.font = "700 24px system-ui";
  ctx.fillText(content.header, layout.paddingX, layout.header.y + 28);
  ctx.fillStyle = theme.textPrimary;
  ctx.font = `850 ${size === "1:1" ? 52 : 60}px system-ui`;
  ctx.fillText(fit(ctx, content.name, layout.width - layout.paddingX * 2), layout.paddingX, layout.header.y + (size === "1:1" ? 82 : 98));

  // Main area.
  const main = layout.main;
  ctx.fillStyle = theme.surface;
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(main.x, main.y, main.width, main.height, 20);
  else ctx.rect(main.x, main.y, main.width, main.height);
  ctx.fill();

  if (side === "front") {
    if (snapshot && snapshot.width > 0 && snapshot.height > 0) {
      const scale = Math.min((main.width - main.innerMargin * 2) / snapshot.width, (main.height - main.innerMargin * 2) / snapshot.height);
      const w = snapshot.width * scale;
      const h = snapshot.height * scale;
      ctx.drawImage(snapshot, main.x + (main.width - w) / 2, main.y + (main.height - h) / 2, w, h);
    } else {
      ctx.fillStyle = theme.textMuted;
      ctx.font = "650 30px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(data.example ? "No saved bars for the example" : "No example yet", main.x + main.width / 2, main.y + main.height / 2);
      ctx.textAlign = "left";
    }
  } else {
    // Back: ordered rules, then the drill line (§5.2).
    const x = main.x + 32;
    const width = main.width - 64;
    const bottom = main.y + main.height - 24;
    let y = main.y + 48;
    ctx.fillStyle = theme.goldMid;
    ctx.font = "800 22px system-ui";
    ctx.fillText("RULES", x, y);
    y += 40;
    ctx.fillStyle = theme.textPrimary;
    ctx.font = "600 26px system-ui";
    if (!content.rules.length) {
      ctx.fillStyle = theme.textMuted;
      ctx.fillText("No rules on this playbook", x, y);
      y += 38;
    }
    content.rules.forEach((rule, index) => {
      if (y > bottom - 120) return;
      y = wrap(ctx, `${index + 1}. ${rule}`, x, y, width, 34, bottom - 120) + 6;
    });
    y += 18;
    ctx.fillStyle = theme.goldMid;
    ctx.font = "800 22px system-ui";
    ctx.fillText("DRILLS", x, y);
    y += 36;
    ctx.fillStyle = theme.textMuted;
    ctx.font = "600 22px ui-monospace, monospace";
    wrap(ctx, content.drill, x, y, width, 30, bottom);
  }

  // Stats row: three cells, or one line saying Shield hid them.
  const statsY = layout.stats.y;
  if (content.stats.length) {
    const cell = Math.floor(main.width / content.stats.length);
    content.stats.forEach((stat, index) => {
      const x = layout.paddingX + cell * index + 16;
      ctx.fillStyle = theme.textMuted;
      ctx.font = "650 22px system-ui";
      ctx.fillText(stat.label.toUpperCase(), x, statsY + 28);
      ctx.fillStyle = theme.textPrimary;
      const isText = /[a-z]{3}/.test(stat.value);
      ctx.font = isText ? "650 22px system-ui" : "750 34px ui-monospace, monospace";
      ctx.fillText(fit(ctx, stat.value, cell - 24), x, statsY + 68);
    });
  } else {
    ctx.fillStyle = theme.textMuted;
    ctx.font = "650 24px system-ui";
    ctx.fillText("Shield on · results hidden", left, statsY + 50);
  }

  // Context band: why this example on the front; the rule count on the back.
  ctx.fillStyle = theme.textMuted;
  ctx.font = "600 24px system-ui";
  const contextText = side === "front" ? content.caption : `${content.rules.length} ${content.rules.length === 1 ? "rule" : "rules"} · checked on every trade`;
  wrap(ctx, contextText, left, layout.context.y + 30, textWidth, 32, layout.context.y + layout.context.height);

  // Footer.
  const footerY = layout.footer.y + 24;
  ctx.font = "500 20px ui-monospace, monospace";
  ctx.fillText(fit(ctx, content.footerLeft, textWidth / 2), left, footerY);
  ctx.textAlign = "right";
  ctx.fillText(fit(ctx, content.footerRight, textWidth / 2), layout.width - layout.paddingX - 16, footerY);
  ctx.textAlign = "left";
}

export function buildPlaybookCard(
  snapshot: HTMLCanvasElement | null,
  data: PlaybookCardData,
  options: RenderPlaybookCardOptions,
) {
  return new Promise<Blob>((resolve, reject) => {
    const layout = getCardLayout(options.size ?? "4:5");
    const canvas = document.createElement("canvas");
    canvas.width = layout.width;
    canvas.height = layout.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return reject(new Error("Canvas unavailable"));
    renderPlaybookCardCanvas(ctx, snapshot, data, options);
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Image export failed"))), "image/png");
  });
}
