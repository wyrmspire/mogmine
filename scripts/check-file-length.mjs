// Advisory report: production source files over the file-length target (AGENTS.md §6.12).
// Usage: node scripts/check-file-length.mjs [--target=450]
// Always exits 0. It reports; the PR body justifies any over-target file it touches.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const targetArg = process.argv.find((arg) => arg.startsWith("--target="));
const target = targetArg ? Number(targetArg.slice("--target=".length)) : 450;
if (!Number.isInteger(target) || target <= 0) {
  console.error(`Invalid --target: ${targetArg}`);
  process.exit(1);
}

const SOURCE_PATTERN = /^(app|components|lib|scripts)\/.+\.(ts|tsx|mjs|css)$/;
const EXCLUDED_PATTERN = /(^|\/)__tests__\/|\.d\.ts$/;

const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split("\n")
  .filter((path) => SOURCE_PATTERN.test(path) && !EXCLUDED_PATTERN.test(path));

const over = tracked
  .map((path) => ({ path, lines: readFileSync(path, "utf8").split("\n").length - 1 }))
  .filter((file) => file.lines > target)
  .sort((a, b) => b.lines - a.lines);

console.log(`File-length target: ${target} lines (AGENTS.md §6.12). Checked ${tracked.length} source files.`);
if (over.length === 0) {
  console.log("No file is over the target.");
} else {
  console.log(`${over.length} file(s) over the target. Report and justify any you touch or grow in the PR:`);
  for (const file of over) console.log(`  ${String(file.lines).padStart(5)}  ${file.path}`);
}
