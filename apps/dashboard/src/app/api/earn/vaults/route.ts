import { getYieldNeonSql } from "@/lib/yield-optimization/yield-neon-client.server";

export const revalidate = 300; // 5 minutes

const MAX_VAULTS = 50_000;

// Loyal treasury autonomous vault — not in user_yield_positions.
// Same pubkey as admin MANIFEST.vault in
// admin/src/app/(admin)/earn/autonomous-vault/autonomous-vault-data.ts
const TREASURY_VAULTS = [
  "F7zuL14omw4JJfS1cvsWXVb3wh48dvsonMJgoc9tYu3e",
] as const;

type VaultRow = { vault_pubkey: string };

export async function GET() {
  try {
    const sql = getYieldNeonSql();
    const result = await sql`
      SELECT DISTINCT vault_pubkey
      FROM loyal_yield.user_yield_positions
      WHERE status = 'active'
        AND vault_pubkey IS NOT NULL
        AND length(vault_pubkey) BETWEEN 32 AND 44
      ORDER BY vault_pubkey
      LIMIT ${MAX_VAULTS}
    `;

    if (!Array.isArray(result)) {
      throw new Error("unexpected neon result shape");
    }

    const fromDb = (result as VaultRow[]).map((r) => r.vault_pubkey);
    const seen = new Set(fromDb);
    const vaults = fromDb.concat(
      TREASURY_VAULTS.filter((vault) => !seen.has(vault)),
    );

    return Response.json(
      {
        vaults,
        count: vaults.length,
        updatedAt: new Date().toISOString(),
      },
      {
        status: 200,
        headers: {
          "Cache-Control":
            "public, s-maxage=300, stale-while-revalidate=60, max-age=60",
          "CDN-Cache-Control": "public, s-maxage=300",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch {
    return Response.json(
      { error: "vault list unavailable" },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}