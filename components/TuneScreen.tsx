"use client";

import Link from "next/link";
import { ChangeEvent, KeyboardEvent, useRef, useState } from "react";
import { GOLD_PRESETS, getTuneRiskBudgetDisplay, setPrefs, usePrefs } from "@/lib/prefs";
import type { GoldPreset } from "@/lib/prefs";
import { buildBackup, parseBackupFile, replaceTrades, useJournal } from "@/lib/store";
import type { ParseBackupResult } from "@/lib/store";
import { getChallengesBackup, restoreChallenges } from "@/lib/challenge-store";
import { getMoodBackup, restoreMood } from "@/lib/mood-store";
import { getAccountsBackup, restoreAccounts } from "@/lib/accounts-store";
import { getPlaybooksBackup, restorePlaybooks } from "@/lib/playbooks-store";
import { getTagRegistryBackup, restoreTagRegistry } from "@/lib/tag-registry-store";
import { getPlansBackup, restorePlans } from "@/lib/plans-store";
import { getDrillsBackup, restoreDrills } from "@/lib/drills-store";
import { getCallsBackup, restoreCalls } from "@/lib/calls-store";
import { getDailyReviewsBackup, restoreDailyReviews } from "@/lib/daily-review-store";
import { AccountsSection } from "./AccountsSection";
import { ArchiveStatusCard } from "./ArchiveStatusCard";
import { PlaybookEditor } from "./PlaybookEditor";
import { TagRegistryEditor } from "./TagRegistryEditor";
import { TIME_ZONE_OPTIONS, formatDateTime } from "@/lib/time";
import { TRADINGVIEW_ATTRIBUTION } from "@/lib/chart-chrome";
import { showToast } from "@/lib/toast";

type PendingRestore = Extract<ParseBackupResult, { ok: true }> & { fileName: string };
type TuneTab = "tools" | "settings";

const PRESET_META: Record<GoldPreset, { label: string; vibe: string; swatch: string }> = {
  bullion: { label: "Bullion", vibe: "Classic gold", swatch: "linear-gradient(135deg, #f7df8e, #d4af37 50%, #96731e)" },
  champagne: { label: "Champagne", vibe: "Warm ivory", swatch: "linear-gradient(135deg, #f5e9c8, #dfc99b 50%, #ae9665)" },
  amber: { label: "Amber", vibe: "Deep copper", swatch: "linear-gradient(135deg, #fbbf24, #d97706 50%, #92400e)" },
  platinum: { label: "Platinum", vibe: "Brushed silver", swatch: "linear-gradient(135deg, #f1f5f9, #94a3b8 50%, #475569)" },
};

const WORKSPACE_LINKS = [
  { href: "/playbooks", title: "Playbooks & Lab", sub: "Binder, rules & setup stats" },
  { href: "/strategy-lab", title: "Strategy Lab", sub: "Backtests, replay & recipes" },
  { href: "/drills", title: "Review Drills", sub: "Flashcards from your trades" },
  { href: "/challenges", title: "Challenges", sub: "Drawdown Defender & Clean Run" },
  { href: "/settings/agent", title: "Agent API Keys", sub: "Assistant & read-only tokens" },
] as const;

const RISK_SUGGESTIONS = [150, 300, 500, 1000];
const HEADER_VAL_STYLE = { fontVariantNumeric: "tabular-nums", fontSize: "0.8125rem" } as const;
export function TuneScreen() {
  const prefs = usePrefs();
  const journal = useJournal();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<TuneTab>("tools");
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
    if (draftRisk === null) return;
    const parsed = Number.parseFloat(draftRisk);
    if (Number.isFinite(parsed)) {
      setPrefs({ riskBudgetUsd: Math.min(100_000, Math.max(10, Math.round(parsed))) });
    }
    setDraftRisk(null);
  };

  const onRiskKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") event.currentTarget.blur();
  };

  const realCount = journal.trades.filter((t) => !t.is_sample).length;
  const sampleCount = journal.trades.length - realCount;

  const downloadBackup = () => {
    const payload = buildBackup(journal.trades, prefs, getMoodBackup(), getAccountsBackup(), getChallengesBackup(), getPlaybooksBackup(), getPlansBackup(), getDrillsBackup(), getCallsBackup(), getDailyReviewsBackup(), getTagRegistryBackup());
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mogmine-journal-backup-${payload.exportedAt.slice(0, 10)}.json`;
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
      const parsed = parseBackupFile(await file.text());
      if (!parsed.ok) { setError(parsed.error); return; }
      setPending({ ...parsed, fileName: file.name });
    } catch {
      setError("Could not read this file.");
    }
  };

  const confirmRestore = () => {
    if (!pending) return;
    if (pending.trades.length) replaceTrades(pending.trades);
    if (pending.prefs) setPrefs(pending.prefs);
    // An older backup has no mood, playbook, tag, plan, drill, call, or review data: keep what this device has rather than wipe it.
    if (pending.mood) restoreMood(pending.mood);
    if (pending.accounts) restoreAccounts(pending.accounts);
    restoreChallenges(pending.challenges);
    if (pending.playbooks) restorePlaybooks(pending.playbooks);
    if (pending.tag_registry) restoreTagRegistry(pending.tag_registry);
    if (pending.plans) restorePlans(pending.plans);
    if (pending.drills) restoreDrills(pending.drills);
    if (pending.calls) restoreCalls(pending.calls);
    if (pending.daily_reviews) restoreDailyReviews(pending.daily_reviews);
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
          <h1>{tab === "tools" ? "Tools & Workspace" : "Settings"}</h1>
        </div>
      </div>

      <div className="seg-tabs" role="tablist" aria-label="Tune sections">
        <button
          type="button"
          role="tab"
          id="tune-tab-tools"
          className="seg-tab"
          style={{ minHeight: 44 }}
          aria-selected={tab === "tools"}
          aria-controls="tune-panel-tools"
          onClick={() => setTab("tools")}
        >
          Tools
        </button>
        <button
          type="button"
          role="tab"
          id="tune-tab-settings"
          className="seg-tab"
          style={{ minHeight: 44 }}
          aria-selected={tab === "settings"}
          aria-controls="tune-panel-settings"
          onClick={() => setTab("settings")}
        >
          Settings
        </button>
      </div>

      {tab === "tools" ? (
        <div role="tabpanel" id="tune-panel-tools" aria-labelledby="tune-tab-tools">
          <div className="section-title">
            <h2>Accounts</h2>
            <span>Live, Eval &amp; Replay</span>
          </div>
          <AccountsSection shield={prefs.shield} />

          <div className="section-title">
            <h2>Market archive</h2>
            <span>Status &amp; recovery</span>
          </div>
          <ArchiveStatusCard zone={prefs.timeZone} />

          <div className="section-title">
            <h2>Workspace Hub</h2>
            <span>Tools &amp; Lab</span>
          </div>
          <section className="specular-card card-pad" aria-label="Workspace hub">
            <div className="tools-hub-grid">
              {WORKSPACE_LINKS.map((item) => (
                <Link key={item.href} href={item.href} className="tools-hub-link" style={{ minHeight: 48 }}>
                  <span>
                    <b>{item.title}</b>
                    <small>{item.sub}</small>
                  </span>
                  <span className="tools-hub-arrow" aria-hidden="true">→</span>
                </Link>
              ))}
            </div>
          </section>

          <div className="section-title" id="playbooks">
            <h2>Playbooks &amp; tags</h2>
            <Link href="/playbooks/lab">Playbooks &amp; Lab</Link>
            <Link href="/strategy-lab">Strategy Lab</Link>
          </div>
          <section className="specular-card card-pad" aria-label="Playbook and tag editors">
            <details className="advanced tools-disclosure">
              <summary>
                Playbook Editor
                <span>Add, edit, reorder rules, archive</span>
              </summary>
              <PlaybookEditor />
            </details>
            <details className="advanced tools-disclosure">
              <summary>
                Tag Registry
                <span>Setup &amp; execution tags</span>
              </summary>
              <TagRegistryEditor />
            </details>
          </section>
        </div>
      ) : (
        <div role="tabpanel" id="tune-panel-settings" aria-labelledby="tune-tab-settings">
          <div className="section-title">
            <h2>Visual tuning</h2>
            <span>Appearance &amp; Canvas</span>
          </div>
          <section className="specular-card card-pad" aria-label="Visual tuning">
            <div className="form-grid">
              <div className="field wide">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>Gold preset</span>
                  <b className="num" style={{ ...HEADER_VAL_STYLE, color: "var(--gold-light)", textTransform: "capitalize" }}>{prefs.goldPreset}</b>
                </div>
                <div className="segmented grid-presets" role="group" aria-label="Gold preset">
                  {GOLD_PRESETS.map((preset) => {
                    const meta = PRESET_META[preset];
                    return (
                      <button key={preset} type="button" className="preset-btn" style={{ minHeight: 44 }} aria-pressed={prefs.goldPreset === preset} onClick={() => setPrefs({ goldPreset: preset })}>
                        <span className="preset-swatch" style={{ background: meta.swatch }} aria-hidden="true" />
                        <span className="preset-text"><b>{meta.label}</b><small>{meta.vibe}</small></span>
                      </button>
                    );
                  })}
                </div>
                <span className="hint">The gold used to mark a well-executed trade (rules followed, clean-process glow).</span>
              </div>

              <div className="field wide">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>Gold intensity</span>
                  <b className="num" style={{ ...HEADER_VAL_STYLE, color: "var(--gold-light)" }}>{Math.round(prefs.goldIntensity * 100)}%</b>
                </div>
                <input
                  id="tune-gold-intensity"
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
                <span className="hint">How strong that process gold appears.</span>
              </div>

              <div className="field wide">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>Position Box opacity</span>
                  <b className="num" style={{ ...HEADER_VAL_STYLE, color: "var(--text-primary)" }}>{Math.round(prefs.boxOpacity * 100)}%</b>
                </div>
                <input
                  id="tune-box-opacity"
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
                <span className="hint">How strong the planned and actual boxes appear on the chart (15% to 65%), so the candles stay readable.</span>
              </div>

              <div className="field wide">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>Profit &amp; risk palette</span>
                  <b className="num" style={{ ...HEADER_VAL_STYLE, color: "var(--text-primary)" }}>{prefs.palette === "blue-orange" ? "Blue / Orange" : "Classic"}</b>
                </div>
                <div className="segmented" role="group" aria-label="Profit and risk palette">
                  <button type="button" style={{ minHeight: 44 }} aria-pressed={prefs.palette === "classic"} onClick={() => setPrefs({ palette: "classic" })}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#10b981" }} aria-hidden="true" />
                      Classic (Green / Red)
                    </span>
                  </button>
                  <button type="button" style={{ minHeight: 44 }} aria-pressed={prefs.palette === "blue-orange"} onClick={() => setPrefs({ palette: "blue-orange" })}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#3b82f6" }} aria-hidden="true" />
                      Blue / Orange
                    </span>
                  </button>
                </div>
                <span className="hint">A colour-blind safe pair: blue for profit and orange for risk, used on cards, badges, and candles.</span>
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
                  <b className="num" style={{ ...HEADER_VAL_STYLE, color: "var(--text-primary)" }}>{riskBudgetDisplay.valueText}</b>
                </div>
                {riskBudgetDisplay.isEditable ? (
                  <input type="number" min="10" max="100000" step="25" value={riskDisplay} aria-label={riskBudgetDisplay.inputAriaLabel} onChange={onRiskChange} onBlur={onRiskBlur} onKeyDown={onRiskKeyDown} />
                ) : (
                  <input type="text" value={riskBudgetDisplay.inputValue} disabled readOnly aria-label={riskBudgetDisplay.inputAriaLabel} />
                )}
                {riskBudgetDisplay.isEditable && (
                  <div className="suggest" style={{ marginTop: 4 }}>
                    {RISK_SUGGESTIONS.map((amount) => (
                      <button key={amount} type="button" style={{ minHeight: 44, minWidth: 44 }} aria-pressed={prefs.riskBudgetUsd === amount} onClick={() => { setDraftRisk(null); setPrefs({ riskBudgetUsd: amount }); }}>
                        ${amount}
                      </button>
                    ))}
                  </div>
                )}
                <span className="hint">{riskBudgetDisplay.hint}</span>
              </div>

              <label className="field wide">
                <span>Display time zone</span>
                <select value={prefs.timeZone} style={{ minHeight: 44 }} onChange={(event) => setPrefs({ timeZone: event.target.value })}>
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
                  <button type="button" className="switch-hit" style={{ minHeight: 44, minWidth: 44 }} role="switch" aria-checked={prefs.shield} aria-label="Shield mode (privacy)" onClick={() => setPrefs({ shield: !prefs.shield })}>
                    <span className="switch" data-checked={prefs.shield} aria-hidden="true" />
                  </button>
                </div>

                <div className="toggle-row" style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 10 }}>
                  <span>
                    Color-blind mode
                    <small>Blue for profit and orange for risk, replacing green and red across all charts and badges (UX-80).</small>
                  </span>
                  <button type="button" className="switch-hit" style={{ minHeight: 44, minWidth: 44 }} role="switch" aria-checked={prefs.palette === "blue-orange"} aria-label="Color-blind mode" onClick={() => setPrefs({ palette: prefs.palette === "blue-orange" ? "classic" : "blue-orange" })}>
                    <span className="switch" data-checked={prefs.palette === "blue-orange"} aria-hidden="true" />
                  </button>
                </div>

                <div className="toggle-row" style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 10 }}>
                  <span>
                    Show sample trades
                    <small>Includes demo fixture trades in Today, Feed, and Review queue. Turn off to focus solely on real trades.</small>
                  </span>
                  <button type="button" className="switch-hit" style={{ minHeight: 44, minWidth: 44 }} role="switch" aria-checked={prefs.showSamples} aria-label="Show sample trades" onClick={() => setPrefs({ showSamples: !prefs.showSamples })}>
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
              Backups save your trades (notes, prices, tags, checklist, playbook) and device settings, including saved challenges and your playbooks, to a local JSON file with no network upload.
              Candle caches stay in IndexedDB and are not inside the file—charts for real trades re-fetch candles from Yahoo Finance when opened (and samples keep their offline fixture bars).
            </p>
            {!journal.hydrated && <p className="muted" role="status" style={{ fontSize: 13 }}>Loading local journal… Backup actions will be available when storage is ready.</p>}
            {journal.hydrated && journal.trades.length === 0 && <p className="muted" role="status" style={{ fontSize: 13 }}>Journal is empty. Import a backup or record your first trade to begin.</p>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
              <button type="button" className="btn-primary" style={{ minHeight: 44, minWidth: 44 }} onClick={downloadBackup} disabled={!journal.hydrated}>
                Download backup
              </button>
              <button type="button" className="btn-secondary" style={{ minHeight: 44, minWidth: 44 }} onClick={() => fileInputRef.current?.click()} disabled={!journal.hydrated}>
                Restore from file
              </button>
              <input ref={fileInputRef} type="file" accept=".json,application/json" className="visually-hidden" aria-label="Choose backup file to restore" onChange={onFileSelect} />
            </div>

            {error && (
              <div className="banner warn" role="alert" style={{ margin: "12px 0 0" }}>
                <span>{error} Your current journal was not changed.</span>
                <button type="button" style={{ minHeight: 44, minWidth: 44 }} onClick={() => setError(null)}>Dismiss</button>
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
                  {pending.prefs ? ", plus saved preferences" : ""}. Saved challenges will also be replaced{pending.challenges?.length ? ` with ${pending.challenges.length} from this file` : " with an empty list"}.{pending.playbooks ? ` Playbooks will be replaced with the ${pending.playbooks.length} in this file.` : " This file has no playbooks, so the ones on this device stay."} Charts for real trades will re-fetch Yahoo Finance candles when opened (and samples keep their offline fixture bars).
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                  <button type="button" className="btn-primary" style={{ minHeight: 44, minWidth: 44 }} onClick={confirmRestore}>Replace journal</button>
                  <button type="button" className="btn-secondary" style={{ minHeight: 44, minWidth: 44 }} onClick={() => setPending(null)}>Cancel</button>
                </div>
              </div>
            )}
          </section>

          <section className="specular-card card-pad" aria-label="About and licences" style={{ marginTop: 12 }}>
            <div className="card-head" style={{ marginBottom: 6 }}>
              <h3>About &amp; Licences</h3>
            </div>
            <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>{TRADINGVIEW_ATTRIBUTION.notice}</p>
            <a href={TRADINGVIEW_ATTRIBUTION.href} target="_blank" rel="noopener noreferrer" style={{ minHeight: 44, display: "inline-flex", alignItems: "center", fontSize: 13 }}>
              {TRADINGVIEW_ATTRIBUTION.label} · lightweight-charts licence
            </a>
          </section>
        </div>
      )}
    </div>
  );
}
