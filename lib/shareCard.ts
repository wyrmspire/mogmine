// Trade Card image, composed on a canvas from the chart snapshot (OD-8: no html-to-image).
import { formatDuration, formatMoney, formatPrice } from "./format.ts";
import { getTheme } from "./theme.ts";
import { formatDateTime } from "./time.ts";
import { holdSeconds, tradePnl } from "./trades.ts";
import type { TradeRecord } from "./trades.ts";

export function buildShareCard(snapshot: HTMLCanvasElement, trade: TradeRecord, zone: string) {
  return new Promise<Blob>((resolve, reject) => {
    const theme = getTheme();
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
    ctx.fillStyle = theme.goldMid;
    ctx.font = "700 28px system-ui";
    ctx.fillText("MOGMINE / TRADE REVIEW", 68, 76);
    ctx.fillStyle = theme.textPrimary;
    ctx.font = "850 86px system-ui";
    ctx.fillText(trade.symbol, 68, 180);
    ctx.font = "700 30px ui-monospace, monospace";
    ctx.fillStyle = trade.direction === "LONG" ? theme.profit : theme.risk;
    ctx.fillText(`${trade.direction === "LONG" ? "▲" : "▼"} ${trade.direction} · ${formatDuration(holdSeconds(trade))}`, 72, 228);
    ctx.fillStyle = theme.surface;
    ctx.beginPath();
    ctx.roundRect(52, 280, 976, 690, 28);
    ctx.fill();
    const scale = Math.min(910 / snapshot.width, 610 / snapshot.height);
    const width = snapshot.width * scale;
    const height = snapshot.height * scale;
    ctx.drawImage(snapshot, 85 + (910 - width) / 2, 320 + (610 - height) / 2, width, height);
    const pnl = tradePnl(trade);
    const labels = ["ENTRY", "EXIT", "OUTCOME"];
    const values = [formatPrice(trade.entry_price, trade.symbol), formatPrice(trade.exit_price, trade.symbol), formatMoney(pnl)];
    labels.forEach((label, index) => {
      const x = 68 + index * 330;
      ctx.fillStyle = theme.textMuted;
      ctx.font = "650 28px system-ui";
      ctx.fillText(label, x, 1055);
      ctx.fillStyle = index === 2 ? (pnl >= 0 ? theme.profit : theme.risk) : theme.textPrimary;
      ctx.font = "750 38px ui-monospace, monospace";
      ctx.fillText(values[index], x, 1110);
    });
    ctx.fillStyle = theme.textMuted;
    ctx.font = "500 28px system-ui";
    ctx.fillText(formatDateTime(trade.entry_time, zone), 68, 1248);
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Image export failed")), "image/png");
  });
}
