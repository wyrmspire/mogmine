// Server-only endpoint: GET /api/strategy-lab/archive?symbol=MES&sessions=20
// Reads `mogmine_market_coverage` and `mogmine_market_candles` using the caller's allow-listed Supabase JWT.
import { NextRequest, NextResponse } from "next/server";
import { loadArchiveFromSupabase, parseArchiveQuery, type ArchiveErrorReason } from "@/lib/strategy-lab/archive-loader";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ERROR_STATUS: Record<ArchiveErrorReason, number> = {
  unconfigured: 200,
  invalid: 400,
  unauthenticated: 401,
  forbidden: 403,
  upstream: 502,
};

function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

export async function GET(request: NextRequest) {
  const parsed = parseArchiveQuery(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, reason: "invalid" as const, detail: parsed.detail }, { status: 400 });
  }
  const result = await loadArchiveFromSupabase({
    symbol: parsed.symbol,
    sessions: parsed.sessions,
    accessToken: bearerToken(request.headers.get("authorization")),
  });
  const status = result.ok ? 200 : ERROR_STATUS[result.reason];
  return NextResponse.json(result, { status });
}
