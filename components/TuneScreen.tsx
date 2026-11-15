"use client";

import { ChangeEvent, useRef, useState } from "react";
import { setPrefs, usePrefs } from "@/lib/prefs";
import { buildBackup, parseBackupFile, replaceTrades, useJournal } from "@/lib/store";
import type { ParseBackupResult } from "@/lib/store";
import { TIME_ZONE_OPTIONS, formatDateTime } from "@/lib/time";
import { showToast } from "@/lib/toast";

type PendingRestore = Extract<ParseBackupResult, { ok: true }> & { fileName: string };

export function TuneScreen() {
  const prefs = usePrefs();
  const journal = useJournal();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingRestore | null>(null);
  const [error, setError] = useState<string | null>(null);

  const realCount = journal.trades.filter((t) => !t.is_sample).length;
  const sampleCount = journal.trades.length - realCount;

  const downloadBackup = () => {
    const payload = buildBackup(journal.trades, prefs);
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const day = payload.exportedAt.slice(0, 10);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mogmine-journal-backup-${day}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("Backup downloaded to this device");
  };

  const onFileSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    setPending(null);
    try {
      const text = await file.text();
      const parsed = parseBackupFile(text);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      setPending({ ...parsed, fileName: file.name });
    } catch {
      setError("Could not read this file.");
    }
  };

  const confirmRestore = () => {
    if (!pending) return;
    replaceTrades(pending.trades);
    if (pending.prefs) setPrefs(pending.prefs);
    const total = pending.trades.length;
    setPending(null);
    setError(null);
    showToast(`Restored ${total} ${total === 1 ? "trade" : "trades"} from backup`);
  };

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <div className="page-head"><div><span className="eyebrow">Tune</span><h1>Make it yours</h1></div></div>
      <section className="specular-card card-pad">
        <div className="form-grid">
          <label className="field wide"><span>Display time zone</span>
            <select value={prefs.timeZone} onChange={(event) => setPrefs({ timeZone: event.target.value })}>
              {TIME_ZONE_OPTIONS.map((zone) => <option key={zone.id} value={zone.id}>{zone.label}</option>)}
            </select>
            <span className="hint">Changes how times are shown. Sessions are always computed in exchange time.</span>
          </label>
        </div>
      </section>

      <div className="section-title"><h2>Journal backup</h2><span>Local file only</span></div>
      <section className="specular-card card-pad" aria-label="Journal backup">
        <p className="muted" style={{ fontSize: 13 }}>
          Your journal lives in this browser&apos;s storage ({realCount} {realCount === 1 ? "trade" : "trades"}
          {sampleCount > 0 ? ` + ${sampleCount} ${sampleCount === 1 ? "sample" : "samples"}` : ""}); clearing site data deletes it.
          Backups save your trades (notes, prices, tags, checklist, playbook) and preferences to a local JSON file with no network upload.
          Candle caches stay in IndexedDB and are not inside the file—charts re-fetch candles from Yahoo Finance when opened (and samples keep their offline fixture bars).
        </p>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
          <button type="button" className="btn-primary" onClick={downloadBackup} disabled={!journal.hydrated}>
            Download backup
          </button>
          <button type="button" className="btn-secondary" onClick={() => fileInputRef.current?.click()} disabled={!journal.hydrated}>
            Restore from file
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="visually-hidden"
            aria-label="Choose backup file to restore"
            onChange={onFileSelect}
          />
        </div>

        {error && (
          <div className="banner warn" role="alert" style={{ margin: "12px 0 0" }}>
            <span>{error} Your current journal was not changed.</span>
            <button type="button" onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}

        {pending && (
          <div className="card card-pad" role="region" aria-label="Confirm journal restore" style={{ marginTop: 12, background: "var(--bg-inset)" }}>
            <div className="card-head" style={{ marginBottom: 6 }}>
              <h3>Replace current journal?</h3>
              <span className="num">{pending.fileName}</span>
            </div>
            <p className="muted" style={{ fontSize: 12 }}>
              This will replace the {journal.trades.length} {journal.trades.length === 1 ? "trade" : "trades"} currently on this device with{" "}
              <b style={{ color: "var(--text-primary)" }}>
                {pending.realCount} {pending.realCount === 1 ? "trade" : "trades"}
                {pending.sampleCount > 0 ? ` and ${pending.sampleCount} labelled ${pending.sampleCount === 1 ? "sample" : "samples"}` : ""}
              </b>
              {pending.exportedAt ? ` exported ${formatDateTime(pending.exportedAt, prefs.timeZone)}` : ""}
              {pending.prefs ? ", plus saved preferences" : ""}. Charts will re-fetch Yahoo Finance candles when opened.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              <button type="button" className="btn-primary" onClick={confirmRestore}>
                Replace journal
              </button>
              <button type="button" className="btn-secondary" onClick={() => setPending(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
