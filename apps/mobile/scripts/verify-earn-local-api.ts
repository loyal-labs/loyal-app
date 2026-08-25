import { appendFileSync, readFileSync } from "node:fs";

import {
  getKaminoUsdcEarnTargetForCluster,
  LoyalCluster,
} from "@loyal-labs/actions";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

type LocalState = {
  collateralMint: string;
  market: string;
  marketAuthority: string;
  obligation: string;
  policyAccount: string;
  policySeed: string;
  reserve: string;
  reserveLiquiditySupply: string;
  settingsPda: string;
  setupPolicyAccount: string;
  setupPolicySeed: string;
  usdcMint: string;
  vaultCollateralAta: string;
  vaultPubkey: string;
  walletAddress: string;
};

const args = Object.fromEntries(
  process.argv.slice(2).reduce<string[][]>((pairs, value, index, all) => {
    if (index % 2 === 0) pairs.push([value.replace(/^--/, ""), all[index + 1]!]);
    return pairs;
  }, []),
) as Record<string, string>;

for (const key of ["state", "rpc-url", "transactions", "port", "amount-raw"]) {
  if (!args[key]) throw new Error(`Missing --${key}.`);
}

const state = JSON.parse(readFileSync(args.state!, "utf8")) as LocalState;
const connection = new Connection(args["rpc-url"]!, "confirmed");
const policySigner = Keypair.fromSeed(new Uint8Array(32).fill(9)).publicKey;
const programId = "SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG";
const KAMINO_FARMS_PROGRAM = new PublicKey(
  "FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr",
);
const KAMINO_DEPOSIT_DISCRIMINATOR = Buffer.from([
  216, 224, 191, 27, 204, 151, 102, 175,
]);
const KAMINO_WITHDRAW_DISCRIMINATOR = Buffer.from([
  235, 52, 119, 152, 149, 197, 20, 7,
]);
let amountRaw = args["amount-raw"]!;

function decimalAmountToRaw(amount: string): bigint {
  const [whole, fraction = ""] = amount.split(".");
  return (
    BigInt(whole || "0") * BigInt(1_000_000) +
    BigInt(fraction.padEnd(6, "0").slice(0, 6) || "0")
  );
}

function encodedAmount(discriminator: Buffer, raw: bigint): string {
  const data = Buffer.alloc(16);
  discriminator.copy(data);
  data.writeBigUInt64LE(raw, 8);
  return data.toString("base64");
}

function kaminoInstructions(deposit: boolean, raw: bigint) {
  const lendProgramId = getKaminoUsdcEarnTargetForCluster(
    LoyalCluster.MainnetBeta,
  ).lendProgramId.toBase58();
  const vaultUsdcAta = getAssociatedTokenAddressSync(
    new PublicKey(state.usdcMint),
    new PublicKey(state.vaultPubkey),
    true,
    TOKEN_PROGRAM_ID,
  ).toBase58();
  const ro = (address: string) => ({ address, role: "READONLY" });
  const rw = (address: string) => ({ address, role: "WRITABLE" });
  const signer = (address: string) => ({
    address,
    role: "WRITABLE_SIGNER",
  });
  const common = [
    signer(state.vaultPubkey),
    rw(state.obligation),
    ro(state.market),
    ro(state.marketAuthority),
    rw(state.reserve),
    ro(state.usdcMint),
  ];
  const accounts = deposit
    ? [
        ...common,
        rw(state.reserveLiquiditySupply),
        rw(state.collateralMint),
        rw(state.vaultCollateralAta),
        rw(vaultUsdcAta),
      ]
    : [
        ...common,
        rw(state.vaultCollateralAta),
        rw(state.collateralMint),
        rw(state.reserveLiquiditySupply),
        rw(vaultUsdcAta),
      ];
  accounts.push(
    ro(lendProgramId),
    ro(TOKEN_PROGRAM_ID.toBase58()),
    ro(TOKEN_PROGRAM_ID.toBase58()),
    ro("Sysvar1nstructions1111111111111111111111111"),
    ro(lendProgramId),
    ro(lendProgramId),
    ro(KAMINO_FARMS_PROGRAM.toBase58()),
  );
  return {
    instructions: [
      {
        accounts,
        data: encodedAmount(
          deposit
            ? KAMINO_DEPOSIT_DISCRIMINATOR
            : KAMINO_WITHDRAW_DISCRIMINATOR,
          raw,
        ),
        programAddress: lendProgramId,
      },
    ],
  };
}

async function assertFinalized(signature: string): Promise<number> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const statuses = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const status = statuses.value[0];
    if (status?.err) {
      throw new Error(
        `Signature ${signature} failed: ${JSON.stringify(status.err)}.`,
      );
    }
    if (status?.confirmationStatus === "finalized") {
      const transaction = await connection.getTransaction(signature, {
        commitment: "finalized",
        maxSupportedTransactionVersion: 0,
      });
      if (!transaction) {
        throw new Error(`Finalized transaction ${signature} is absent.`);
      }
      return transaction.slot;
    }
    await Bun.sleep(100);
  }
  throw new Error(`Signature ${signature} did not finalize in time.`);
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

function positionResponse() {
  return {
    position: {
      currentAmountRaw: amountRaw,
      currentSupplyApyBps: "300",
      principalAmountRaw: amountRaw,
      status: amountRaw === "0" ? "withdrawn" : "active",
    },
    settingsPda: state.settingsPda,
    smartAccountAddress: state.vaultPubkey,
  };
}

function holding() {
  return {
    amountRaw,
    kind: "kamino",
    label: "Kamino USDC",
    liquidityMint: state.usdcMint,
    market: state.market,
    marketName: "Kamino",
    reserve: state.reserve,
  };
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(args.port),
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (
        request.method === "POST" &&
        (path.endsWith("/klend/deposit-instructions") ||
          path.endsWith("/klend/withdraw-instructions"))
      ) {
        const body = (await request.json()) as {
          amount?: string;
          wallet?: string;
        };
        if (!body.amount || body.wallet !== state.vaultPubkey) {
          return json({ error: { code: "invalid_kamino_fixture_request" } }, 400);
        }
        return json(
          kaminoInstructions(
            path.endsWith("/deposit-instructions"),
            decimalAmountToRaw(body.amount),
          ),
        );
      }
      if (request.method === "GET" && path.endsWith("/earn/state")) {
        return json(positionResponse());
      }
      if (request.method === "GET" && path.endsWith("/earn/holdings")) {
        const slot = await connection.getSlot("confirmed");
        return json({
          currentTotalAmountRaw: amountRaw,
          holdings: amountRaw === "0" ? [] : [holding()],
          observedAt: new Date().toISOString(),
          observedSlot: String(slot),
          settingsPda: state.settingsPda,
          smartAccountAddress: state.vaultPubkey,
        });
      }
      if (request.method === "GET" && path.endsWith("/withdraw/sources")) {
        return json({
          sources:
            amountRaw === "0"
              ? []
              : [
                  {
                    ...holding(),
                    id: state.reserve,
                    sourceId: `reserve:${state.reserve}`,
                    tokenAccount: null,
                    type: "reserve",
                  },
                ],
          settingsPda: state.settingsPda,
          smartAccountAddress: state.vaultPubkey,
        });
      }
      if (request.method === "GET" && path.endsWith("/autodeposit/state")) {
        return json({
          autodeposit: null,
          prepareContext: { cluster: "mainnet-beta", policySigner: policySigner.toBase58(), programId },
          settingsPda: state.settingsPda,
          smartAccountAddress: state.vaultPubkey,
        });
      }
      if (
        request.method === "GET" &&
        path.endsWith("/earn-forecast/summary")
      ) {
        const now = new Date().toISOString();
        return json({
          forecast: {
            apyBps: 300,
            rangeHighBps: 300,
            rangeLowBps: 300,
            window: { startedAt: now, endedAt: now },
          },
          history: { samples: [] },
        });
      }
      if (request.method === "POST" && path.endsWith("/withdraw/prepare-context")) {
        return json({
          cluster: "mainnet-beta",
          programId,
          settingsPda: state.settingsPda,
          smartAccountAddress: state.vaultPubkey,
          withdrawInput: {
            amountRaw,
            mode: "full",
            closePoliciesOnFullWithdrawal: false,
            policySigner: policySigner.toBase58(),
            source: {
              type: "reserve",
              id: state.reserve,
              amountRaw,
              liquidityMint: state.usdcMint,
              market: state.market,
              reserve: state.reserve,
            },
            target: {
              reserve: state.reserve,
              market: state.market,
              liquidityMint: state.usdcMint,
              supplyApyBps: "300",
            },
            fullWithdrawalTargets: [
              {
                amountRaw,
                liquidityMint: state.usdcMint,
                market: state.market,
                reserve: state.reserve,
                reserveCollateralMint: state.collateralMint,
                reserveLiquiditySupply: state.reserveLiquiditySupply,
                supplyApyBps: "300",
                vaultCollateralAta: state.vaultCollateralAta,
              },
            ],
            yieldRoutingPolicy: {
              account: state.policyAccount,
              seed: state.policySeed,
              setupPolicy: {
                account: state.setupPolicyAccount,
                seed: state.setupPolicySeed,
              },
            },
            autodepositClose: null,
          },
        });
      }
      if (request.method === "POST" && path.endsWith("/withdraw/confirm")) {
        const body = (await request.json()) as { withdrawalSignature?: string };
        if (!body.withdrawalSignature) return json({ error: { code: "invalid_request" } }, 400);
        const slot = await assertFinalized(body.withdrawalSignature);
        appendFileSync(
          args.transactions!,
          `${JSON.stringify({ signature: body.withdrawalSignature, slot, stage: "full_withdrawal" })}\n`,
        );
        amountRaw = "0";
        return json({ ok: true, status: "full_exit_verified", position: positionResponse().position });
      }
      if (request.method === "POST" && path.endsWith("/cleanup/prepare-context")) {
        if (amountRaw !== "0") return json({ error: { code: "full_exit_incomplete" } }, 409);
        const vaultUsdcAta = getAssociatedTokenAddressSync(
          new PublicKey(state.usdcMint),
          new PublicKey(state.vaultPubkey),
          true,
          TOKEN_PROGRAM_ID,
        );
        return json({
          cluster: "mainnet-beta",
          programId,
          settingsPda: state.settingsPda,
          cleanupInput: {
            policySigner: policySigner.toBase58(),
            vaultTokenAccounts: [
              {
                address: state.vaultCollateralAta,
                amountRaw: "0",
                decimals: 6,
                mint: state.collateralMint,
                tokenProgramId: TOKEN_PROGRAM_ID.toBase58(),
              },
              {
                address: vaultUsdcAta.toBase58(),
                amountRaw: "0",
                decimals: 6,
                mint: state.usdcMint,
                tokenProgramId: TOKEN_PROGRAM_ID.toBase58(),
              },
            ],
            yieldRoutingPolicy: {
              account: state.policyAccount,
              seed: state.policySeed,
              setupPolicy: {
                account: state.setupPolicyAccount,
                seed: state.setupPolicySeed,
              },
            },
          },
        });
      }
      if (request.method === "POST" && path.endsWith("/cleanup/confirm")) {
        const body = (await request.json()) as { cleanupSignature?: string };
        if (!body.cleanupSignature) return json({ error: { code: "invalid_request" } }, 400);
        await assertFinalized(body.cleanupSignature);
        const accounts = await connection.getMultipleAccountsInfo(
          [state.policyAccount, state.setupPolicyAccount].map((value) => new PublicKey(value)),
          "finalized",
        );
        if (accounts.some(Boolean)) {
          return json({ error: { code: "cleanup_not_finalized", message: "Policy remains open." } }, 409);
        }
        return json({ ok: true, status: "full_exit_closed" });
      }
      if (request.method === "GET" && path.includes("/earn/earnings")) {
        return json({ bars: [], summary: null });
      }
      return json({ error: { code: "isolated_fixture_route_missing", path } }, 404);
    } catch (error) {
      return json(
        { error: { code: "isolated_fixture_failed", message: error instanceof Error ? error.message : String(error) } },
        500,
      );
    }
  },
});

console.info(`READY http://${server.hostname}:${server.port}`);
await new Promise<void>((resolve) => {
  process.once("SIGINT", resolve);
  process.once("SIGTERM", resolve);
});
server.stop(true);
