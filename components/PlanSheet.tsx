"use client";

import { useEffect, useRef, useState } from "react";
import {
  createPlannedLevel,
  isAfterTheFact,
  PLAN_LIMITS,
  PLAN_PRESETS,
  type PlannedLevel,
  type PlannedLevelKind,
  type PlanPreset,
  newPlanningSession,
} from "@/lib/plans";
import {
  addPlan,
  getPlan,
  updatePlan,
  usePlansStore,
} from "@/lib/plans-store";
import { activePlaybooks, usePlaybooks } from "@/lib/playbooks-store";
import { NO_SETUP_ID } from "@/lib/playbooks";
import { specFor, toTicks } from "@/lib/trades";
import { stepPriceText } from "@/lib/entry-form";
import { showToast } from "@/lib/toast";
import { useInlineSaveText } from "./useSaveLabel";

interface PlanSheetProps {
  sessionDate: string;
  initialPreset?: PlanPreset | null;
  planId?: string | null;
  onClose: () => void;
}

const generatePlanId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `plan-${Date.now()}`;

export function PlanSheet({
  sessionDate,
  initialPreset = "pre_market",
  planId,
  onClose,
}: PlanSheetProps) {
  const existing = planId ? getPlan(planId) : null;
  const { saved } = usePlansStore();
  const saveText = useInlineSaveText(saved ? "saved" : "error");
  const eligiblePlaybooks = activePlaybooks(usePlaybooks().playbooks).filter(
    (p) => p.id !== NO_SETUP_ID,
  );

  const [preset, setPreset] = useState<PlanPreset | "custom">(
    existing ? (existing.preset ?? "custom") : (initialPreset ?? "pre_market"),
  );
  const [customName, setCustomName] = useState(
    existing && !existing.preset ? existing.name : "",
  );
  const [bias, setBias] = useState<"bullish" | "bearish" | "neutral" | null>(
    existing ? (existing.bias ?? null) : null,
  );
  const [selectedPlaybookIds, setSelectedPlaybookIds] = useState<string[]>(
    existing ? [...existing.watch_playbook_ids] : [],
  );
  const [observations, setObservations] = useState(
    existing ? existing.observations : "",
  );
  const [levels, setLevels] = useState<PlannedLevel[]>(
    existing ? [...existing.levels] : [],
  );

  // Level builder state
  const symbol = "MES";
  const [levelPrice, setLevelPrice] = useState("");
  const [levelLabel, setLevelLabel] = useState("");
  const [levelKind, setLevelKind] = useState<PlannedLevelKind>("level");
  const [levelError, setLevelError] = useState("");

  const dialogRef = useRef<HTMLElement>(null);
  const firstField = useRef<HTMLButtonElement>(null);

  // Calculate default anchor time for presets
  const presetSpec = PLAN_PRESETS.find((p) => p.preset === preset);
  const anchorTimeUtc = existing
    ? existing.anchor_time_utc
    : presetSpec && presetSpec.anchorHourCt != null && presetSpec.anchorMinuteCt != null
    ? new Date(
        Date.UTC(
          Number(sessionDate.slice(0, 4)),
          Number(sessionDate.slice(5, 7)) - 1,
          Number(sessionDate.slice(8, 10)),
          presetSpec.anchorHourCt + 5, // CT is UTC-5 or UTC-6
          presetSpec.anchorMinuteCt,
        ),
      ).toISOString()
    : null;

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    firstField.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previousFocus?.focus();
    };
  }, [onClose]);

  const stepLevelPrice = (steps: number) => {
    setLevelPrice((curr) => stepPriceText(curr, steps, symbol, ""));
    setLevelError("");
  };

  const addLevel = () => {
    const numPrice = Number(levelPrice);
    if (!levelPrice || !Number.isFinite(numPrice)) {
      setLevelError("Enter a price");
      return;
    }
    const spec = specFor(symbol);
    if (!spec) {
      setLevelError("Invalid symbol");
      return;
    }
    const ticks = toTicks(numPrice, symbol);
    if (ticks == null) {
      setLevelError(`Price must snap to ${spec.tickSize} tick`);
      return;
    }
    const trimmedLabel = levelLabel.trim();
    if (!trimmedLabel) {
      setLevelError("Enter a label (e.g. PDH, S1, Gap)");
      return;
    }
    if (levels.length >= PLAN_LIMITS.maxLevels) {
      setLevelError(`Maximum ${PLAN_LIMITS.maxLevels} levels allowed`);
      return;
    }

    const created = createPlannedLevel({
      price: numPrice,
      symbol,
      label: trimmedLabel,
      kind: levelKind,
    });
    if (!created) {
      setLevelError("Could not add level");
      return;
    }

    setLevels((prev) => [...prev, created]);
    setLevelPrice("");
    setLevelLabel("");
    setLevelError("");
  };

  const removeLevel = (id: string) => {
    setLevels((prev) => prev.filter((l) => l.id !== id));
  };

  const togglePlaybook = (id: string) => {
    setSelectedPlaybookIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const name =
    preset === "custom"
      ? customName.trim() || "Custom Plan"
      : (presetSpec?.name ?? "Planning Session");

  const save = () => {
    if (existing) {
      updatePlan(existing.id, {
        name,
        bias,
        watch_playbook_ids: selectedPlaybookIds,
        observations,
        levels,
      });
      showToast(`Updated ${name}`);
    } else {
      const newPlan = newPlanningSession({
        id: generatePlanId(),
        session_date: sessionDate,
        symbol,
        name,
        preset: preset === "custom" ? null : preset,
        anchor_time_utc: anchorTimeUtc,
        observations,
        bias,
        watch_playbook_ids: selectedPlaybookIds,
        levels,
        now: new Date().toISOString(),
      });
      addPlan(newPlan);
      showToast(`Saved ${name}`);
    }
    onClose();
  };

  const isAfterFact = isAfterTheFact(new Date().toISOString(), anchorTimeUtc);
  const spec = specFor(symbol);
  const step = spec ? spec.tickSize : 0.25;

  return (
    <div
      className="sheet-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="sheet plan-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-sheet-title"
        ref={dialogRef}
      >
        <div className="sheet-head">
          <div>
            <span className="eyebrow">
              {sessionDate} · {isAfterFact ? "After-the-fact plan" : "Pre-session plan"}
            </span>
            <h2 id="plan-sheet-title">{existing ? "Edit Plan" : "New Plan"}</h2>
            <p>
              {isAfterFact
                ? "This session started already. Edits are tracked after the fact (LV-15)."
                : "Plan your session, key levels, and watch setups in under 10 seconds."}
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            style={{ minHeight: 44, minWidth: 44 }}
            onClick={onClose}
            aria-label="Close planning sheet"
          >
            ✕
          </button>
        </div>

        <div className="plan-form-body">
          {/* Preset Selector */}
          <div className="chip-group" role="group" aria-label="Preset selection">
            <h4>Checkpoints</h4>
            <div className="chip-row">
              {PLAN_PRESETS.map((p) => (
                <button
                  key={p.preset}
                  ref={p.preset === "pre_market" && !existing ? firstField : undefined}
                  type="button"
                  className="chip"
                  style={{ minHeight: 44 }}
                  aria-pressed={preset === p.preset}
                  onClick={() => setPreset(p.preset)}
                >
                  {p.name} {p.beforeCt ? `(${p.beforeCt} CT)` : ""}
                </button>
              ))}
              <button
                type="button"
                className="chip"
                style={{ minHeight: 44 }}
                aria-pressed={preset === "custom"}
                onClick={() => setPreset("custom")}
              >
                Custom &ldquo;Pre-…&rdquo;
              </button>
            </div>
          </div>

          {preset === "custom" && (
            <label className="field" style={{ marginTop: 10 }}>
              <span>Custom Checkpoint Name</span>
              <input
                type="text"
                maxLength={PLAN_LIMITS.name}
                placeholder="e.g. Pre-CPI, Pre-FOMC"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
              />
            </label>
          )}

          {/* Bias */}
          <div className="chip-group" role="group" aria-label="Bias">
            <h4>Session Bias</h4>
            <div className="chip-row">
              {(["bullish", "neutral", "bearish"] as const).map((b) => (
                <button
                  key={b}
                  type="button"
                  className="chip"
                  style={{ minHeight: 44, minWidth: 44 }}
                  aria-pressed={bias === b}
                  onClick={() => setBias(bias === b ? null : b)}
                >
                  {b === "bullish" ? "▲ Bullish" : b === "bearish" ? "▼ Bearish" : "■ Neutral"}
                </button>
              ))}
            </div>
          </div>

          {/* Planned Levels */}
          <div className="chip-group" role="group" aria-label="Planned levels">
            <h4>Planned Levels ({levels.length})</h4>
            {levels.length > 0 && (
              <ul className="planned-level-list">
                {levels.map((lvl) => (
                  <li key={lvl.id} className="planned-level-row">
                    <span className="planned-level-label">
                      <b>{lvl.label}</b>
                      {lvl.kind !== "level" && <small> ({lvl.kind.replace("_", " ")})</small>}
                    </span>
                    <span className="planned-level-price tabular-nums">{lvl.price.toFixed(2)}</span>
                    <button
                      type="button"
                      className="icon-button level-del-btn"
                      style={{ minHeight: 44, minWidth: 44 }}
                      onClick={() => removeLevel(lvl.id)}
                      aria-label={`Remove level ${lvl.label}`}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* Level input builder */}
            <div className="add-level-box">
              <div className="level-inputs-row">
                <div className="price-row" style={{ flex: 1 }}>
                  <label htmlFor="plan-level-price">Price</label>
                  <button
                    type="button"
                    className="tick-step"
                    style={{ minHeight: 44, minWidth: 44 }}
                    aria-label="Level price down one tick"
                    onClick={() => stepLevelPrice(-1)}
                  >
                    −
                  </button>
                  <input
                    id="plan-level-price"
                    inputMode="decimal"
                    type="number"
                    step={step}
                    placeholder="0.00"
                    value={levelPrice}
                    onChange={(e) => {
                      setLevelPrice(e.target.value);
                      setLevelError("");
                    }}
                  />
                  <button
                    type="button"
                    className="tick-step"
                    style={{ minHeight: 44, minWidth: 44 }}
                    aria-label="Level price up one tick"
                    onClick={() => stepLevelPrice(1)}
                  >
                    +
                  </button>
                </div>

                <div className="field" style={{ flex: 1, minWidth: 100 }}>
                  <label htmlFor="plan-level-label">Label</label>
                  <input
                    id="plan-level-label"
                    type="text"
                    maxLength={PLAN_LIMITS.label}
                    placeholder="e.g. PDH, S1, Gap"
                    value={levelLabel}
                    onChange={(e) => {
                      setLevelLabel(e.target.value);
                      setLevelError("");
                    }}
                  />
                </div>
              </div>

              <div className="level-controls-row">
                <div className="chip-row">
                  {(["level", "zone_low", "zone_high"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      className="chip"
                      style={{ minHeight: 44 }}
                      aria-pressed={levelKind === k}
                      onClick={() => setLevelKind(k)}
                    >
                      {k === "level" ? "Level" : k === "zone_low" ? "Zone Low" : "Zone High"}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn-secondary add-level-btn"
                  style={{ minHeight: 44, minWidth: 44 }}
                  onClick={addLevel}
                >
                  ＋ Add Level
                </button>
              </div>
              {levelError && <p className="error" style={{ margin: "4px 0 0" }}>{levelError}</p>}
            </div>
          </div>

          {/* Watch Playbooks */}
          {eligiblePlaybooks.length > 0 && (
            <div className="chip-group" role="group" aria-label="Watch playbooks">
              <h4>Watch Setups</h4>
              <div className="chip-row">
                {eligiblePlaybooks.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="chip"
                    style={{ minHeight: 44 }}
                    aria-pressed={selectedPlaybookIds.includes(p.id)}
                    onClick={() => togglePlaybook(p.id)}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Observations */}
          <div className="chip-group">
            <h4>
              <label htmlFor="plan-observations">Observations & Context</label>
            </h4>
            <textarea
              id="plan-observations"
              className="note-input"
              rows={3}
              maxLength={PLAN_LIMITS.observations}
              value={observations}
              onChange={(e) => setObservations(e.target.value)}
              placeholder="Key levels to watch, news events, structure, or execution reminders…"
            />
          </div>

          <p className="note-state" role="status">{saveText}</p>

          <button
            type="button"
            className="btn-primary btn-block"
            onClick={save}
            style={{ minHeight: 44, minWidth: 44, marginTop: 14 }}
          >
            {existing ? "Save Plan Changes" : "Save Planning Session"}
          </button>
        </div>
      </section>
    </div>
  );
}
