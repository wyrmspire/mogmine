"use client";

// Recipe editor (docs/design-2026-11-24/09 §5, §12.4, SL-12). Form first, JSON second. Both tabs edit one draft
// (recipe-draft.ts), so switching tabs never drops a value. Validation is live and every error prints its path.
// Saving goes through commitDraft: an edit to a recipe that has runs saves as the next version (§12.4).
import { useState, type ReactNode } from "react";
import { LEVEL_KEYS } from "@/lib/strategy-lab/levels";
import { MAX_SLICES, type RecipeIssue } from "@/lib/strategy-lab/recipe";
import {
  checkDraft, commitDraft, draftFromRecipe, draftToJson, getIn, issuesFor, newRecipeDraft, newRow, opsFor,
  parseDraftJson, parseValueText, rowSpec, setIn, setTriggerRows, sliceChoices, toggleSlice, triggerRows,
  valueText, type Draft, type PathKey,
} from "@/lib/strategy-lab/recipe-draft";
import { findRecipe, type RecipeStore } from "@/lib/strategy-lab/recipes-store";
import { listSkills, SKILLS } from "@/lib/strategy-lab/registry";
import type { Condition, ConditionOp, OutputSpec, Recipe, SkillOutputRef } from "@/lib/strategy-lab/types";

export interface StrategyLabRecipeEditorProps {
  store: RecipeStore;
  /** The recipe to edit, or null for a new one. Mount with a `key` per recipe so the draft starts fresh. */
  recipeId: string | null;
  playbookId: string | null;
  /** True when the stored newest version has runs. A changed save then appends the next version. */
  newestHasRuns?: boolean;
  /** Shown once on the editor, e.g. "R = $300 (SIM Eval 50K)". */
  rSizeLabel?: string;
  onSave: (store: RecipeStore, recipe: Recipe, bumped: boolean) => void;
  onCancel: () => void;
}

type Tab = "form" | "json";
interface Notice { tone: "ok" | "error"; text: string }

const ROW_OUTPUT_SEPARATOR = "|";
const LEVEL_OPTIONS: readonly string[] = LEVEL_KEYS;
/** Starting values when the trader switches a stop or target type (§5.1 shapes). */
const STOP_DEFAULTS = {
  points: { type: "points", points: 4 },
  "beyond-swing": { type: "beyond-swing", ticks: 2, lookbackBars: 15, maxPoints: 10 },
} as const;
const TARGET_DEFAULTS = {
  points: { type: "points", points: 8 },
  rr: { type: "rr", multiple: 2 },
  level: { type: "level", level: "rth_open", fallbackPoints: 8 },
} as const;

function newRecipeId(): string {
  return `rcp-${Date.now().toString(36)}`;
}

/** The draft for a stored id, or a fresh draft (the id is kept when the store does not have it). */
function startingDraft(store: RecipeStore, recipeId: string | null, playbookId: string | null): Draft {
  const existing = recipeId ? findRecipe(store, recipeId) : undefined;
  if (existing) return draftFromRecipe(existing);
  return newRecipeDraft({ id: recipeId ?? newRecipeId(), playbookId });
}

const asNumber = (value: unknown): number | null | undefined => {
  if (typeof value === "number") return value;
  if (value === null) return null;
  return undefined;
};
const asText = (value: unknown): string => (typeof value === "string" ? value : "");

function FieldBlock({ label, htmlFor, issues, children }: {
  label: string; htmlFor?: string; issues: RecipeIssue[]; children: ReactNode;
}) {
  return (
    <div className="sl-field">
      <label className="sl-label" htmlFor={htmlFor}>{label}</label>
      {children}
      {issues.map((issue) => (
        <p key={`${issue.path}:${issue.message}`} className="sl-error-text">
          <code>{issue.path || "(document)"}</code> {issue.message}
        </p>
      ))}
    </div>
  );
}

function NumberInput({ id, value, step, min, onChange }: {
  id: string; value: number | null | undefined; step?: number; min?: number; onChange: (next: number | null) => void;
}) {
  return (
    <input
      id={id}
      className="sl-input"
      type="number"
      inputMode="decimal"
      step={step}
      min={min}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
    />
  );
}

/**
 * The value box of one trigger row. It keeps the raw text while the trader types, so "1." or "2," is not
 * overwritten. It re-reads the row only when the row's stored value no longer matches what the text parses to.
 */
function RowValueInput({ id, spec, op, value, onChange }: {
  id: string; spec: OutputSpec; op: ConditionOp; value: unknown; onChange: (next: unknown) => void;
}) {
  const [text, setText] = useState(valueText(value));
  const expected = valueText(value);
  // Guard both ways: a value that does not round-trip through its text must not re-set the state every pass.
  if (text !== expected && JSON.stringify(parseValueText(text, spec, op)) !== JSON.stringify(value)) {
    setText(expected);
  }
  const isList = op === "between" || op === "in";
  return (
    <input
      id={id}
      className="sl-input"
      type="text"
      inputMode={spec.type === "number" && !isList ? "decimal" : undefined}
      placeholder={op === "between" ? "low, high" : isList ? "a, b, c" : undefined}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseValueText(e.target.value, spec, op));
      }}
    />
  );
}

export function StrategyLabRecipeEditor({
  store, recipeId, playbookId, newestHasRuns, rSizeLabel, onSave, onCancel,
}: StrategyLabRecipeEditorProps) {
  const [draft, setDraft] = useState<Draft>(() => startingDraft(store, recipeId, playbookId));
  const [tab, setTab] = useState<Tab>("form");
  const [jsonText, setJsonText] = useState("");
  const [jsonParseErrors, setJsonParseErrors] = useState<RecipeIssue[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [runsOnNewest, setRunsOnNewest] = useState(Boolean(newestHasRuns));

  const checked = checkDraft(draft, SKILLS);
  const liveErrors: RecipeIssue[] = checked.ok ? [] : checked.errors;
  const shownErrors = tab === "json" && jsonParseErrors.length > 0 ? jsonParseErrors : liveErrors;
  const rows = triggerRows(draft.trigger);
  const pickerSkills = listSkills(SKILLS).filter((meta) => meta.kind !== "measure");
  const sliceList = Array.isArray(draft.sliceBy) ? (draft.sliceBy as SkillOutputRef[]) : [];

  const update = (path: PathKey[], value: unknown) => {
    setDraft((current) => setIn(current, path, value) as Draft);
    setNotice(null);
  };
  const updateRows = (edit: (current: Condition[]) => Condition[]) => {
    setDraft((current) => setTriggerRows(current, edit(triggerRows(current.trigger) ?? [])));
    setNotice(null);
  };

  function switchTab(next: Tab) {
    if (next === tab) return;
    if (next === "json") { setJsonText(draftToJson(draft)); setJsonParseErrors([]); }
    else if (jsonParseErrors.length > 0) { setNotice({ tone: "error", text: "Fix the JSON before going back to the form." }); return; }
    setNotice(null);
    setTab(next);
  }

  function onJsonChange(text: string) {
    setJsonText(text);
    const parsed = parseDraftJson(text);
    if (parsed.ok) { setDraft(parsed.draft); setJsonParseErrors([]); } else setJsonParseErrors(parsed.errors);
    setNotice(null);
  }

  function save() {
    const outcome = commitDraft(store, draft, { newestHasRuns: runsOnNewest }, SKILLS);
    if (!outcome.ok) { setNotice({ tone: "error", text: `Not saved: ${outcome.errors.length} to fix.` }); return; }
    if (!outcome.changed) { setNotice({ tone: "ok", text: `No changes. Still v${outcome.recipe.version}.` }); return; }
    const saved = draftFromRecipe(outcome.recipe);
    setDraft(saved);
    setJsonText(draftToJson(saved));
    setRunsOnNewest(outcome.bumped ? false : runsOnNewest);
    setNotice({ tone: "ok", text: outcome.bumped ? `Saved as v${outcome.recipe.version}; earlier versions keep their runs.` : `Saved v${outcome.recipe.version}.` });
    onSave(outcome.store, outcome.recipe, outcome.bumped);
  }

  function addCondition() {
    const first = pickerSkills[0];
    const spec = first?.outputs[0];
    if (first && spec) updateRows((current) => [...current, newRow(first, spec)]);
  }

  const canSave = shownErrors.length === 0;
  const stop = getIn(draft, ["stop"]);
  const target = getIn(draft, ["target"]);
  const sizing = getIn(draft, ["sizing"]);
  const dedupe = getIn(draft, ["dedupe"]);
  const stopType = asText(getIn(draft, ["stop", "type"]));
  const targetType = asText(getIn(draft, ["target", "type"]));
  const sizingMode = asText(getIn(draft, ["sizing", "mode"]));

  return (
    <section className="sl-page" aria-labelledby="sl-editor-heading">
      <div className="sl-card-head">
        <h2 id="sl-editor-heading" className="sl-card-title">Recipe · v{asNumber(draft.version) ?? 1}</h2>
        <div className="sl-seg" role="group" aria-label="Editor view">
          <button type="button" className="sl-chip" aria-pressed={tab === "form"} onClick={() => switchTab("form")}>Form</button>
          <button type="button" className="sl-chip" aria-pressed={tab === "json"} onClick={() => switchTab("json")}>JSON</button>
        </div>
      </div>
      {rSizeLabel ? <p className="sl-hint">{rSizeLabel}</p> : null}
      {runsOnNewest ? <p className="sl-hint">This recipe has runs. Saving a change creates the next version.</p> : null}

      {tab === "json" ? (
        <textarea id="sl-recipe-json" className="sl-input" rows={24} spellCheck={false} aria-label="Recipe JSON"
          style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}
          value={jsonText} onChange={(e) => onJsonChange(e.target.value)} />
      ) : (
        <div className="sl-form">
          <FieldBlock label="Name" htmlFor="sl-name" issues={issuesFor(liveErrors, "name")}>
            <input id="sl-name" className="sl-input" type="text" value={asText(draft.name)} onChange={(e) => update(["name"], e.target.value)} />
          </FieldBlock>
          <p className="sl-hint">Playbook: {asText(draft.playbookId) || "none (exploration)"}</p>

          <FieldBlock label="Side" issues={issuesFor(liveErrors, "side")}>
            <div className="sl-seg" role="group" aria-label="Side">
              {(["long", "short"] as const).map((side) => (
                <button key={side} type="button" className="sl-chip" aria-pressed={draft.side === side} onClick={() => update(["side"], side)}>
                  {side === "long" ? "Long" : "Short"}
                </button>
              ))}
            </div>
          </FieldBlock>

          <FieldBlock label="Window (ET, decision-bar close)" issues={issuesFor(liveErrors, "window")}>
            <div className="sl-row-inputs">
              <input id="sl-window-start" className="sl-input" type="time" aria-label="Window start"
                value={asText(getIn(draft, ["window", "startEt"]))} onChange={(e) => update(["window", "startEt"], e.target.value)} />
              <input id="sl-window-end" className="sl-input" type="time" aria-label="Window end"
                value={asText(getIn(draft, ["window", "endEt"]))} onChange={(e) => update(["window", "endEt"], e.target.value)} />
            </div>
          </FieldBlock>

          <FieldBlock label="Conditions (all must hold)" issues={issuesFor(liveErrors, "trigger")}>
            {rows === null ? (
              <p className="sl-hint">This trigger nests conditions (any, not, or a nested all). Edit it in the JSON tab.</p>
            ) : (
              <div className="sl-rows">
                {rows.map((row, n) => (
                  <ConditionRowEditor
                    key={n}
                    index={n}
                    row={row}
                    pickerSkills={pickerSkills}
                    issues={issuesFor(liveErrors, `trigger.all[${n}]`)}
                    onChange={(next) => updateRows((current) => current.map((c, i) => (i === n ? next : c)))}
                    onRemove={() => updateRows((current) => current.filter((_, i) => i !== n))}
                  />
                ))}
                <button type="button" className="sl-btn sl-btn--block" onClick={addCondition}>+ Add condition</button>
              </div>
            )}
          </FieldBlock>

          <FieldBlock label="Stop" issues={issuesFor(liveErrors, "stop")}>
            <select id="sl-stop-type" className="sl-input" aria-label="Stop type" value={stopType}
              onChange={(e) => update(["stop"], STOP_DEFAULTS[e.target.value as keyof typeof STOP_DEFAULTS] ?? STOP_DEFAULTS.points)}>
              <option value="points">Fixed points</option>
              <option value="beyond-swing">Beyond the swing</option>
            </select>
            {stopType === "points" ? (
              <NumberInput id="sl-stop-points" value={asNumber(getIn(stop, ["points"]))} step={0.25} min={0} onChange={(next) => update(["stop", "points"], next)} />
            ) : (
              <div className="sl-row-inputs">
                {(["ticks", "lookbackBars", "maxPoints"] as const).map((key) => (
                  <NumberInput key={key} id={`sl-stop-${key}`} value={asNumber(getIn(stop, [key]))} step={key === "maxPoints" ? 0.25 : 1}
                    min={key === "lookbackBars" ? 1 : 0} onChange={(next) => update(["stop", key], next)} />
                ))}
              </div>
            )}
          </FieldBlock>

          <FieldBlock label="Target" issues={issuesFor(liveErrors, "target")}>
            <select id="sl-target-type" className="sl-input" aria-label="Target type" value={targetType}
              onChange={(e) => update(["target"], TARGET_DEFAULTS[e.target.value as keyof typeof TARGET_DEFAULTS] ?? TARGET_DEFAULTS.points)}>
              <option value="points">Fixed points</option>
              <option value="rr">Multiple of stop</option>
              <option value="level">A level</option>
            </select>
            {targetType === "points" ? (
              <NumberInput id="sl-target-points" value={asNumber(getIn(target, ["points"]))} step={0.25} min={0}
                onChange={(next) => update(["target", "points"], next)} />
            ) : targetType === "rr" ? (
              <NumberInput id="sl-target-rr" value={asNumber(getIn(target, ["multiple"]))} step={0.5} min={0}
                onChange={(next) => update(["target", "multiple"], next)} />
            ) : (
              <div className="sl-row-inputs">
                <select id="sl-target-level" className="sl-input" aria-label="Target level" value={asText(getIn(target, ["level"]))}
                  onChange={(e) => update(["target", "level"], e.target.value)}>
                  {LEVEL_OPTIONS.map((key) => <option key={key} value={key}>{key}</option>)}
                </select>
                <NumberInput id="sl-target-fallback" value={asNumber(getIn(target, ["fallbackPoints"]))} step={0.25} min={0}
                  onChange={(next) => update(["target", "fallbackPoints"], next)} />
              </div>
            )}
          </FieldBlock>

          <div className="sl-row-inputs">
            <FieldBlock label="Max hold (min)" htmlFor="sl-hold" issues={issuesFor(liveErrors, "maxHoldMinutes")}>
              <NumberInput id="sl-hold" value={asNumber(draft.maxHoldMinutes)} step={1} min={1} onChange={(next) => update(["maxHoldMinutes"], next)} />
            </FieldBlock>
            <FieldBlock label="Flat at (ET)" htmlFor="sl-flat" issues={issuesFor(liveErrors, "flatAtEt")}>
              <input id="sl-flat" className="sl-input" type="time" value={asText(draft.flatAtEt)} onChange={(e) => update(["flatAtEt"], e.target.value)} />
            </FieldBlock>
          </div>

          <FieldBlock label="Sizing" issues={issuesFor(liveErrors, "sizing")}>
            <select id="sl-sizing-mode" className="sl-input" aria-label="Sizing mode" value={sizingMode}
              onChange={(e) => update(["sizing"], e.target.value === "contracts" ? { mode: "contracts", qty: 1 } : { mode: "risk-r", riskR: 0.25 })}>
              <option value="risk-r">Risk in R</option>
              <option value="contracts">Fixed contracts</option>
            </select>
            {sizingMode === "contracts" ? (
              <NumberInput id="sl-sizing-qty" value={asNumber(getIn(sizing, ["qty"]))} step={1} min={1} onChange={(next) => update(["sizing", "qty"], next)} />
            ) : (
              <NumberInput id="sl-sizing-r" value={asNumber(getIn(sizing, ["riskR"]))} step={0.05} min={0} onChange={(next) => update(["sizing", "riskR"], next)} />
            )}
            <p className="sl-hint">R is the account&apos;s fixed R size. Risk is never a stop width.</p>
          </FieldBlock>

          <div className="sl-row-inputs">
            <FieldBlock label="Max per session" htmlFor="sl-dedupe-max" issues={issuesFor(liveErrors, "dedupe")}>
              <NumberInput id="sl-dedupe-max" value={asNumber(getIn(dedupe, ["maxPerSession"]))} step={1} min={1}
                onChange={(next) => update(["dedupe", "maxPerSession"], next)} />
            </FieldBlock>
            <FieldBlock label="Cooldown (min)" htmlFor="sl-dedupe-cooldown" issues={[]}>
              <NumberInput id="sl-dedupe-cooldown" value={asNumber(getIn(dedupe, ["cooldownMinutes"]))} step={1} min={0}
                onChange={(next) => update(["dedupe", "cooldownMinutes"], next)} />
            </FieldBlock>
          </div>

          <FieldBlock label={`Slice by (${sliceList.length} of ${MAX_SLICES})`} issues={issuesFor(liveErrors, "sliceBy")}>
            <div className="sl-group" role="group" aria-label="Slice by">
              {sliceChoices(SKILLS).map((choice) => (
                <button key={`${choice.skill}.${choice.out}`} type="button" className="sl-chip"
                  aria-pressed={sliceList.some((s) => s.skill === choice.skill && s.out === choice.out)}
                  onClick={() => update(["sliceBy"], toggleSlice(sliceList, choice))}>
                  {choice.label}{choice.volume ? " · volume" : ""}
                </button>
              ))}
            </div>
          </FieldBlock>

          <p className="sl-hint">
            Measure and the account and slippage fields are edited in the JSON tab.
          </p>
        </div>
      )}

      {notice ? (
        <p className={notice.tone === "error" ? "sl-status sl-status--error" : "sl-status"} role="status">{notice.text}</p>
      ) : null}
      {shownErrors.length > 0 ? (
        <div className="sl-notice" role="alert">
          <p>{shownErrors.length} {shownErrors.length === 1 ? "problem" : "problems"}:</p>
          <ul>
            {shownErrors.map((issue) => (
              <li key={`${issue.path}:${issue.message}`}><code>{issue.path || "(document)"}</code> {issue.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="sl-actions">
        <button type="button" className="sl-btn" onClick={onCancel}>Cancel</button>
        <button type="button" className="sl-btn sl-btn--primary" onClick={save} disabled={!canSave}>Save</button>
      </div>
    </section>
  );
}

function ConditionRowEditor({ index, row, pickerSkills: skills, issues, onChange, onRemove }: {
  index: number;
  row: Condition;
  pickerSkills: ReturnType<typeof listSkills>;
  issues: RecipeIssue[];
  onChange: (next: Condition) => void;
  onRemove: () => void;
}) {
  const found = rowSpec(row, SKILLS);
  const current = `${String((row as { skill?: unknown }).skill ?? "")}${ROW_OUTPUT_SEPARATOR}${String((row as { out?: unknown }).out ?? "")}`;
  const op = (row as { op?: ConditionOp }).op ?? "==";
  const ops = opsFor(found?.spec);
  const value = (row as { value?: unknown }).value;
  const pick = (next: string) => {
    const [skill, out] = next.split(ROW_OUTPUT_SEPARATOR);
    const meta = skills.find((m) => m.id === skill);
    const spec = meta?.outputs.find((o) => o.key === out);
    if (meta && spec) onChange(newRow(meta, spec));
  };
  return (
    <div className="sl-row">
      <div className="sl-row-inputs">
        <select id={`sl-cond-${index}-output`} className="sl-input" aria-label={`Condition ${index + 1} output`} value={current} onChange={(e) => pick(e.target.value)}>
          {!found ? <option value={current}>{current || "Choose an output"}</option> : null}
          {skills.map((meta) => (
            <optgroup key={meta.id} label={meta.title}>
              {meta.outputs.map((spec) => (
                <option key={`${meta.id}${ROW_OUTPUT_SEPARATOR}${spec.key}`} value={`${meta.id}${ROW_OUTPUT_SEPARATOR}${spec.key}`}>
                  {spec.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <select id={`sl-cond-${index}-op`} className="sl-input" aria-label={`Condition ${index + 1} operator`} value={op}
          onChange={(e) => {
            const nextOp = e.target.value as ConditionOp;
            const spec = found?.spec;
            onChange({ ...row, op: nextOp, value: spec ? parseValueText(valueText(value), spec, nextOp) : value } as Condition);
          }}>
          {ops.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        {found?.spec.type === "boolean" ? (
          <select id={`sl-cond-${index}-value`} className="sl-input" aria-label={`Condition ${index + 1} value`} value={String(value)}
            onChange={(e) => onChange({ ...row, value: e.target.value === "true" } as Condition)}>
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        ) : found?.spec.type === "category" && (op === "==" || op === "!=") ? (
          <select id={`sl-cond-${index}-value`} className="sl-input" aria-label={`Condition ${index + 1} value`} value={String(value)}
            onChange={(e) => onChange({ ...row, value: e.target.value } as Condition)}>
            {(found.spec.categories ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        ) : (
          <RowValueInput
            key={`${current}:${op}`}
            id={`sl-cond-${index}-value`}
            spec={found?.spec ?? { key: "", type: "number", label: "" }}
            op={op}
            value={value}
            onChange={(next) => onChange({ ...row, value: next } as Condition)}
          />
        )}
        <button type="button" className="sl-btn" aria-label={`Remove condition ${index + 1}`} onClick={onRemove}>Remove</button>
      </div>
      {issues.map((issue) => (
        <p key={`${issue.path}:${issue.message}`} className="sl-error-text"><code>{issue.path}</code> {issue.message}</p>
      ))}
    </div>
  );
}

