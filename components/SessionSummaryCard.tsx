import type { SessionSummary } from "@/lib/session-summary";

export function SessionSummaryCard({ summary }: { summary: SessionSummary }) {
  const reviewLabel = summary.review.state === "done" ? "Done" : summary.review.state === "draft" ? "Draft" : "Not started";
  return (
    <section className="card card-pad" aria-label="Session summary" style={{ marginBottom: 14 }}>
      <div className="card-head"><h2>Session summary</h2><span className="muted">Canonical view</span></div>
      <div className="muted num" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8, fontSize: 12 }}>
        <span>Plan: <b>{summary.plan.state === "planned" ? "Planned" : "Unplanned"}</b></span>
        <span>Trades: <b>{summary.counts.real}</b>{summary.counts.replay > 0 ? ` + ${summary.counts.replay} replay` : ""}</span>
        <span>Review: <b>{reviewLabel}</b></span>
        <span>Process: <b>{summary.process ? `${summary.process.followed}/${summary.process.total}` : "Not assessed"}</b></span>
      </div>
      {summary.dataConfidence.needsAttention && (
        <p role="alert" style={{ margin: "8px 0 0", color: "var(--warning, #d99a32)", fontSize: 12 }}>
          Data confidence: needs attention.
        </p>
      )}
      {!summary.dataConfidence.needsAttention && summary.dataConfidence.unverified && (
        <p className="muted" style={{ margin: "8px 0 0", fontSize: 12 }}>Data confidence: not fully verified.</p>
      )}
    </section>
  );
}
