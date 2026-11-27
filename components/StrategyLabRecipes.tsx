"use client";

// Recipe list for one playbook (docs/design-2026-11-24/09 §6.1, §12.3, SL-12). Shows the newest version of each
// recipe. Pure model: recipesForPlaybook / latestRecipes from recipes-store.ts. Each card is a 44 px button.
// The run summary is supplied by the parent (MVP keeps no run store), so this component never computes stats.
import { latestRecipes, recipesForPlaybook, type RecipeStore } from "@/lib/strategy-lab/recipes-store";
import { formatEtMinute, parseEtMinute } from "@/lib/strategy-lab/recipe";
import type { Condition, Recipe } from "@/lib/strategy-lab/types";

export interface StrategyLabRecipesProps {
  store: RecipeStore;
  /** null lists every recipe (exploration recipes included). */
  playbookId: string | null;
  playbookName?: string;
  /** Optional one-line run summary per recipe id, e.g. "last run: n 14 · +0.06R · 20 sess". */
  lastRuns?: Readonly<Record<string, string>>;
  onNew: () => void;
  onOpen: (recipeId: string) => void;
  onLoadStarter?: () => void;
}

/** Counts the leaves of a condition tree. Nested all/any/not are walked; a leaf is one condition. */
export function countConditions(node: Condition): number {
  if ("all" in node && Array.isArray(node.all)) return node.all.reduce((n, child) => n + countConditions(child), 0);
  if ("any" in node && Array.isArray(node.any)) return node.any.reduce((n, child) => n + countConditions(child), 0);
  if ("not" in node && node.not) return countConditions(node.not);
  return 1;
}

/** "07:00–09:15" from a recipe window, or the raw text if a clock value is somehow unparsable. */
export function windowText(recipe: Recipe): string {
  const start = parseEtMinute(recipe.window.startEt);
  const end = parseEtMinute(recipe.window.endEt);
  const show = (minute: number | null, raw: string) => (minute === null ? raw : formatEtMinute(minute));
  return `${show(start, recipe.window.startEt)}–${show(end, recipe.window.endEt)} ET`;
}

function RecipeCard({ recipe, lastRun, onOpen }: { recipe: Recipe; lastRun?: string; onOpen: (id: string) => void }) {
  const conditions = countConditions(recipe.trigger);
  return (
    <button type="button" className="sl-card sl-recipe-card" onClick={() => onOpen(recipe.id)} aria-label={`Open ${recipe.name}, version ${recipe.version}`}>
      <span className="sl-row-main">
        <span className="sl-card-title">{recipe.name} · v{recipe.version}</span>
      </span>
      <span className="sl-row-note">
        {recipe.side} · {windowText(recipe)} · {conditions} {conditions === 1 ? "condition" : "conditions"}
      </span>
      {lastRun ? <span className="sl-row-note">{lastRun}</span> : <span className="sl-hint">Not run yet</span>}
    </button>
  );
}

export function StrategyLabRecipes({ store, playbookId, playbookName, lastRuns, onNew, onOpen, onLoadStarter }: StrategyLabRecipesProps) {
  const recipes = playbookId === null ? latestRecipes(store) : recipesForPlaybook(store, playbookId);
  const heading = playbookId === null ? "All recipes" : (playbookName ?? playbookId);
  return (
    <section className="sl-result" aria-labelledby="sl-recipes-heading">
      <div className="sl-card-head">
        <h2 id="sl-recipes-heading" className="sl-card-title">
          {heading} · {recipes.length} {recipes.length === 1 ? "recipe" : "recipes"}
        </h2>
        <button type="button" className="sl-btn sl-btn--primary" onClick={onNew}>+ New</button>
      </div>
      {recipes.length === 0 ? (
        <div className="sl-card">
          <p className="sl-hint">
            No recipes yet. Load the starter MES templates, create one here, or use Find similar on a Context Card.
          </p>
          {onLoadStarter ? (
            <button type="button" className="sl-btn sl-btn--primary sl-btn--block" onClick={onLoadStarter}>
              Load Starter Recipe
            </button>
          ) : null}
        </div>
      ) : (
        <div className="sl-group">
          {recipes.map((recipe) => (
            <RecipeCard key={recipe.id} recipe={recipe} lastRun={lastRuns?.[recipe.id]} onOpen={onOpen} />
          ))}
        </div>
      )}
      {playbookId !== null ? (
        <p className="sl-hint">
          <a href={`/playbooks/lab?playbook=${encodeURIComponent(playbookId)}`}>Vocabulary for this playbook →</a>
        </p>
      ) : null}
    </section>
  );
}
