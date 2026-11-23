// #185a: route handlers import lib/agent/handle.ts on the server. Nothing it reaches may import React or a
// store module, or Next refuses to bundle the route (the React hooks live in those modules). Pure, no network.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ENTRY = "lib/agent/handle.ts";

// `import x from`, `import { x } from`, `import "x"` (not `import type`).
const IMPORT_RE = /^\s*import\s+(?!type\s)(?:[\s\S]*?\sfrom\s+)?["']([^"']+)["']/gm;
// `export { x } from`, `export * from` (not `export type`).
const EXPORT_RE = /^\s*export\s+(?!type\s)(?:\*|\{[^}]*\})\s*from\s+["']([^"']+)["']/gm;

const FORBIDDEN_PACKAGES = new Set(["react", "react-dom", "next/navigation"]);
const FORBIDDEN_FILES = new Set(["lib/store.ts", "lib/prefs.ts", "lib/ui.ts", "lib/toast.ts"]);

function specifiersOf(source: string): string[] {
  const out: string[] = [];
  for (const re of [IMPORT_RE, EXPORT_RE]) {
    re.lastIndex = 0;
    for (const match of source.matchAll(re)) out.push(match[1]);
  }
  return out;
}

function resolveRelative(fromFile: string, specifier: string): string | null {
  const base = path.resolve(path.dirname(path.join(root, fromFile)), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`]) {
    if (existsSync(candidate) && !candidate.endsWith("/")) {
      return path.relative(root, candidate).split(path.sep).join("/");
    }
  }
  return null;
}

/** Every module reachable from `entry` through static, value-level relative imports and re-exports. */
function reachableFrom(entry: string) {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const unresolved: string[] = [];
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(path.join(root, file), "utf8");
    for (const specifier of specifiersOf(source)) {
      if (specifier.startsWith(".")) {
        const target = resolveRelative(file, specifier);
        if (target) queue.push(target);
        else unresolved.push(`${file} -> ${specifier}`);
      } else {
        packages.add(specifier);
      }
    }
  }
  return { seen, packages, unresolved };
}

test("server graph (#185a): lib/agent/handle.ts reaches no React, Next navigation or store module", () => {
  const { seen, packages, unresolved } = reachableFrom(ENTRY);

  assert.deepEqual(unresolved, [], "every relative import in the server graph must resolve");

  const badPackages = [...packages].filter((name) => FORBIDDEN_PACKAGES.has(name));
  assert.deepEqual(badPackages, [], `server graph imports client-only packages: ${badPackages.join(", ")}`);

  const badFiles = [...seen].filter((file) => file.endsWith("-store.ts") || FORBIDDEN_FILES.has(file));
  assert.deepEqual(badFiles, [], `server graph reaches store or UI-state modules: ${badFiles.join(", ")}`);
});

test("server graph (#185a): the walk really reaches the command layer and the sanitizers", () => {
  // If the walk stopped early, the test above would pass for the wrong reason.
  const { seen } = reachableFrom(ENTRY);
  for (const file of [
    "lib/agent/handle.ts",
    "lib/agent/dispatch.ts",
    "lib/commands/journal-commands.ts",
    "lib/persistence/local-adapter.ts",
    "lib/persistence/supabase-adapter.ts",
    "lib/prefs-sanitize.ts",
    "lib/mood-store-sanitize.ts",
    "lib/challenge-sanitize.ts",
    "lib/plans-sanitize.ts",
    "lib/playbooks-sanitize.ts",
    "lib/drills-sanitize.ts",
    "lib/calls-sanitize.ts",
  ]) {
    assert.ok(seen.has(file), `expected ${file} in the server graph`);
  }
});
