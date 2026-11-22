"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { ChallengeRules } from "@/lib/challenges";
import { startChallenge, useChallenges } from "@/lib/challenge-store";
import { NO_SETUP_ID } from "@/lib/playbooks";
import { activePlaybooks, usePlaybooks } from "@/lib/playbooks-store";
import { dollarsToCents } from "@/lib/accounts";
import { formatBalance } from "@/lib/format";

import { showToast } from "@/lib/toast";

export function ChallengeSetupSheet({
  initialKind, initialRules, onClose,
}: {
  initialKind: ChallengeRules["kind"];
  initialRules?: ChallengeRules;
  onClose: () => void;
}) {
  // Archived playbooks and the impulse bucket cannot be eligible (docs/17 §4, R-07).
  const eligiblePlaybooks = activePlaybooks(usePlaybooks().playbooks).filter((playbook) => playbook.id !== NO_SETUP_ID);
  const [kind, setKind] = useState(initialKind);
  const [sessionsText, setSessionsText] = useState(String(initialRules?.kind === "drawdown" ? initialRules.sessions : 20));
  const [limitDollarsText, setLimitDollarsText] = useState(initialRules?.kind === "drawdown" ? (initialRules.max_drawdown_cents / 100).toFixed(2) : "");
  const [targetTradesText, setTargetTradesText] = useState("10");

  // Default: every playbook except "no-setup" (docs/17 §4)
  const [selectedPlaybooks, setSelectedPlaybooks] = useState<string[]>(() =>
    eligiblePlaybooks.map((playbook) => playbook.id),
  );
  const dialog = useRef<HTMLElement>(null);
  const firstField = useRef<HTMLButtonElement>(null);

  const { challenges } = useChallenges();
  const activeExisting = challenges.find((c) => c.ended_at === null && c.rules.kind === kind);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    firstField.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const controls = dialog.current?.querySelectorAll<HTMLElement>("button:enabled, input:enabled");
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previousFocus?.focus();
    };
  }, [onClose]);

  // Validation
  const sessionsNum = Number(sessionsText);
  const validSessions =
    Number.isSafeInteger(sessionsNum) && sessionsNum >= 1 && sessionsNum <= 60;

  const limitCents = dollarsToCents(limitDollarsText);
  const validLimit = limitCents != null && Number.isSafeInteger(limitCents) && limitCents > 0;

  const targetTradesNum = Number(targetTradesText);
  const validTargetTrades =
    Number.isSafeInteger(targetTradesNum) && targetTradesNum >= 3 && targetTradesNum <= 50;

  const validPlaybooks = selectedPlaybooks.length > 0;

  let ruleSentence = "";
  let isValid = false;

  if (kind === "drawdown") {
    isValid = validSessions && validLimit && !activeExisting;
    const formattedLimit =
      validLimit && limitCents != null
        ? formatBalance(limitCents)
        : "$…";
    ruleSentence = `From now, trade ${validSessions ? sessionsNum : "…"} sessions without giving back ${formattedLimit} from your high point. Gross, fees not included. Trades already open do not count.`;
  } else {
    isValid = validTargetTrades && validPlaybooks && !activeExisting;
    ruleSentence = `From now, take ${validTargetTrades ? targetTradesNum : "…"} trades in a row by the rules. Losing trades count. Trades already open do not count. Eligible playbooks: ${eligiblePlaybooks.filter((playbook) => selectedPlaybooks.includes(playbook.id)).map((playbook) => playbook.name).join(", ") || "none selected"}.`;
  }

  const togglePlaybook = (id: string) => {
    setSelectedPlaybooks((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!isValid) return;

    let rules: ChallengeRules;
    if (kind === "drawdown") {
      if (!limitCents) return;
      rules = {
        kind: "drawdown",
        sessions: sessionsNum,
        max_drawdown_cents: limitCents,
      };
    } else {
      rules = {
        kind: "clean_run",
        target_trades: targetTradesNum,
        playbook_ids: selectedPlaybooks,
      };
    }

    const res = startChallenge(rules);
    if (!res.ok) {
      showToast(res.error);
      return;
    }

    showToast(kind === "drawdown" ? "Drawdown Defender started." : "Clean Run started.");
    onClose();
  };

  return (
    <div
      className="sheet-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="sheet challenge-sheet"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="challenge-sheet-title"
        aria-describedby="challenge-sheet-desc"
      >
        <div className="sheet-head">
          <div>
            <span className="eyebrow">Challenge</span>
            <h2 id="challenge-sheet-title">Start a challenge</h2>
            <p id="challenge-sheet-desc">Scored from your own logged trades. Sets a boundary or process goal.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close challenge setup">
            ×
          </button>
        </div>

        <form onSubmit={submit} noValidate>
          <div className="form-grid">
            <div className="field wide">
              <span id="challenge-type-label">Choose challenge</span>
              <div className="challenge-kind-toggle" role="radiogroup" aria-labelledby="challenge-type-label">
                <button
                  ref={firstField}
                  type="button"
                  role="radio"
                  className={`btn-toggle ${kind === "drawdown" ? "active" : ""}`}
                  aria-checked={kind === "drawdown"}
                  onClick={() => setKind("drawdown")}
                  style={{ minHeight: 52 }}
                >
                  <b>Drawdown Defender</b>
                  <small>Not giving money back</small>
                </button>
                <button
                  type="button"
                  role="radio"
                  className={`btn-toggle ${kind === "clean_run" ? "active" : ""}`}
                  aria-checked={kind === "clean_run"}
                  onClick={() => setKind("clean_run")}
                  style={{ minHeight: 52 }}
                >
                  <b>Clean Run</b>
                  <small>Trading the plan, win or lose</small>
                </button>
              </div>
            </div>

            {activeExisting && (
              <div className="banner warn field wide" role="alert" style={{ margin: "4px 0" }}>
                An active {kind === "drawdown" ? "Drawdown Defender" : "Clean Run"} challenge is already running.
              </div>
            )}

            {kind === "drawdown" ? (
              <>
                <label className="field" htmlFor="setup-sessions">
                  <span>Target sessions (1–60)</span>
                  <input
                    id="setup-sessions"
                    inputMode="numeric"
                    type="number"
                    min={1}
                    max={60}
                    value={sessionsText}
                    aria-invalid={!validSessions}
                    aria-describedby={!validSessions ? "setup-sessions-err" : undefined}
                    onChange={(e) => setSessionsText(e.target.value)}
                  />
                  {!validSessions && (
                    <span id="setup-sessions-err" className="error" role="alert">Enter 1 to 60 sessions</span>
                  )}
                </label>

                <label className="field" htmlFor="setup-limit">
                  <span>Drawdown limit ($)</span>
                  <input
                    id="setup-limit"
                    inputMode="decimal"
                    placeholder="300.00"
                    value={limitDollarsText}
                    aria-invalid={!validLimit}
                    aria-describedby={!validLimit ? "setup-limit-err" : undefined}
                    onChange={(e) => setLimitDollarsText(e.target.value)}
                  />
                  {!validLimit && (
                    <span id="setup-limit-err" className="error" role="alert">Enter a positive dollar limit</span>
                  )}
                </label>
              </>
            ) : (
              <>
                <label className="field wide" htmlFor="setup-trades">
                  <span>Trades in a row (3–50)</span>
                  <input
                    id="setup-trades"
                    inputMode="numeric"
                    type="number"
                    min={3}
                    max={50}
                    value={targetTradesText}
                    aria-invalid={!validTargetTrades}
                    aria-describedby={!validTargetTrades ? "setup-trades-err" : undefined}
                    onChange={(e) => setTargetTradesText(e.target.value)}
                  />
                  {!validTargetTrades && (
                    <span id="setup-trades-err" className="error" role="alert">Enter 3 to 50 trades</span>
                  )}
                </label>

                <div className="field wide" role="group" aria-labelledby="eligible-playbooks-label">
                  <span id="eligible-playbooks-label">Eligible playbooks</span>
                  <div className="challenge-playbooks-grid">
                    {eligiblePlaybooks.map((playbook) => {
                      const checked = selectedPlaybooks.includes(playbook.id);
                      return (
                        <label key={playbook.id} className="challenge-playbook-item" style={{ minHeight: 44, display: "flex", alignItems: "center" }}>
                          <span>{playbook.name}</span>
                          <input
                            type="checkbox"
                            checked={checked}
                            aria-label={`Include ${playbook.name} in Clean Run`}
                            onChange={() => togglePlaybook(playbook.id)}
                          />
                        </label>
                      );
                    })}
                  </div>
                  {!validPlaybooks && (
                    <span className="error" role="alert">Select at least one playbook</span>
                  )}
                </div>
              </>
            )}

            <div className="challenge-rule-sentence field wide" role="status" aria-live="polite" aria-label="Rule summary">
              <p>{ruleSentence}</p>
            </div>
          </div>

          <button
            className="btn-primary btn-block"
            type="submit"
            disabled={!isValid}
            aria-label={isValid ? "Start challenge" : "Start challenge (complete required fields first)"}
            style={{ marginTop: 14, minHeight: 46 }}
          >
            Start challenge
          </button>
        </form>
      </section>
    </div>
  );
}
