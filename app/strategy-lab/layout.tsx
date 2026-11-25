import type { ReactNode } from "react";
import "./strategy-lab.css";

// Strategy Lab shell. Styles load here (not in app/layout.tsx) so the rest of the app is unaffected.
export default function StrategyLabLayout({ children }: { children: ReactNode }) {
  return <div className="sl-root">{children}</div>;
}
