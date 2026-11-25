"use client";

// Playbook Lab Map (docs/design-2026-11-24/01 §4.4). Playbook × setup-tag counts from the LabView matrix.
// Shade is the count only (single hue, --gold-mid at --gold-intensity). Never profit/loss colour (AGENTS #80).
// Every non-zero count is a link to the Feed with the same playbook and tag, so the number matches the list.
import Link from "next/link";
import type { CSSProperties } from "react";
import type { LabView } from "@/lib/playbook-lab";

/** More setup tags than this switches the grid to the sorted pairs list. */
export const LAB_MAP_GRID_MAX_TAGS = 8;
/** Shade steps: a cell at the largest count gets 32% of --gold-mid before --gold-intensity is applied. */
const SHADE_STEPS = 32;

export interface LabMapCell {
  playbookId: string;
  playbookName: string;
  tag: string;
  n: number;
  /** Null for empty cells (`n === 0`): they render as a dash, not a link. */
  feedHref: string | null;
}

export interface LabMapRow {
  playbookId: string;
  name: string;
  archived: boolean;
  /** One cell per setup tag, in vocabulary order. */
  cells: LabMapCell[];
}

/** A non-zero cell: always links to the Feed. */
export type LabMapPair = LabMapCell & { feedHref: string };

export interface LabMapLayout {
  mode: "grid" | "pairs";
  maxCount: number;
  columns: string[];
  /** Active playbooks, plus archived playbooks that have trades. */
  rows: LabMapRow[];
  /** Non-zero pairs only, most used first. */
  pairs: LabMapPair[];
}

/** Pure: grid or pairs mode, row and column order, and the largest count for shading. */
export function buildLabMapLayout(view: LabView): LabMapLayout {
  const columns = view.tags.filter((facet) => facet.kind === "setup").map((facet) => facet.tag);
  const mode = columns.length > LAB_MAP_GRID_MAX_TAGS ? "pairs" : "grid";
  const names = new Map(view.playbooks.map((facet) => [facet.playbookId, facet.name]));
  const hits = new Map(view.matrix.map((cell) => [`${cell.playbookId}\u0000${cell.tag}`, cell]));
  const maxCount = view.matrix.reduce((max, cell) => Math.max(max, cell.n), 0);

  const rows = view.playbooks
    .filter((facet) => !facet.archived || facet.n > 0)
    .map((facet) => ({
      playbookId: facet.playbookId,
      name: facet.name,
      archived: facet.archived,
      cells: columns.map((tag) => {
        const hit = hits.get(`${facet.playbookId}\u0000${tag}`);
        return { playbookId: facet.playbookId, playbookName: facet.name, tag, n: hit?.n ?? 0, feedHref: hit?.feedHref ?? null };
      }),
    }));

  const pairs: LabMapPair[] = view.matrix
    .map((cell) => ({
      playbookId: cell.playbookId,
      playbookName: names.get(cell.playbookId) ?? cell.playbookId,
      tag: cell.tag,
      n: cell.n,
      feedHref: cell.feedHref,
    }))
    .sort((a, b) => b.n - a.n);

  return { mode, maxCount, columns, rows, pairs };
}

/** `color-mix` of --gold-mid over --bg-elevated. Strictly increasing with `n`; a non-zero count is never invisible. */
export function cellShade(n: number, maxCount: number): string {
  const pct = n > 0 && maxCount > 0 ? Math.max(1, Math.round((n / maxCount) * SHADE_STEPS)) : 0;
  return `color-mix(in srgb, var(--gold-mid) calc(${pct}% * var(--gold-intensity)), var(--bg-elevated))`;
}

export function PlaybookLabMap({ view }: { view: LabView }) {
  const layout = buildLabMapLayout(view);
  const hasPairs = layout.pairs.length > 0;

  return (
    <section className="lab-panel" aria-labelledby="lab-map-title" data-lab-map-mode={layout.mode}>
      <h2 id="lab-map-title">Map</h2>
      {!hasPairs && (
        <div className="lab-card">
          <p className="lab-note">No playbook and setup tag pairs yet. Tag a trade with a playbook and a setup tag to see the map.</p>
        </div>
      )}
      {hasPairs && layout.mode === "grid" && <MapGrid layout={layout} />}
      {hasPairs && layout.mode === "pairs" && <MapPairs layout={layout} />}
    </section>
  );
}

function MapGrid({ layout }: { layout: LabMapLayout }) {
  return (
    <div className="lab-map-scroll" role="region" aria-label="Playbook by setup tag counts" tabIndex={0}>
      <table className="lab-map">
        <thead>
          <tr>
            <th scope="col" className="lab-map-first">Playbook</th>
            {layout.columns.map((tag) => (
              <th scope="col" key={tag}>{tag}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {layout.rows.map((row) => (
            <tr key={row.playbookId}>
              <th scope="row" className="lab-map-first">
                {row.name}
                {row.archived && <span className="lab-badge"> · archived</span>}
              </th>
              {row.cells.map((cell) => (
                <td key={cell.tag} className="lab-map-cell num" style={{ background: cellShade(cell.n, layout.maxCount) } as CSSProperties}>
                  {cell.n > 0 && cell.feedHref ? (
                    <Link
                      className="lab-map-link"
                      href={cell.feedHref}
                      aria-label={`${cell.playbookName} with ${cell.tag}: ${cell.n} ${cell.n === 1 ? "trade" : "trades"}`}
                    >
                      {cell.n}
                    </Link>
                  ) : (
                    <span className="lab-meta" aria-label={`${cell.playbookName} with ${cell.tag}: none`}>—</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MapPairs({ layout }: { layout: LabMapLayout }) {
  return (
    <div className="lab-card">
      <p className="lab-meta">Pairs, most used first. {layout.columns.length} setup tags is too many for a grid.</p>
      <ul className="lab-bars" aria-label="Playbook and setup tag pairs, most used first">
        {layout.pairs.map((pair) => (
          <li key={`${pair.playbookId}\u0000${pair.tag}`}>
            <Link className="lab-bar" href={pair.feedHref}>
              <span>{pair.playbookName} + {pair.tag}</span>
              <b className="num">{pair.n}</b>
              <span className="lab-bar-track">
                <span className="lab-bar-fill" style={{ "--share": layout.maxCount ? pair.n / layout.maxCount : 0 } as CSSProperties} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
