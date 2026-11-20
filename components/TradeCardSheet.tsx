"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { shareCardFileName } from "@/lib/shareCard";
import { showToast } from "@/lib/toast";
import type { TradeRecord } from "@/lib/trades";

interface Props {
  trade: TradeRecord;
  blob: Blob | null;
  privacy: boolean;
  onPrivacyChange: (privacy: boolean) => void;
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

function TradeCardPreview({ blob, alt }: { blob: Blob; alt: string }) {
  const [url] = useState(() => URL.createObjectURL(blob));
  const revokeTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(revokeTimer.current);
    return () => { revokeTimer.current = window.setTimeout(() => URL.revokeObjectURL(url), 0); };
  }, [url]);
  return <Image src={url} width={1080} height={1350} unoptimized alt={alt} />;
}

export function TradeCardSheet({ trade, blob, privacy, onPrivacyChange, onClose }: Props) {
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

  const file = () => blob ? new File([blob], shareCardFileName(trade), { type: "image/png" }) : null;

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
          {blob ? <TradeCardPreview blob={blob} alt={`${trade.symbol} Trade Card preview${privacy ? " in Shield mode" : ""}`} /> : <div className="trade-card-preparing"><span className="skeleton" /><b>Rebuilding private preview…</b></div>}
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
