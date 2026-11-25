import assert from "node:assert/strict";
import { truncateSeries } from "../strategy-lab/series.ts";
import type { Skill, SkillContext } from "../strategy-lab/types.ts";

/** Reusable proof that a feature/label produces the same result without future bars. */
export function assertNoLookahead(skill: Skill, ctx: SkillContext): void {
  assert.notEqual(skill.meta.kind, "measure", "after-entry measures intentionally read future bars");
  const fullPreflight = skill.preflight(ctx);
  const full = fullPreflight.ok ? skill.compute(ctx) : fullPreflight;
  const truncatedCtx = { ...ctx, series: truncateSeries(ctx.series, ctx.i) };
  const truncatedPreflight = skill.preflight(truncatedCtx);
  const truncated = truncatedPreflight.ok ? skill.compute(truncatedCtx) : truncatedPreflight;
  assert.deepEqual(truncated, full, `${skill.meta.id}@${skill.meta.version} read bars after i=${ctx.i}`);
}
