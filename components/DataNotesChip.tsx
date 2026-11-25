"use client";

import { useId, useState } from "react";
import { usePathname } from "next/navigation";
import { dataNoteCountLabel, hasUntrustedDataNote } from "@/lib/data-notes";
import type { DataNote, DataNoteAction } from "@/lib/data-notes";
import { buildMatchedFillPatch, requestStopMovePrefill } from "@/lib/fill-match";
import { updateTrade, useJournal } from "@/lib/store";
import { showToast } from "@/lib/toast";

// The notes do not carry the trade id, and the trade page is /trades/[id], so the actions read it from the route.
export function tradeIdFromPath(pathname: string | null): string | null {
  const match = /\/trades\/([^/?#]+)/.exec(pathname ?? "");
  return match ? decodeURIComponent(match[1]) : null;
}

// Issue #83: one quiet chip for the data-quality notes. Renders nothing when there are no notes.
// FB-2: a fill-time note offers "Use HH:MM" (writes the matched bar to the stored time, with Undo) and an
// untimed-stop note offers "Add time" (pre-fills the stop-moves editor). Nothing changes without a tap.
export function DataNotesChip({ notes }: { notes: readonly DataNote[] }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const journal = useJournal();
  const tradeId = tradeIdFromPath(usePathname());
  if (notes.length === 0) return null;
  const trade = tradeId ? journal.trades.find((item) => item.id === tradeId) : undefined;
  const untrusted = hasUntrustedDataNote(notes);

  const applyMatchedFill = (action: Extract<DataNoteAction, { kind: "use_matched_fill" }>) => {
    if (!trade) return;
    const built = buildMatchedFillPatch(trade, action.role, action.matchedBarTime);
    if (!built) {
      showToast("Time not changed: the entry must stay before the exit");
      return;
    }
    const time = action.label.replace(/^Use\s+/, "");
    updateTrade(trade.id, built.patch);
    showToast(`${action.role === "entry" ? "Entry" : "Exit"} time updated to ${time}`, {
      label: "Undo",
      run: () => updateTrade(trade.id, built.undoPatch),
    });
  };

  const addStopTime = (price: number) => {
    if (!tradeId) return;
    requestStopMovePrefill(tradeId, price);
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    document.querySelector(".stop-moves-editor")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
  };

  const actionButton = (action: DataNoteAction) => {
    if (action.kind === "use_matched_fill") {
      if (!trade) return null;
      return (
        <button type="button" className="tool-button num" style={{ minHeight: 44 }} onClick={() => applyMatchedFill(action)}>
          {action.label}
        </button>
      );
    }
    if (!tradeId) return null;
    return (
      <button type="button" className="tool-button" style={{ minHeight: 44 }} onClick={() => addStopTime(action.price)}>
        Add time
      </button>
    );
  };

  return (
    <div className="data-notes">
      <button
        type="button"
        className={`data-notes-chip${untrusted ? " untrusted" : ""}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        {dataNoteCountLabel(notes.length)}
        <span aria-hidden="true">{open ? " ▴" : " ▾"}</span>
      </button>
      {open && (
        <ul id={panelId} className="data-notes-list" aria-label="Data notes">
          {notes.map((note) => (
            <li key={note.id} className={note.tone === "untrusted" ? "untrusted" : "quiet"}>
              {note.text}
              {note.action && <> {actionButton(note.action)}</>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
