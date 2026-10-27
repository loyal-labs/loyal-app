import { loadGrowthMetricsReading } from "@/lib/yield-optimization/growth-metrics.server";

// Current reading only; daily history is kept by the feed Worker.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const reading = await loadGrowthMetricsReading();
    return Response.json(
      {
        ...reading,
        methodology:
          "TVL = Earn holdings + Earn MAX holdings. Active users = smart accounts (or Earn MAX holders) whose combined balance is above $1.",
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      }
    );
  } catch {
    return Response.json(
      { error: "growth metrics unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
