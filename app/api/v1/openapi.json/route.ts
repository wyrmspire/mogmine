// #185b: GET /api/v1/openapi.json. Public and data-free: the spec describes the routes, never a user's records.
import { buildOpenApiSpec } from "@/lib/agent/openapi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  return Response.json(buildOpenApiSpec(origin), {
    headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" },
  });
}
