// SM-3 / 05 §3.2: the widest risk and the locked profit a stop path produced, in account R only (D-A).
// Shield-safe: shows R, never dollars. Renders nothing when neither fact applies.
import { lockedR, widestRisk } from "@/lib/stop-facts";
import type { ResolvedRSize } from "@/lib/r-size";
import type { TradeRecord } from "@/lib/trades";

export function StopFacts({ trade, rSize, initialStopText }: { trade: TradeRecord; rSize: ResolvedRSize; initialStopText?: string | null }) {
  const widest = widestRisk(trade, rSize);
  const locked = lockedR(trade, rSize);
  if (!initialStopText && !widest && !locked) return null;
  return (
    <div className="initial-stop" style={{ fontVariantNumeric: "tabular-nums" }}>
      {initialStopText && <p style={{ margin: 0 }}>{initialStopText}</p>}
      {widest && <p style={{ margin: 0 }}>Stop widened: largest risk {widest.r.toFixed(2)}R</p>}
      {locked && <p style={{ margin: 0 }}>Stop locked +{locked.r.toFixed(2)}R</p>}
    </div>
  );
}
