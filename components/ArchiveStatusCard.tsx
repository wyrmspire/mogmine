"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDateTime } from "@/lib/time";

type ArchiveStatus = {
  state: "server_unconfigured" | "query_failed" | "empty_archive" | "no_archive_job" | "failed_job" | "healthy" | "attention";
  available: boolean;
  symbol: string;
  newestBarIso: string | null;
  coveredSessions: number;
  missingRecentSessions: number;
  missingRecentSessionsProvisional: boolean;
  lastJob: { status: string; finished_at: string | null } | null;
  warning: string | null;
};

export function ArchiveStatusCard({ zone }: { zone: string }) {
  const [status, setStatus] = useState<ArchiveStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/market-data/status", { cache: "no-store" });
      if (!response.ok) throw new Error(`Archive status returned ${response.status}`);
      const next = (await response.json()) as ArchiveStatus;
      setStatus(next);
      setError(null);
    } catch {
      setStatus(null);
      setError("Archive status is unavailable right now.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // State is only set after the request resolves.
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const retry = () => {
    setLoading(true);
    setError(null);
    void load();
  };

  return <section className="specular-card card-pad" aria-label="Market archive status" aria-live="polite">
    {loading ? <p className="muted" role="status">Loading archive status…</p>
      : error ? <div className="banner warn" role="alert" style={{ margin: 0 }}><span>{error} Your journal remains available in local mode.</span><button type="button" style={{ minHeight: 44, minWidth: 44 }} onClick={retry}>Retry</button></div>
        : status?.state === "server_unconfigured" ? <div><b>Local mode (archive not configured)</b><p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>The server archive credentials are not configured. Local journal tools still work.</p></div>
          : status?.state === "query_failed" ? <div><b>Archive status query failed</b><p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>The server could not read archive health. No archive conclusion is available.</p></div>
            : status?.state === "empty_archive" ? <div><b>Archive is empty</b><p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>The archive is connected, but no candles or coverage rows exist yet.</p></div>
              : status?.state === "no_archive_job" ? <div><b>No archive job recorded</b><p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>Archive data exists, but no ingestion job is recorded for this symbol.</p></div>
                : <div><div className="card-head" style={{ marginBottom: 6 }}><b>{status?.state === "healthy" ? "Archive healthy" : status?.state === "failed_job" ? "Latest archive job failed" : "Archive needs attention"}</b><span className="num">{status?.symbol}</span></div><p className="muted" style={{ margin: 0, fontSize: 13 }}>{status?.coveredSessions} sessions covered{status?.newestBarIso ? ` · newest bar ${formatDateTime(status.newestBarIso, zone)}` : ""}{status?.missingRecentSessions ? ` · ${status.missingRecentSessions} recent session${status.missingRecentSessions === 1 ? "" : "s"} missing (provisional)` : ""}.</p>{status?.warning && <div className="banner warn" role="status" style={{ margin: "10px 0 0" }}>{status.warning}</div>}</div>}
  </section>;
}

