"use client";

import { useId, useState } from "react";
import { dataNoteCountLabel, hasUntrustedDataNote } from "@/lib/data-notes";
import type { DataNote } from "@/lib/data-notes";

// Issue #83: one quiet chip for the data-quality notes. Renders nothing when there are no notes.
export function DataNotesChip({ notes }: { notes: readonly DataNote[] }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (notes.length === 0) return null;
  const untrusted = hasUntrustedDataNote(notes);
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
            <li key={note.id} className={note.tone === "untrusted" ? "untrusted" : "quiet"}>{note.text}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
