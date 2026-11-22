"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef } from "react";
import { CARD_SIZES, shareCardFileName } from "@/lib/shareCard";
import type { CardSide, CardSize } from "@/lib/shareCard";
import { showToast } from "@/lib/toast";
import type { TradeRecord } from "@/lib/trades";

interface Props {
  trade: TradeRecord;
  blob: Blob | null;
  privacy: boolean;
  size?: CardSize;
  side?: CardSide;
  onPrivacyChange: (privacy: boolean) => void;
  onSizeChange?: (size: CardSize) => void;
  onSideChange?: (side: CardSide) => void;
  onClose: () => void;
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function TradeCardPreview({ blob, alt, size }: { blob: Blob; alt: string; size: CardSize }) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => {
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [url]);

  const dim = CARD_SIZES[size] ?? CARD_SIZES["4:5"];
  return (
    <Image
      src={url}
      width={dim.width}
      height={dim.height}
      unoptimized
      alt={alt}
      style={{ aspectRatio: dim.aspectRatio }}
    />
  );
}

export function TradeCardSheet({
  trade,
  blob,
  privacy,
  size = "4:5",
  side = "front",
  onPrivacyChange,
  onSizeChange,
  onSideChange,
  onClose,
}: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const ready = blob != null;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = closeRef.current?.closest('[role="dialog"]');
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const file = () => blob ? new File([blob], shareCardFileName(trade, size, side), { type: "image/png" }) : null;

  const share = async () => {
    const prepared = file();
    if (!prepared) return;
    try {
      if (navigator.share && navigator.canShare?.({ files: [prepared] })) {
        await navigator.share({ title: `${trade.symbol} trade review`, files: [prepared] });
      } else {
        downloadBlob(prepared, prepared.name);
        showToast("Sharing unavailable — image saved");
      }
    } catch (error) {
      if ((error as DOMException).name !== "AbortError") showToast("Share failed");
    }
  };

  const save = () => {
    const prepared = file();
    if (!prepared) return;
    downloadBlob(prepared, prepared.name);
    showToast("Trade card saved");
  };

  const copy = async () => {
    if (!blob) return;
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("Image clipboard unavailable");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      showToast("Trade card copied");
    } catch {
      showToast("Copy image is not available in this browser");
    }
  };

  return (
    <div className="sheet-backdrop trade-card-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="sheet trade-card-sheet" role="dialog" aria-modal="true" aria-labelledby="trade-card-title" aria-describedby="trade-card-status">
        <div className="sheet-head">
          <div><span className="eyebrow">Ready to export</span><h2 id="trade-card-title">Trade Card</h2><p>Preview exactly what you will share, save, or copy.</p></div>
          <button ref={closeRef} type="button" className="icon-button" aria-label="Close Trade Card" onClick={onClose}>×</button>
        </div>

        <div className="trade-card-preview" aria-busy={!ready}>
          {blob ? (
            <TradeCardPreview
              blob={blob}
              size={size}
              alt={`${trade.symbol} Trade Card ${side} preview in ${size}${privacy ? " in Shield mode" : ""}`}
            />
          ) : (
            <div className="trade-card-preparing"><span className="skeleton" /><b>Rebuilding card preview…</b></div>
          )}
        </div>

        <div className="trade-card-controls" aria-label="Trade Card format and face options">
          <div className="segmented trade-card-sizes" role="radiogroup" aria-label="Card format">
            {(["4:5", "9:16", "1:1"] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={size === s}
                onClick={() => onSizeChange?.(s)}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="segmented trade-card-sides" role="radiogroup" aria-label="Card face">
            {(["front", "back"] as const).map((face) => (
              <button
                key={face}
                type="button"
                role="radio"
                aria-checked={side === face}
                onClick={() => onSideChange?.(face)}
              >
                {face === "front" ? "Front" : "Back"}
              </button>
            ))}
          </div>
        </div>

        <button type="button" className="trade-card-privacy" aria-pressed={privacy} onClick={() => onPrivacyChange(!privacy)}>
          <span aria-hidden="true">♢</span>
          <span><b>Shield privacy</b><small>{privacy ? "R and points only · dollars and size hidden" : "Show dollars and contract size"}</small></span>
          <i aria-hidden="true" />
        </button>

        <p id="trade-card-status" className="trade-card-status" role="status">{ready ? "Image prepared — actions start immediately." : "Preparing the updated image…"}</p>
        <div className="trade-card-actions" aria-label="Trade Card actions">
          <button type="button" className="btn-primary" disabled={!ready} onClick={share}>Share</button>
          <button type="button" className="btn-secondary" disabled={!ready} onClick={save}>Save</button>
          <button type="button" className="btn-secondary" disabled={!ready} onClick={copy}>Copy</button>
        </div>
      </section>
    </div>
  );
}
