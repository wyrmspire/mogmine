"use client";

import { ChangeEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { GOLD_PRESETS, getTuneRiskBudgetDisplay, setPrefs, usePrefs } from "@/lib/prefs";
import type { GoldPreset } from "@/lib/prefs";
import { buildBackup, parseBackupFile, replaceTrades, useJournal } from "@/lib/store";
import type { ParseBackupResult } from "@/lib/store";
import { getMoodBackup, restoreMood } from "@/lib/mood-store";
import { TIME_ZONE_OPTIONS, formatDateTime } from "@/lib/time";
import { showToast } from "@/lib/toast";

type PendingRestore = Extract<ParseBackupResult, { ok: true }> & { fileName: string };

interface ArchiveStatusPayload {
  configured: boolean;
  error?: string;
  lastJob?: {
    kind: string;
    symbol: string | null;
    status: string;
    started_at: string;
    finished_at: string | null;
    bars_upserted: number;
    last_error: string | null;
  } | null;
  recentFailures?: Array<{ status: string; last_error: string | null; started_at: string }>;
}

function ArchiveStatusCard({ timeZone }: { timeZone: string }) {
  const [payload, setPayload] = useState<ArchiveStatusPayload | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/archive-status")
      .then(async (response) => {
        const body = await response.json() as ArchiveStatusPayload;
        if (!cancelled) setPayload(body);
      })
      .catch(() => {
        if (!cancelled) setPayload({ configured: false, error: "Could not read archive status." });
      });
    return () => { cancelled = true; };
  }, []);

  const last = payload?.lastJob;
  const failed = payload?.recentFailures?.length ?? 0;
  return (
    <>
      <div className="section-title"><h2>Candle archive</h2><span>Supabase, when configured</span></div>
      <section className="specular-card card-pad" aria-label="Candle archive">
        {!payload && <p className="muted" style={{ fontSize: 13 }}>Checking archive status…</p>}
        {payload && !payload.configured && (
          <p className="muted" style={{ fontSize: 13 }}>
            The candle archive is off. Charts still use Yahoo Finance. To turn it on, create a Supabase project and put the keys in <code>.env.local</code> yourself — see the README.
          </p>
        )}
        {payload?.configured && payload.error && (
          <p className="muted" style={{ fontSize: 13 }}>Archive is configured, but status could not be read: {payload.error}</p>
        )}
        {payload?.configured && !payload.error && (
          <p className="muted" style={{ fontSize: 13 }}>
            {last
              ? `Last ingest (${last.kind}${last.symbol ? `, ${last.symbol}` : ""}): ${last.status}, ${last.bars_upserted} bars, ${formatDateTime(last.finished_at ?? last.started_at, timeZone)}.`
              : "Archive is configured. No ingest jobs have been recorded yet. Run npm run archive:ingest once keys are in .env.local."}
            {failed > 0 && last?.last_error ? ` Latest failure: ${last.last_error}.` : failed > 0 ? ` ${failed} recent failed ${failed === 1 ? "run" : "runs"}.` : ""}
          </p>
        )}
      </section>
    </>
  );
}
const PRESET_META: Record<GoldPreset, { label: string; vibe: string; swatch: string }> = {
  bullion: {
    label: "Bullion",
    vibe: "Classic gold",
    swatch: "linear-gradient(135deg, #f7df8e, #d4af37 50%, #96731e)",
  },
  champagne: {
    label: "Champagne",
    vibe: "Warm ivory",
    swatch: "linear-gradient(135deg, #f5e9c8, #dfc99b 50%, #ae9665)",
  },
  amber: {
    label: "Amber",
    vibe: "Deep copper",
    swatch: "linear-gradient(135deg, #fbbf24, #d97706 50%, #92400e)",
  },
  platinum: {
    label: "Platinum",
    vibe: "Brushed silver",
    swatch: "linear-gradient(135deg, #f1f5f9, #94a3b8 50%, #475569)",
  },
};

const RISK_SUGGESTIONS = [100, 250, 500, 1000];

export function TuneScreen() {
  const prefs = usePrefs();
  const journal = useJournal();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingRestore | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [draftRisk, setDraftRisk] = useState<string | null>(null);
  const riskDisplay = draftRisk ?? String(prefs.riskBudgetUsd);
  const riskBudgetDisplay = getTuneRiskBudgetDisplay(prefs.shield, prefs.riskBudgetUsd);

  const onRiskChange = (event: ChangeEvent<HTMLInputElement>) => {
    const val = event.target.value;
    setDraftRisk(val);
    const parsed = Number.parseFloat(val);
    if (Number.isFinite(parsed) && parsed >= 10 && parsed <= 100_000) {
      setPrefs({ riskBudgetUsd: Math.round(parsed) });
    }
  };

  const onRiskBlur = () => {
    if (draftRisk !== null) {
      const parsed = Number.parseFloat(draftRisk);
      if (Number.isFinite(parsed)) {
        const clamped = Math.min(100_000, Math.max(10, Math.round(parsed)));
        setPrefs({ riskBudgetUsd: clamped });
      }
      setDraftRisk(null);
    }
  };

  const onRiskKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    }
  };

  const realCount = journal.trades.filter((t) => !t.is_sample).length;
  const sampleCount = journal.trades.length - realCount;

  const downloadBackup = () => {
    const payload = buildBackup(journal.trades, prefs, getMoodBackup());
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
    // An older backup has no mood data: keep what this device has rather than wipe it.
    if (pending.mood) restoreMood(pending.mood);
    const total = pending.trades.length;
    setPending(null);
    setError(null);
    showToast(`Restored ${total} ${total === 1 ? "trade" : "trades"} from backup`);
  };

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <div className="page-head">
        <div>
          <span className="eyebrow">Tune</span>
          <h1>Make it yours</h1>
        </div>
      </div>

      <div className="section-title">
        <h2>Visual tuning</h2>
        <span>Appearance &amp; Canvas</span>
      </div>
      <section className="specular-card card-pad" aria-label="Visual tuning">
        <div className="form-grid">
          <div className="field wide">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Gold preset</span>
              <b className="num" style={{ fontVariantNumeric: "tabular-nums", color: "var(--gold-light)", fontSize: "0.8125rem", textTransform: "capitalize" }}>
                {prefs.goldPreset}
              </b>
            </div>
            <div className="segmented grid-presets" role="group" aria-label="Gold preset">
              {GOLD_PRESETS.map((preset) => {
                const meta = PRESET_META[preset];
                const active = prefs.goldPreset === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    className="preset-btn"
                    aria-pressed={active}
                    onClick={() => setPrefs({ goldPreset: preset })}
                  >
                    <span className="preset-swatch" style={{ background: meta.swatch }} aria-hidden="true" />
                    <span className="preset-text">
                      <b>{meta.label}</b>
                      <small>{meta.vibe}</small>
                    </span>
                  </button>
                );
              })}
            </div>
            <span className="hint">
              The gold used to mark a well-executed trade (rules followed, clean-process glow).
            </span>
          </div>

          <div className="field wide">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Gold intensity</span>
              <b className="num" style={{ fontVariantNumeric: "tabular-nums", color: "var(--gold-light)", fontSize: "0.8125rem" }}>
                {Math.round(prefs.goldIntensity * 100)}%
              </b>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.02"
              value={prefs.goldIntensity}
              aria-label="Gold intensity"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(prefs.goldIntensity * 100)}
              aria-valuetext={`${Math.round(prefs.goldIntensity * 100)}%`}
              onChange={(event) => setPrefs({ goldIntensity: Number.parseFloat(event.target.value) })}
            />
            <span className="hint">
              How strong that process gold appears.
            </span>
          </div>

          <div className="field wide">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Position Box opacity</span>
              <b className="num" style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-primary)", fontSize: "0.8125rem" }}>
                {Math.round(prefs.boxOpacity * 100)}%
              </b>
            </div>
            <input
              type="range"
              min="0.15"
              max="0.65"
              step="0.01"
              value={prefs.boxOpacity}
              aria-label="Position Box opacity"
              aria-valuemin={15}
              aria-valuemax={65}
              aria-valuenow={Math.round(prefs.boxOpacity * 100)}
              aria-valuetext={`${Math.round(prefs.boxOpacity * 100)}%`}
              onChange={(event) => setPrefs({ boxOpacity: Number.parseFloat(event.target.value) })}
            />
            <span className="hint">
              How strong the planned and actual boxes appear on the chart (15% to 65%), so the candles stay readable.
            </span>
          </div>

          <div className="field wide">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Profit &amp; risk palette</span>
              <b className="num" style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-primary)", fontSize: "0.8125rem" }}>
                {prefs.palette === "blue-orange" ? "Blue / Orange" : "Classic"}
              </b>
            </div>
            <div className="segmented" role="group" aria-label="Profit and risk palette">
              <button
                type="button"
                aria-pressed={prefs.palette === "classic"}
                onClick={() => setPrefs({ palette: "classic" })}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#10b981" }} aria-hidden="true" />
                  Classic (Green / Red)
                </span>
              </button>
              <button
                type="button"
                aria-pressed={prefs.palette === "blue-orange"}
                onClick={() => setPrefs({ palette: "blue-orange" })}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#3b82f6" }} aria-hidden="true" />
                  Blue / Orange
                </span>
              </button>
            </div>
            <span className="hint">
              A colour-blind safe pair: blue for profit and orange for risk, used on cards, badges, and candles.
            </span>
          </div>
        </div>
      </section>

      <div className="section-title">
        <h2>Trading &amp; Privacy</h2>
        <span>Preferences</span>
      </div>
      <section className="specular-card card-pad" aria-label="Trading and privacy">
        <div className="form-grid">
          <div className="field wide">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{riskBudgetDisplay.label}</span>
              <b className="num" style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-primary)", fontSize: "0.8125rem" }}>
                {riskBudgetDisplay.valueText}
              </b>
            </div>
            {riskBudgetDisplay.isEditable ? (
              <input
                type="number"
                min="10"
                max="100000"
                step="25"
                value={riskDisplay}
                aria-label={riskBudgetDisplay.inputAriaLabel}
                onChange={onRiskChange}
                onBlur={onRiskBlur}
                onKeyDown={onRiskKeyDown}
              />
            ) : (
              <input
                type="text"
                value={riskBudgetDisplay.inputValue}
                disabled
                readOnly
                aria-label={riskBudgetDisplay.inputAriaLabel}
              />
            )}
            {riskBudgetDisplay.isEditable && (
              <div className="suggest" style={{ marginTop: 4 }}>
                {RISK_SUGGESTIONS.map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    aria-pressed={prefs.riskBudgetUsd === amount}
                    onClick={() => {
                      setDraftRisk(null);
                      setPrefs({ riskBudgetUsd: amount });
                    }}
                  >
                    ${amount}
                  </button>
                ))}
              </div>
            )}
            <span className="hint">
              {riskBudgetDisplay.hint}
            </span>
          </div>

          <label className="field wide">
            <span>Display time zone</span>
            <select value={prefs.timeZone} onChange={(event) => setPrefs({ timeZone: event.target.value })}>
              {TIME_ZONE_OPTIONS.map((zone) => <option key={zone.id} value={zone.id}>{zone.label}</option>)}
            </select>
            <span className="hint">Changes how times are shown. Sessions are always computed in exchange time (America/New_York).</span>
          </label>

          <div className="wide" style={{ display: "grid", gap: 10, borderTop: "1px solid var(--border-subtle)", paddingTop: 10 }}>
            <div className="toggle-row">
              <span>
                Shield mode (privacy)
                <small>Hides dollar amounts and contract size everywhere; shows only R and points.</small>
              </span>
              <button
                type="button"
                className="switch-hit"
                role="switch"
                aria-checked={prefs.shield}
                aria-label="Shield mode"
                onClick={() => setPrefs({ shield: !prefs.shield })}
              >
                <span className="switch" data-checked={prefs.shield} aria-hidden="true" />
              </button>
            </div>

            <div className="toggle-row" style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 10 }}>
              <span>
                Show sample trades
                <small>Includes demo fixture trades in Today, Feed, and Review queue. Turn off to focus solely on real trades.</small>
              </span>
              <button
                type="button"
                className="switch-hit"
                role="switch"
                aria-checked={prefs.showSamples}
                aria-label="Show sample trades"
                onClick={() => setPrefs({ showSamples: !prefs.showSamples })}
              >
                <span className="switch" data-checked={prefs.showSamples} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </section>

      <div className="section-title">
        <h2>Journal backup</h2>
        <span>Local file only</span>
      </div>
      <section className="specular-card card-pad" aria-label="Journal backup">
        <p className="muted" style={{ fontSize: 13 }}>
          Your journal lives in this browser&apos;s storage ({realCount} {realCount === 1 ? "trade" : "trades"}
          {sampleCount > 0 ? ` + ${sampleCount} ${sampleCount === 1 ? "sample" : "samples"}` : ""}); clearing site data deletes it.
          Backups save your trades (notes, prices, tags, checklist, playbook) and preferences to a local JSON file with no network upload.
          Candle caches stay in IndexedDB and are not inside the file—charts for real trades re-fetch from the archive when it is on, otherwise Yahoo Finance (and samples keep their offline fixture bars).
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
              {pending.prefs ? ", plus saved preferences" : ""}. Charts for real trades will re-fetch Yahoo Finance candles when opened (and samples keep their offline fixture bars).
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

      <ArchiveStatusCard timeZone={prefs.timeZone} />
    </div>
  );
}
