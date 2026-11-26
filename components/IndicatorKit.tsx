"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { INDICATOR_REGISTRY, createIndicatorInstance, indicatorDefinition, resetIndicatorInstance, sanitizeIndicatorInstance } from "@/lib/indicator-kit";
import type { IndicatorInstance, IndicatorLineSlot } from "@/lib/indicator-kit";
import styles from "./IndicatorKit.module.css";

interface Props {
  instances: readonly IndicatorInstance[];
  onChange(instances: IndicatorInstance[]): void;
}

const SWATCHES = ["theme:vwap", "theme:ema", "theme:support", "theme:resistance", "theme:gold", "#ffffff", "#a78bfa", "#22d3ee"] as const;
const CATEGORIES = ["Trend", "Volume", "Levels"] as const;
const SWATCH_VARS: Record<string, string> = { vwap: "--indicator-vwap", ema: "--ind-ema200", support: "--level-support", resistance: "--level-resistance", gold: "--gold-mid" };

function swatchColor(color: string) {
  if (color.startsWith("#")) return color;
  return `var(${SWATCH_VARS[color.slice(6)] ?? "--gold-mid"})`;
}

function instanceTitle(instance: IndicatorInstance) {
  const definition = indicatorDefinition(instance.indicatorId);
  if (instance.indicatorId === "ema") return `${instance.params.length} EMA`;
  if (instance.indicatorId === "vwap") return `${String(instance.params.anchor).toUpperCase()} VWAP`;
  return definition.title;
}

export function IndicatorKit({ instances, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [picker, setPicker] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const sheetRef = useRef<HTMLElement>(null);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const active = editing ? instances.find((instance) => instance.instanceId === editing) ?? null : null;
  const filtered = useMemo(() => INDICATOR_REGISTRY.filter((definition) => !deferredQuery || `${definition.title} ${definition.category} ${definition.description}`.toLowerCase().includes(deferredQuery)), [deferredQuery]);
  const update = (instanceId: string, change: (instance: IndicatorInstance) => IndicatorInstance) => onChange(instances.map((item) => item.instanceId === instanceId ? sanitizeIndicatorInstance(change(item)) ?? item : item));
  const close = useCallback(() => { setOpen(false); setPicker(false); setEditing(null); setQuery(""); }, []);
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => sheetRef.current?.querySelector<HTMLElement>("button")?.focus());
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", onKeyDown);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("keydown", onKeyDown); previousFocus?.focus(); };
  }, [open, close]);
  const move = (index: number, delta: number) => {
    const next = [...instances];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return <>
    <button type="button" className="tool-button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>Indicators</button>
    {open ? <div className={styles.backdrop} role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section ref={sheetRef} className={styles.sheet} role="dialog" aria-modal="true" aria-label="Indicators">
        <header className={styles.header}>
          <div><small>Chart</small><h2>{active ? instanceTitle(active) : picker ? "Add indicator" : "Indicators"}</h2></div>
          <button type="button" className={styles.iconButton} aria-label="Close indicators" onClick={close}>×</button>
        </header>
        {active ? <IndicatorSettings instance={active} onBack={() => setEditing(null)} onChange={(next) => update(active.instanceId, () => next)} />
          : picker ? <div className={styles.body}>
            <button type="button" className={styles.backButton} onClick={() => setPicker(false)}>← Active indicators</button>
            <label className={styles.search}><span className="sr-only">Search indicators</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search indicators" /></label>
            {CATEGORIES.map((category) => {
              const definitions = filtered.filter((definition) => definition.category === category);
              return definitions.length ? <section key={category} className={styles.group}><h3>{category}</h3>{definitions.map((definition) => <button type="button" key={definition.id} className={styles.pickerRow} onClick={() => {
                const next = createIndicatorInstance(definition.id);
                onChange([...instances, next]);
                setPicker(false);
                setEditing(next.instanceId);
              }}><span><b>{definition.title}</b><small>{definition.description}</small></span><span aria-hidden="true">＋</span></button>)}</section> : null;
            })}
            {!filtered.length ? <p className={styles.empty}>No indicators match “{query}”.</p> : null}
          </div>
            : <div className={styles.body}>
              <button type="button" className={styles.addButton} onClick={() => setPicker(true)}>＋ Add indicator</button>
              <div className={styles.activeList}>{instances.map((instance, index) => <article key={instance.instanceId} className={styles.activeRow}>
                <button type="button" className={styles.eye} aria-label={`${instance.visible ? "Hide" : "Show"} ${instanceTitle(instance)}`} aria-pressed={instance.visible} onClick={() => update(instance.instanceId, (item) => ({ ...item, visible: !item.visible }))}>{instance.visible ? "◉" : "○"}</button>
                <button type="button" className={styles.name} onClick={() => setEditing(instance.instanceId)}><b>{instanceTitle(instance)}</b><small>{indicatorDefinition(instance.indicatorId).category}</small></button>
                <div className={styles.rowActions}>
                  <button type="button" disabled={index === 0} aria-label={`Move ${instanceTitle(instance)} up`} onClick={() => move(index, -1)}>↑</button>
                  <button type="button" disabled={index === instances.length - 1} aria-label={`Move ${instanceTitle(instance)} down`} onClick={() => move(index, 1)}>↓</button>
                  <button type="button" aria-label={`Settings for ${instanceTitle(instance)}`} onClick={() => setEditing(instance.instanceId)}>⚙</button>
                  <button type="button" aria-label={`Remove ${instanceTitle(instance)}`} onClick={() => onChange(instances.filter((item) => item.instanceId !== instance.instanceId))}>×</button>
                </div>
              </article>)}</div>
              {!instances.length ? <p className={styles.empty}>No indicators yet. Add one to build this chart layout.</p> : null}
            </div>}
      </section>
    </div> : null}
  </>;
}

function IndicatorSettings({ instance, onBack, onChange }: { instance: IndicatorInstance; onBack(): void; onChange(instance: IndicatorInstance): void }) {
  const [tab, setTab] = useState<"inputs" | "style">("inputs");
  const definition = indicatorDefinition(instance.indicatorId);
  const setParam = (key: string, value: boolean | number | string | number[]) => onChange({ ...instance, params: { ...instance.params, [key]: value } });
  const setStyle = (key: string, patch: Record<string, unknown>) => onChange({ ...instance, style: { ...instance.style, [key]: { ...instance.style[key], ...patch } as IndicatorLineSlot } });
  return <div className={styles.body}>
    <button type="button" className={styles.backButton} onClick={onBack}>← Active indicators</button>
    <div className={styles.tabs} role="tablist" aria-label="Indicator settings">
      <button type="button" role="tab" aria-selected={tab === "inputs"} onClick={() => setTab("inputs")}>Inputs</button>
      <button type="button" role="tab" aria-selected={tab === "style"} onClick={() => setTab("style")}>Style</button>
    </div>
    {tab === "inputs" ? <div className={styles.form}>{Object.entries(definition.params).map(([key, param]) => <label key={key} className={styles.field}><span>{param.title}</span>
      {param.type === "select" ? <select value={String(instance.params[key])} onChange={(event) => setParam(key, event.target.value)}>{param.options.map((option) => <option key={option.value} value={option.value}>{option.title}</option>)}</select>
        : param.type === "number" ? <input type="number" inputMode="numeric" min={param.min} max={param.max} step={param.step} value={Number(instance.params[key])} onChange={(event) => setParam(key, Number(event.target.value))} />
          : param.type === "boolean" ? <input type="checkbox" checked={Boolean(instance.params[key])} onChange={(event) => setParam(key, event.target.checked)} />
            : <input type="text" inputMode="decimal" value={(instance.params[key] as number[]).join(", ")} onChange={(event) => setParam(key, event.target.value.split(",").map(Number).filter(Number.isFinite))} placeholder="1, 2" />}
    </label>)}</div>
      : <div className={styles.form}>
        {Object.entries(instance.style).map(([key, slot]) => <fieldset key={key} className={styles.styleSlot}><legend>{slot.title}</legend>
          <label className={styles.visible}><input type="checkbox" checked={slot.visible} onChange={(event) => setStyle(key, { visible: event.target.checked })} /> Visible</label>
          <div className={styles.swatches} aria-label={`${slot.title} color`}>{SWATCHES.map((color) => <button key={color} type="button" aria-label={color.replace("theme:", "Theme ")} aria-pressed={slot.color === color} onClick={() => setStyle(key, { color })} style={{ background: swatchColor(color) }} />)}</div>
          <label className={styles.field}><span>Custom hex</span><input type="color" value={slot.color.startsWith("#") ? slot.color : "#38bdf8"} onChange={(event) => setStyle(key, { color: event.target.value })} /></label>
          {slot.kind === "line" ? <>
            <div className={styles.segmented} role="group" aria-label={`${slot.title} width`}>{[1, 2, 3, 4].map((width) => <button type="button" key={width} aria-pressed={slot.width === width} onClick={() => setStyle(key, { width })}>{width}px</button>)}</div>
            <div className={styles.segmented} role="group" aria-label={`${slot.title} line style`}>{(["solid", "dashed", "dotted"] as const).map((lineStyle) => <button type="button" key={lineStyle} aria-pressed={slot.style === lineStyle} onClick={() => setStyle(key, { style: lineStyle })}>{lineStyle}</button>)}</div>
          </> : <label className={styles.range}><span>Opacity <b>{Math.round(slot.opacity * 100)}%</b></span><input type="range" min="0" max="1" step="0.05" value={slot.opacity} onChange={(event) => setStyle(key, { opacity: Number(event.target.value) })} /></label>}
        </fieldset>)}
        <label className={styles.visible}><input type="checkbox" checked={instance.labels} onChange={(event) => onChange({ ...instance, labels: event.target.checked })} /> Labels</label>
      </div>}
    <button type="button" className={styles.reset} onClick={() => onChange(resetIndicatorInstance(instance))}>Reset to default</button>
  </div>;
}
