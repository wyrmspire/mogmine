import { NextResponse } from "next/server";
import { readArchiveStatus } from "@/lib/market-data/archive";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

export async function GET() {
  const status = await readArchiveStatus();
  return NextResponse.json(status, { headers });
}
