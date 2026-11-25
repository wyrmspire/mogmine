// #SL-14: GET /api/v1/strategy-lab/skills (docs/design-2026-11-24/09 §4.5). Read scope. The registry's skill metadata.
// The pipeline is in lib/agent/strategy-lab.ts.
import { handleSkillsRequest } from "@/lib/agent/strategy-lab";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return handleSkillsRequest(request);
}
