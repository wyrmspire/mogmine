"use client";

import { useState } from "react";
import type { NextActionsResult } from "@/lib/next-actions";

export function NextActionsCard({ result, unverified = false }: { result: NextActionsResult; unverified?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  if (result.status === "caught-up") {
    return <section className="specular-card card-pad" aria-label="Next actions" data-screen-state="caught-up"><b>{unverified ? "Nothing due" : "Caught up"}</b><p className="muted" style={{ margin: "4px 0 0" }}>{unverified ? "Some data checks could not be verified." : "Nothing needs your attention right now."}</p></section>;
  }
  const [first, ...rest] = result.actions;
  return (
    <section className="specular-card card-pad" aria-labelledby="next-actions-title">
      <div className="card-head"><h2 id="next-actions-title">Next</h2><span className="muted">Decision queue</span></div>
      <a className="btn-primary" href={first.href} style={{ minHeight: 44, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 10 }}>
        <span><b>{first.title}</b><small style={{ display: "block", opacity: 0.8 }}>{first.detail}</small></span><span aria-hidden="true">→</span>
      </a>
      {rest.length > 0 && <>
        <button type="button" className="btn-secondary" style={{ minHeight: 44, marginTop: 8 }} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Hide other actions" : `${rest.length} more`}
        </button>
        {expanded && <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "grid", gap: 6 }}>
          {rest.map((action) => <li key={action.id}><a className="card-link" href={action.href} style={{ minHeight: 44, display: "flex", alignItems: "center", justifyContent: "space-between" }}><span><b>{action.title}</b><small className="muted" style={{ display: "block" }}>{action.detail}</small></span><span aria-hidden="true">→</span></a></li>)}
        </ul>}
      </>}
    </section>
  );
}

