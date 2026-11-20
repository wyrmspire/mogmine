"use client";

import { useMemo } from "react";
import { describeMood, moodPath, moodVector } from "@/lib/mood";
import type { MoodVector, MoodVectorOptions } from "@/lib/mood";
import { useMood } from "@/lib/mood-store";
import type { TradeRecord } from "@/lib/trades";

/** The trade's mood vector from the device's records, registry and execution tags. */
export function useTradeMood(trade: Pick<TradeRecord, "id" | "exit_time" | "quick_tags">, options: MoodVectorOptions = {}) {
  const mood = useMood();
  const phase = options.phase ?? "any";
  return useMemo(() => moodVector(trade, mood.records, mood.registry, { phase }), [trade, mood.records, mood.registry, phase]);
}

interface ShapeProps {
  values: Array<number | null>;
  size: number;
  /** Axis labels around the ring (the editor and stats). Needs room: use padding ≥ 30. */
  labels?: string[];
  padding?: number;
  /** Faint spokes and the outer ring. Off on the 40px thumbnail. */
  axes?: boolean;
  tone?: "neutral" | "profit" | "loss";
  /** Draw only the outline, for an overlay. */
  outlineOnly?: boolean;
}

/** The bare SVG group, so two shapes can be overlaid in one drawing (winners against losers). */
export function MoodShapeLayer({ values, size, padding = 2, tone = "neutral", outlineOnly = false }: Omit<ShapeProps, "labels" | "axes">) {
  const geometry = moodPath(values, { size, padding });
  if (!geometry) return null;
  const known = values.filter((value) => value != null).length;
  // The fill fades with the share of spokes scored, so a guessed outline never looks like a full reading.
  const fillOpacity = 0.3 + 0.7 * (known / values.length);
  return (
    <g className={`mood-layer ${tone}`}>
      {known > 0 && !outlineOnly && <path className="mood-fill" d={geometry.fill} style={{ opacity: fillOpacity }} />}
      {geometry.solid && <path className="mood-line" d={geometry.solid} />}
      {geometry.dashed && <path className="mood-line dashed" d={geometry.dashed} />}
    </g>
  );
}

export function MoodAxes({ count, size, padding, labels }: { count: number; size: number; padding: number; labels?: string[] }) {
  const ring = moodPath(Array(count).fill(1), { size, padding });
  if (!ring) return null;
  return (
    <g className="mood-axes" aria-hidden="true">
      <circle cx={ring.center} cy={ring.center} r={ring.radius} />
      {ring.points.map((point, index) => <line key={index} x1={ring.center} y1={ring.center} x2={point.axisX} y2={point.axisY} />)}
      {labels && ring.points.map((point, index) => {
        const dx = Math.cos(point.angle);
        const dy = Math.sin(point.angle);
        const anchor = Math.abs(dx) < 0.3 ? "middle" : dx > 0 ? "start" : "end";
        return (
          <text key={index} x={point.axisX + dx * 6} y={point.axisY + dy * 6 + (dy > 0.3 ? 9 : dy < -0.3 ? -3 : 4)} textAnchor={anchor}>{labels[index]}</text>
        );
      })}
    </g>
  );
}

/** A Mood Shape as an image. Describes the state in its label (UX-67), never judges it. */
export function MoodShape({ vector, size, labels = false, axes, className = "" }: { vector: MoodVector; size: number; labels?: boolean; axes?: boolean; className?: string }) {
  const padding = labels ? Math.max(30, size * 0.16) : size <= 48 ? 2 : 6;
  const showAxes = axes ?? size > 48;
  return (
    <svg className={`mood-shape ${className}`} viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={`Mood: ${describeMood(vector)}`}>
      {showAxes && <MoodAxes count={vector.values.length} size={size} padding={padding} labels={labels ? vector.detail.map((item) => item.spoke.short) : undefined} />}
      <MoodShapeLayer values={vector.values} size={size} padding={padding} />
    </svg>
  );
}

/** A small thumbnail that reads the store itself, for lists. */
export function TradeMoodThumb({ trade, size = 40 }: { trade: TradeRecord; size?: number }) {
  const vector = useTradeMood(trade);
  return <MoodShape vector={vector} size={size} className="thumb" />;
}
