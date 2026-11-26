"use client";

// Playbook Lab Gaps (docs/design-2026-11-24/01 §4.5). Every count is a link to the Feed where the Pit Stop can fix it.
// Counts come from the LabView gaps block (lib/playbook-lab.ts); this file only lays them out.
import Link from "next/link";
import type { LabView } from "@/lib/playbook-lab";

const fmtPct = (ratio: number) => `${Math.round(ratio * 100)}%`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function PlaybookLabGaps({ view }: { view: LabView }) {
  const g = view.gaps;
  const names = new Map(view.playbooks.map((facet) => [facet.playbookId, facet.name]));
  const unusedPlaybookNames = g.unusedPlaybooks.map((id) => names.get(id) ?? id);
  // The impulse share is informational; the first three groups are the gaps that make the clean state.
  const clean = view.counts.trades > 0 && g.noPlaybook.length === 0 && g.noSetupTag.length === 0
    && g.unusedPlaybooks.length === 0 && g.unusedTags.length === 0;

  return (
    <section className="lab-panel" aria-labelledby="lab-gaps-title">
      <h2 id="lab-gaps-title">Gaps</h2>
      {clean && (
        <div className="lab-card">
          <p className="lab-note">Every trade has a playbook and setup tag.</p>
        </div>
      )}
      <ul className="lab-grid lab-list" aria-label="Gap counts">
        <li>
          <Link className="lab-row" style={{ minHeight: 44 }} href={g.noPlaybookHref}>
            <span className="lab-row-head">
              <span>Trades with no playbook</span>
              <span className="num">{g.noPlaybook.length}</span>
            </span>
          </Link>
        </li>
        <li>
          <Link className="lab-row" style={{ minHeight: 44 }} href={g.noSetupTagHref}>
            <span className="lab-row-head">
              <span>Trades with a playbook but no setup tag</span>
              <span className="num">{g.noSetupTag.length}</span>
            </span>
          </Link>
        </li>
        <li>
          <Link className="lab-row" style={{ minHeight: 44 }} href={g.impulseHref}>
            <span className="lab-row-head">
              <span>No Setup / Impulse</span>
              <span className="num">
                {g.impulseCount} · {g.impulseShare == null ? "—" : fmtPct(g.impulseShare)} of trades
              </span>
            </span>
          </Link>
        </li>
      </ul>

      <section className="lab-card" aria-labelledby="lab-never-used-title">
        <h3 id="lab-never-used-title">Never used</h3>
        <div className="lab-meta">
          <p className="num">{plural(g.unusedPlaybooks.length, "playbook")}</p>
          {unusedPlaybookNames.length > 0 && (
            <p>
              <Link href="/tune#playbooks" style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>
                {unusedPlaybookNames.join(", ")}
              </Link>
            </p>
          )}
        </div>
        <div className="lab-meta">
          <p className="num">{plural(g.unusedTags.length, "tag")}</p>
          {g.unusedTags.length > 0 && <p>{g.unusedTags.join(", ")}</p>}
        </div>
      </section>
    </section>
  );
}
