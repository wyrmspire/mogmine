import type { ReactNode } from "react";

export function ReviewQueueSummary({ count, children }: { count: number; children?: ReactNode }) {
  return <section className="card card-pad" aria-label="Review queue summary" data-screen-state={count > 0 ? "ready" : "caught-up"}>
    <b>{count > 0 ? `${count} ${count === 1 ? "trade" : "trades"} need review` : "Review queue caught up"}</b>
    {children && <div className="muted" style={{ marginTop: 4 }}>{children}</div>}
  </section>;
}

