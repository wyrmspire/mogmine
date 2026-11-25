// Local recipe store (docs/design-2026-11-24/09 §11.1, SL-8). Recipes live in localStorage under one key as
// { recipes: Recipe[] }. Every version is kept, so a run always names the exact recipe@version it used.
// Pure functions over a plain store value. Only `loadRecipeStore` / `saveRecipeStore` touch a Storage object,
// and that object is passed in, so tests need no DOM.

import { validateRecipe, type RecipeIssue } from "./recipe.ts";
import { SKILLS, type SkillRegistry } from "./registry.ts";
import type { Recipe } from "./types.ts";

export const RECIPE_STORE_KEY = "mogmine-strategy-lab-recipes-v1";

export interface RecipeStore { recipes: Recipe[] }

export interface DroppedRecipe { index: number; errors: RecipeIssue[] }
export interface StoreParse { store: RecipeStore; dropped: DroppedRecipe[]; error?: string }

/** The storage methods used here. `window.localStorage` satisfies it. */
export interface RecipeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Sanitise an unknown stored value. Each recipe is validated on its own, so one bad entry drops only itself
 * (reported in `dropped`) and never takes the rest of the store with it.
 */
export function parseRecipeStore(raw: unknown, registry: SkillRegistry = SKILLS): StoreParse {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { recipes?: unknown }).recipes)
    ? (raw as { recipes: unknown[] }).recipes
    : null;
  if (!list) return { store: { recipes: [] }, dropped: [], error: "Stored recipes are missing or not a list" };
  const recipes: Recipe[] = [];
  const dropped: DroppedRecipe[] = [];
  list.forEach((entry, index) => {
    const checked = validateRecipe(entry, registry);
    if (checked.ok) recipes.push(checked.recipe);
    else dropped.push({ index, errors: checked.errors });
  });
  return { store: { recipes }, dropped };
}

/** Read the store from storage. A missing key is an empty store; bad JSON is reported, never thrown. */
export function loadRecipeStore(storage: RecipeStorage | null | undefined, registry: SkillRegistry = SKILLS): StoreParse {
  const text = storage?.getItem(RECIPE_STORE_KEY) ?? null;
  if (text === null) return { store: { recipes: [] }, dropped: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { store: { recipes: [] }, dropped: [], error: "Stored recipes are not valid JSON" };
  }
  return parseRecipeStore(raw, registry);
}

export function saveRecipeStore(storage: RecipeStorage, store: RecipeStore): void {
  storage.setItem(RECIPE_STORE_KEY, JSON.stringify({ recipes: store.recipes }));
}

/** Every version of one recipe, oldest first. */
export function recipeVersions(store: RecipeStore, id: string): Recipe[] {
  return store.recipes.filter((r) => r.id === id).sort((a, b) => a.version - b.version);
}

/** The newest version of every recipe, sorted by name then id. */
export function latestRecipes(store: RecipeStore): Recipe[] {
  const latest = new Map<string, Recipe>();
  for (const recipe of store.recipes) {
    const current = latest.get(recipe.id);
    if (!current || recipe.version > current.version) latest.set(recipe.id, recipe);
  }
  return [...latest.values()].sort((a, b) => a.name.localeCompare(b.name, "en") || a.id.localeCompare(b.id, "en"));
}

/** `version` pins an exact version. Without it the newest is returned. */
export function findRecipe(store: RecipeStore, id: string, version?: number): Recipe | undefined {
  const versions = recipeVersions(store, id);
  return version === undefined ? versions[versions.length - 1] : versions.find((r) => r.version === version);
}

/** Recipes linked to one playbook (§6.1). Unlinked exploration recipes have playbookId null. */
export function recipesForPlaybook(store: RecipeStore, playbookId: string): Recipe[] {
  return latestRecipes(store).filter((r) => r.playbookId === playbookId);
}

export type SaveOutcome =
  | { ok: true; store: RecipeStore; recipe: Recipe }
  | { ok: false; errors: RecipeIssue[] };

/**
 * Save a draft. A new id starts at version 1. An existing id either replaces its newest version (a fix before
 * any run) or appends the next version (`newVersion: true`, used after a run, §5.3 / SL-12). Older versions are
 * never removed, so a stored run still points at real data.
 */
export function saveRecipe(
  store: RecipeStore, draft: unknown, options: { newVersion?: boolean } = {}, registry: SkillRegistry = SKILLS,
): SaveOutcome {
  const checked = validateRecipe(draft, registry);
  if (!checked.ok) return { ok: false, errors: checked.errors };
  const existing = recipeVersions(store, checked.recipe.id);
  if (existing.length === 0) {
    const recipe = { ...checked.recipe, version: 1 };
    return { ok: true, recipe, store: { recipes: [...store.recipes, recipe] } };
  }
  const newest = existing[existing.length - 1];
  if (options.newVersion) {
    const recipe = { ...checked.recipe, version: newest.version + 1 };
    return { ok: true, recipe, store: { recipes: [...store.recipes, recipe] } };
  }
  const recipe = { ...checked.recipe, version: newest.version };
  return {
    ok: true,
    recipe,
    store: { recipes: store.recipes.map((r) => (r.id === recipe.id && r.version === recipe.version ? recipe : r)) },
  };
}

/** Remove every version of a recipe. Returns the store unchanged when the id is unknown. */
export function removeRecipe(store: RecipeStore, id: string): RecipeStore {
  if (!store.recipes.some((r) => r.id === id)) return store;
  return { recipes: store.recipes.filter((r) => r.id !== id) };
}

/** The JSON backup path (Copy JSON / Paste JSON). Same shape as storage, pretty-printed. */
export function exportRecipesJson(store: RecipeStore): string {
  return `${JSON.stringify({ recipes: store.recipes }, null, 2)}\n`;
}

/** Parse a pasted backup. Invalid entries are reported and dropped; the rest are kept. */
export function importRecipesJson(text: string, registry: SkillRegistry = SKILLS): StoreParse {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { store: { recipes: [] }, dropped: [], error: "Pasted text is not valid JSON" };
  }
  return parseRecipeStore(raw, registry);
}
