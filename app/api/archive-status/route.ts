import { NextResponse } from "next/server";
import { createConfiguredArchiveClient, isArchiveConfigured } from "@/lib/candle-archive";

export const runtime = "nodejs";

export async function GET() {
  if (!isArchiveConfigured()) {
    return NextResponse.json({ configured: false });
  }
  const archive = createConfiguredArchiveClient();
  if (!archive) return NextResponse.json({ configured: false });
  try {
    const jobs = await archive.listJobs();
    const recent = jobs.slice(0, 8).map((job) => ({
      id: job.id,
      kind: job.kind,
      symbol: job.symbol,
      status: job.status,
      started_at: job.started_at,
      finished_at: job.finished_at,
      bars_upserted: job.bars_upserted,
      last_error: job.last_error,
    }));
    return NextResponse.json({
      configured: true,
      lastJob: recent[0] ?? null,
      recentFailures: recent.filter((job) => job.status === "failed"),
      recent,
    });
  } catch (error) {
    return NextResponse.json({
      configured: true,
      error: error instanceof Error ? error.message : "Could not read archive status",
    }, { status: 502 });
  }
}
