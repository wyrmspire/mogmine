"use client";

// CD-3c: export sheet for the playbook card (docs/23 §1, §5.4). Mirrors TradeCardSheet: the PNG is
// prepared before any tap (UX-70), Shield is on when the sheet opens (§1.3), size and face pickers.
// Kept separate from TradeCardSheet, which is trade-specific; merge them when a third card needs one.
import Image from "next/image";
import { useEffect, useMemo, useRef } from "react";
import { playbookCardFileName } from "@/lib/playbook-card-image";
import { CARD_SIZES } from "@/lib/shareCard";
import type { CardSide, CardSize } from "@/lib/shareCard";
import { showToast } from "@/lib/toast";

interface Props {
  name: string;
  blob: Blob | null;
  failed: boolean;
  size: CardSize;
  side: CardSide;
  shield: boolean;
  onSize: (size: CardSize) => void;
  onSide: (side: CardSide) => void;
  onShield: (shield: boolean) => void;
  onRetry: () => void;
  onClose: () => void;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function Preview({ blob, size, alt }: { blob: Blob; size: CardSize; alt: string }) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const dim = CARD_SIZES[size];
  return <Image src={url} width={dim.width} height={dim.height} unoptimized alt={alt} style={{ aspectRatio: dim.aspectRatio }} />;
}

export function PlaybookCardSheet({ name, blob, failed, size, side, shield, onSize, onSide, onShield, onRetry, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab") return;
      const dialog = closeRef.current?.closest('[role="dialog"]');
      const focusable = dialog ? Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href]')) : [];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const file = () => (blob ? new File([blob], playbookCardFileName(name, size, side), { type: "image/png" }) : null);
  const share = async () => {
    const prepared = file();
    if (!prepared) return;
    try {
      if (navigator.share && navigator.canShare?.({ files: [prepared] })) await navigator.share({ title: `${name} playbook`, files: [prepared] });
      else { download(prepared, prepared.name); showToast("Sharing unavailable — image saved"); }
    } catch (error) {
      if ((error as DOMException).name !== "AbortError") showToast("Share failed");
    }
  };
  const save = () => {
    const prepared = file();
    if (!prepared) return;
    download(prepared, prepared.name);
    showToast("Playbook card saved");
  };

  return (
    <div className="sheet-backdrop trade-card-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="sheet trade-card-sheet" role="dialog" aria-modal="true" aria-labelledby="playbook-card-title" aria-describedby="playbook-card-status">
        <div className="sheet-head">
          <div><span className="eyebrow">Ready to export</span><h2 id="playbook-card-title">{name}</h2><p>Preview exactly what you will share or save.</p></div>
          <button ref={closeRef} type="button" className="icon-button" aria-label="Close playbook card export" onClick={onClose}>×</button>
        </div>

        <div className="trade-card-preview" aria-busy={!blob && !failed}>
          {blob ? (
            <Preview blob={blob} size={size} alt={`${name} playbook card ${side} preview in ${size}${shield ? " in Shield mode" : ""}`} />
          ) : failed ? (
            <div className="trade-card-preparing"><b>The image could not be made.</b></div>
          ) : (
            <div className="trade-card-preparing"><span className="skeleton" /><b>Preparing the image…</b></div>
          )}
        </div>

        <div className="trade-card-controls">
          <div className="segmented trade-card-sizes" role="radiogroup" aria-label="Card format">
            {(["4:5", "9:16", "1:1"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={size === value}
                aria-label={`Aspect ratio ${value}`}
                onClick={() => onSize(value)}
                style={{ minHeight: 44 }}
              >
                {value}
              </button>
            ))}
          </div>
          <div className="segmented trade-card-sides" role="radiogroup" aria-label="Card face">
            {(["front", "back"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={side === value}
                aria-label={`Export ${value === "front" ? "Front face" : "Back face"}`}
                onClick={() => onSide(value)}
                style={{ minHeight: 44 }}
              >
                {value === "front" ? "Front" : "Back"}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          role="switch"
          className="trade-card-privacy"
          aria-checked={shield}
          aria-label="Toggle Shield privacy for export"
          onClick={() => onShield(!shield)}
          style={{ minHeight: 44 }}
        >
          <span aria-hidden="true">♢</span>
          <span><b>Shield privacy</b><small>{shield ? "Results hidden · rules and the example only" : "Shows trades, win rate, average R and drills"}</small></span>
          <i aria-hidden="true" />
        </button>

        <p id="playbook-card-status" className="trade-card-status" role="status">
          {blob ? "Image prepared — actions start immediately." : failed ? "Export failed." : "Preparing the updated image…"}
        </p>
        <div className="trade-card-actions playbook-card-actions">
          {failed && !blob ? (
            <button type="button" className="btn-primary" onClick={onRetry} aria-label="Retry generating card image" style={{ minHeight: 44 }}>Try again</button>
          ) : (
            <>
              <button type="button" className="btn-primary" disabled={!blob} onClick={share} aria-label="Share playbook card image" style={{ minHeight: 44 }}>Share</button>
              <button type="button" className="btn-secondary" disabled={!blob} onClick={save} aria-label="Save playbook card image" style={{ minHeight: 44 }}>Save</button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
