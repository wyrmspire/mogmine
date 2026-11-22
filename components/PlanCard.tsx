"use client";

import { usePlansStore } from "@/lib/plans-store";
import type { PlanPreset } from "@/lib/plans";
import { useState } from "react";
import { PlanSheet } from "./PlanSheet";
import { SessionReview } from "./SessionReview";
import type { TradeRecord } from "@/lib/trades";

interface PlanCardProps {
  sessionDate: string;
  /** For the after-session review (PS-4). */
  trades: readonly TradeRecord[];
  zone: string;
}

export function PlanCard({ sessionDate, trades, zone }: PlanCardProps) {
  const { plans, saved } = usePlansStore();
  const sessionPlans = plans.filter((p) => p.session_date === sessionDate && !p.archived);

  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const reviewPlan = sessionPlans.find((p) => p.id === reviewId) ?? null;
  const [newPreset, setNewPreset] = useState<PlanPreset | null>("pre_market");

  const openNew = (preset: PlanPreset = "pre_market") => {
    setActivePlanId(null);
    setNewPreset(preset);
    setSheetOpen(true);
  };

  const editPlan = (id: string) => {
    setActivePlanId(id);
    setSheetOpen(true);
  };

  return (
    <>
      <div className="specular-card plan-card" style={{ margin: "14px 0" }}>
        <div className="card-pad">
          <div className="plan-card-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: sessionPlans.length ? 10 : 0 }}>
            <div>
              <span className="eyebrow" style={{ fontSize: "0.6875rem", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 700 }}>
                Planning Sessions
              </span>
              <h3 style={{ margin: "2px 0 0", fontSize: "0.9375rem", fontWeight: 750 }}>
                {sessionPlans.length ? `${sessionPlans.length} ${sessionPlans.length === 1 ? "plan" : "plans"} for this session` : "No session plan"}
              </h3>
            </div>
            <button
              type="button"
              className="btn-secondary"
              style={{ minHeight: 44, minWidth: 44, padding: "0 12px", fontSize: "0.75rem" }}
              onClick={() => openNew("pre_market")}
            >
              ＋ New Plan
            </button>
          </div>

          {!saved && (
            <div className="banner warn" style={{ margin: "8px 0" }} role="status">
              Storage is blocked on this device — plans will not persist across reloads.
            </div>
          )}

          {sessionPlans.length > 0 ? (
            <div className="plan-list" style={{ display: "grid", gap: 8 }}>
              {sessionPlans.map((plan) => (
                <div
                  key={plan.id}
                  className="plan-item-row"
                  style={{
                    background: "var(--bg-inset)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 8,
                    padding: "8px 12px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    cursor: "pointer",
                  }}
                  onClick={() => editPlan(plan.id)}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open plan ${plan.name}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") editPlan(plan.id);
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <b style={{ fontSize: "0.8125rem", color: "var(--text-primary)" }}>{plan.name}</b>
                      {plan.bias && (
                        <span
                          className={`seal ${plan.bias === "bullish" ? "full" : ""}`}
                          style={{
                            fontSize: "0.6875rem",
                            padding: "1px 6px",
                            textTransform: "capitalize",
                          }}
                        >
                          {plan.bias}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 2, display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <span>{plan.levels.length} {plan.levels.length === 1 ? "level" : "levels"}</span>
                      {plan.watch_playbook_ids.length > 0 && (
                        <span>{plan.watch_playbook_ids.length} setups watched</span>
                      )}
                      {plan.observations && (
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>
                          {plan.observations}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-secondary plan-review-button"
                    style={{ minHeight: 44, minWidth: 44 }}
                    onClick={(e) => { e.stopPropagation(); setReviewId(plan.id); }}
                    onKeyDown={(e) => e.stopPropagation()}
                    aria-label={`Review ${plan.name}`}
                  >
                    Review
                  </button>
                  <span className="muted" aria-hidden="true" style={{ fontSize: "0.875rem" }}>
                    →
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="plan-card-empty" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", width: "100%", marginBottom: 2 }}>
                Quick start before trading:
              </span>
              <button
                type="button"
                className="chip"
                style={{ minHeight: 44, minWidth: 44 }}
                onClick={() => openNew("pre_globex")}
              >
                Pre-Globex (17:00 CT)
              </button>
              <button
                type="button"
                className="chip"
                style={{ minHeight: 44, minWidth: 44 }}
                onClick={() => openNew("pre_market")}
              >
                Pre-market (08:30 CT)
              </button>
              <button
                type="button"
                className="chip"
                style={{ minHeight: 44, minWidth: 44 }}
                onClick={() => openNew("pre_power_hour")}
              >
                Pre-power hour (14:00 CT)
              </button>
              <button
                type="button"
                className="chip"
                style={{ minHeight: 44, minWidth: 44 }}
                onClick={() => openNew("pre_moc")}
              >
                Pre-MOC (14:50 CT)
              </button>
            </div>
          )}
        </div>
      </div>

      {reviewPlan && (
        <SessionReview plan={reviewPlan} trades={trades} zone={zone} onClose={() => setReviewId(null)} />
      )}

      {sheetOpen && (
        <PlanSheet
          sessionDate={sessionDate}
          initialPreset={newPreset}
          planId={activePlanId}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </>
  );
}
