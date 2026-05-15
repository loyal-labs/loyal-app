import { createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type AccountMeta,
} from "@solana/web3.js";
import { createLoyalSmartAccountsClient } from "../sdk/loyal-smart-accounts/src/client.ts";
import { generated } from "../sdk/loyal-smart-accounts/src/index.ts";
import { instructionsToSynchronousTransactionDetailsV2 } from "../sdk/loyal-smart-accounts-core/src/index.ts";
import {
  USDC_DECIMALS,
  buildRouteDepositInstruction,
  encodeCrankRouteData,
  getCrankAuthorityPda,
  getOwnerUsdcAta,
  getVaultCollateralAta,
  getVaultPda,
  getVaultUsdcAta,
  inferRouterSolanaEnvFromRpcUrl,
  loadKeypair,
  parseUiAmountToAtomic,
  requireArg,
  resolveDefaultRpcUrl,
  resolveDefaultRouterSolanaEnv,
  resolveDefaultSmartAccountProgramId,
  resolveKaminoRouterConfig,
  resolveRouterSolanaEnv,
  serializePolicyPayload,
  type KaminoRouterConfigOverrides,
  type RouterSolanaEnv,
} from "./kamino-router-common.ts";

type ParsedArgs = {
  policyPda: PublicKey;
  crankKeypairPath: string;
  accountIndex: number;
  solanaEnv: RouterSolanaEnv;
  rpcUrl: string;
  smartAccountProgramId: PublicKey;
  sourceLiquidity: PublicKey | null;
  feeLiquidity: PublicKey | null;
  createFeeAta: boolean;
  vaultCollateralTokenAccount: PublicKey | null;
  keepLiquidityAmount: bigint;
  minimumDepositAmount: bigint;
  configOverrides: KaminoRouterConfigOverrides;
  simulate: boolean;
  dryRun: boolean;
  skipPreflight: boolean;
};

function printHelpAndExit(): never {
  console.log(`Usage:
  bun run scripts/crank-kamino-router.ts --policy-pda <POLICY> [options]

Required:
  --policy-pda <PUBKEY>                Kamino router ProgramInteraction policy PDA

Crank signer:
  --keypair <PATH>                     Permissionless crank keypair. Default: ~/.config/solana/id.json
  --fee-token-account <PUBKEY>         Override fee USDC token account. Default: crank USDC ATA.
  --no-create-fee-ata                  Do not prepend idempotent crank USDC ATA creation.

Routing:
  --vault-index <NUMBER>               Vault account index. Default: 0.
  --keep-liquidity-usdc <DECIMAL>      Must match policy route_deposit constraint. Default: 500.
  --threshold-usdc <DECIMAL>           Alias for --keep-liquidity-usdc.
  --minimum-deposit-usdc <DECIMAL>     Must match policy route_deposit constraint. Default: 0.000001.
  --source-token-account <PUBKEY>      Override source vault USDC token account.
  --vault-collateral-token-account <PUBKEY>
                                       Override vault collateral token account.

Network and programs:
  --solana-env <mainnet|devnet>        Default: SOLANA_ENV/NEXT_PUBLIC_SOLANA_ENV or mainnet.
  --rpc-url <URL>                      Override RPC endpoint
  --program-id <PUBKEY>                Override Smart Account program id
  --smart-account-program-id <PUBKEY>  Alias for --program-id
  --router-program-id <PUBKEY>         Override Kamino Router program id

Kamino/account constant overrides:
  --usdc-mint <PUBKEY>
  --klend-program-id <PUBKEY>
  --lending-market <PUBKEY>
  --lending-market-authority <PUBKEY>
  --reserve <PUBKEY>
  --reserve-liquidity-supply <PUBKEY>
  --reserve-collateral-mint <PUBKEY>
  --instruction-sysvar-account <PUBKEY>
  --token-program-id <PUBKEY>
  --associated-token-program-id <PUBKEY>
  --system-program-id <PUBKEY>

Execution:
  --simulate                           Simulate the signed transaction before sending.
  --dry-run                            Build and print the transaction plan without sending.
  --skip-preflight                     Send with skipPreflight=true.
`);
  process.exit(0);
}

function parseArgs(argv: string[]): ParsedArgs {
  let policyPda: PublicKey | null = null;
  let crankKeypairPath = "~/.config/solana/id.json";
  let accountIndex = 0;
  let solanaEnv = resolveDefaultRouterSolanaEnv();
  let solanaEnvProvided = false;
  let rpcUrl = resolveDefaultRpcUrl(solanaEnv);
  let rpcUrlProvided = false;
  let smartAccountProgramId = resolveDefaultSmartAccountProgramId(solanaEnv);
  let smartAccountProgramProvided = false;
  let sourceLiquidity: PublicKey | null = null;
  let feeLiquidity: PublicKey | null = null;
  let createFeeAta = true;
  let vaultCollateralTokenAccount: PublicKey | null = null;
  let keepLiquidityAmount = parseUiAmountToAtomic("500", USDC_DECIMALS);
  let minimumDepositAmount = parseUiAmountToAtomic("0.000001", USDC_DECIMALS);
  const configOverrides: KaminoRouterConfigOverrides = {};
  let simulate = false;
  let dryRun = false;
  let skipPreflight = false;

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--policy-pda" && next) {
      policyPda = new PublicKey(next);
      index += 1;
      continue;
    }

    if (current === "--keypair" && next) {
      crankKeypairPath = next;
      index += 1;
      continue;
    }

    if (
      (current === "--vault-index" || current === "--account-index") &&
      next
    ) {
      accountIndex = Number.parseInt(next, 10);
      index += 1;
      continue;
    }

    if (current === "--solana-env" && next) {
      solanaEnv = resolveRouterSolanaEnv(next);
      solanaEnvProvided = true;
      if (!rpcUrlProvided) {
        rpcUrl = resolveDefaultRpcUrl(solanaEnv);
      }
      if (!smartAccountProgramProvided) {
        smartAccountProgramId = resolveDefaultSmartAccountProgramId(solanaEnv);
      }
      index += 1;
      continue;
    }

    if (current === "--rpc-url" && next) {
      rpcUrl = next;
      rpcUrlProvided = true;
      index += 1;
      continue;
    }

    if (
      (current === "--program-id" ||
        current === "--smart-account-program-id") &&
      next
    ) {
      smartAccountProgramId = new PublicKey(next);
      smartAccountProgramProvided = true;
      configOverrides.smartAccountProgramId = smartAccountProgramId;
      index += 1;
      continue;
    }

    if (
      (current === "--keep-liquidity-usdc" || current === "--threshold-usdc") &&
      next
    ) {
      keepLiquidityAmount = parseUiAmountToAtomic(next, USDC_DECIMALS);
      index += 1;
      continue;
    }

    if (current === "--minimum-deposit-usdc" && next) {
      minimumDepositAmount = parseUiAmountToAtomic(next, USDC_DECIMALS);
      index += 1;
      continue;
    }

    if (current === "--source-token-account" && next) {
      sourceLiquidity = new PublicKey(next);
      index += 1;
      continue;
    }

    if (current === "--fee-token-account" && next) {
      feeLiquidity = new PublicKey(next);
      index += 1;
      continue;
    }

    if (current === "--no-create-fee-ata") {
      createFeeAta = false;
      continue;
    }

    if (current === "--vault-collateral-token-account" && next) {
      vaultCollateralTokenAccount = new PublicKey(next);
      index += 1;
      continue;
    }

    if (current === "--router-program-id" && next) {
      configOverrides.routerProgramId = new PublicKey(next);
      index += 1;
      continue;
    }

    if (current === "--usdc-mint" && next) {
      configOverrides.usdcMint = new PublicKey(next);
      index += 1;
      continue;
    }

    if (current === "--klend-program-id" && next) {
      configOverrides.klendProgramId = new PublicKey(next);
      index += 1;
      continue;
    }

    if (current === "--lending-market" && next) {
      configOverrides.lendingMarket = new PublicKey(next);
      index += 1;
      continue;
    }

    if (current === "--lending-market-authority" && next) {
      configOverrides.lendingMarketAuthority = new PublicKey(next);
      index += 1;
      continue;
    }

    if (current === "--reserve" && next) {
      configOverrides.reserve = new PublicKey(next);
      index += 1;
      continue;
    }

    if (current === "--reserve-liquidity-supply" && next) {
      configOverrides.reserveLiquiditySupply = new PublicKey(next);
      index += 1;
      continue;
    }

    if (current === "--reserve-collateral-mint" && next) {
      configOverrides.reserveCollateralMint = new PublicKey(next);
      index += 1;
      continue;
    }

    if (current === "--instruction-sysvar-account" && next) {
      configOverrides.instructionSysvarAccount = new PublicKey(next);
      index += 1;
      continue;
    }

    if (current === "--token-program-id" && next) {
      configOverrides.tokenProgramId = new PublicKey(next);
      index += 1;
      continue;
    }

    if (current === "--associated-token-program-id" && next) {
      configOverrides.associatedTokenProgramId = new PublicKey(next);
      index += 1;
      continue;
    }

    if (current === "--system-program-id" && next) {
      configOverrides.systemProgramId = new PublicKey(next);
      index += 1;
      continue;
    }

    if (current === "--simulate") {
      simulate = true;
      continue;
    }

    if (current === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (current === "--skip-preflight") {
      skipPreflight = true;
      continue;
    }

    if (current === "--help" || current === "-h") {
      printHelpAndExit();
    }

    throw new Error(`Unknown argument: ${current}`);
  }

  if (!solanaEnvProvided) {
    const inferredEnv = inferRouterSolanaEnvFromRpcUrl(rpcUrl);
    if (inferredEnv) {
      solanaEnv = inferredEnv;
    }
  }

  if (
    !Number.isInteger(accountIndex) ||
    accountIndex < 0 ||
    accountIndex > 255
  ) {
    throw new Error("--vault-index must fit in u8.");
  }

  if (minimumDepositAmount <= 0n) {
    throw new Error("--minimum-deposit-usdc must be greater than zero.");
  }

  return {
    policyPda: new PublicKey(requireArg("--policy-pda", policyPda?.toBase58())),
    crankKeypairPath,
    accountIndex,
    solanaEnv,
    rpcUrl,
    smartAccountProgramId,
    sourceLiquidity,
    feeLiquidity,
    createFeeAta,
    vaultCollateralTokenAccount,
    keepLiquidityAmount,
    minimumDepositAmount,
    configOverrides: {
      ...configOverrides,
      smartAccountProgramId,
    },
    simulate,
    dryRun,
    skipPreflight,
  };
}

function hasSettingsStateExpiration(expiration: unknown): boolean {
  return (
    typeof expiration === "object" &&
    expiration !== null &&
    "__kind" in expiration &&
    (expiration as { __kind?: string }).__kind === "SettingsState"
  );
}

function buildCrankRouteInstruction(args: {
  policyPda: PublicKey;
  crankAuthority: PublicKey;
  smartAccountProgramId: PublicKey;
  routerProgramId: PublicKey;
  accountIndex: number;
  policyPayloadBytes: Uint8Array;
  remainingAccounts: AccountMeta[];
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: args.routerProgramId,
    keys: [
      { pubkey: args.policyPda, isWritable: true, isSigner: false },
      { pubkey: args.crankAuthority, isWritable: false, isSigner: false },
      {
        pubkey: args.smartAccountProgramId,
        isWritable: false,
        isSigner: false,
      },
      ...args.remainingAccounts,
    ],
    data: encodeCrankRouteData({
      accountIndex: args.accountIndex,
      policyPayload: args.policyPayloadBytes,
    }),
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const crank = loadKeypair(args.crankKeypairPath);
  const connection = new Connection(args.rpcUrl, { commitment: "confirmed" });
  const client = createLoyalSmartAccountsClient({
    connection,
    programId: args.smartAccountProgramId,
    defaultCommitment: "confirmed",
  });
  const config = resolveKaminoRouterConfig({
    env: args.solanaEnv,
    overrides: args.configOverrides,
  });
  const policy = await client.policies.queries.fetchPolicy(args.policyPda);
  if (policy.policyState.__kind !== "ProgramInteraction") {
    throw new Error(
      `Policy ${args.policyPda.toBase58()} is not a ProgramInteraction policy.`
    );
  }

  const vaultPda = getVaultPda({
    settingsPda: policy.settings,
    accountIndex: args.accountIndex,
    smartAccountProgramId: args.smartAccountProgramId,
  });
  const crankAuthority = getCrankAuthorityPda({
    policyPda: args.policyPda,
    routerProgramId: config.routerProgramId,
  });
  const isCrankAuthorityPolicySigner = policy.signers.some((signer) =>
    signer.key.equals(crankAuthority)
  );
  if (!isCrankAuthorityPolicySigner) {
    throw new Error(
      `Policy signer ${crankAuthority.toBase58()} is not registered on policy ${args.policyPda.toBase58()}.`
    );
  }

  const sourceLiquidity =
    args.sourceLiquidity ??
    getVaultUsdcAta({
      vaultPda,
      usdcMint: config.usdcMint,
      tokenProgramId: config.tokenProgramId,
      associatedTokenProgramId: config.associatedTokenProgramId,
    });
  const feeLiquidity =
    args.feeLiquidity ??
    getOwnerUsdcAta({
      owner: crank.publicKey,
      usdcMint: config.usdcMint,
      tokenProgramId: config.tokenProgramId,
      associatedTokenProgramId: config.associatedTokenProgramId,
    });
  const vaultCollateralTokenAccount =
    args.vaultCollateralTokenAccount ??
    getVaultCollateralAta({
      vaultPda,
      reserveCollateralMint: config.reserveCollateralMint,
      tokenProgramId: config.tokenProgramId,
      associatedTokenProgramId: config.associatedTokenProgramId,
    });
  const routeDepositIx = buildRouteDepositInstruction({
    config,
    crank: crank.publicKey,
    vaultPda,
    sourceLiquidity,
    feeLiquidity,
    vaultCollateralTokenAccount,
    keepLiquidityAmount: args.keepLiquidityAmount,
    minimumDepositAmount: args.minimumDepositAmount,
  });
  const compiled = instructionsToSynchronousTransactionDetailsV2({
    vaultPda,
    members: [crankAuthority],
    transaction_instructions: [routeDepositIx],
  });
  if (!compiled.accounts[0]?.pubkey.equals(crankAuthority)) {
    throw new Error(
      "Unexpected Squads sync account layout: crank authority must be the first signer account."
    );
  }
  const policyPayload: generated.PolicyPayload = {
    __kind: "ProgramInteraction",
    fields: [
      {
        instructionConstraintIndices: Uint8Array.from([0]),
        transactionPayload: {
          __kind: "SyncTransaction",
          fields: [
            {
              accountIndex: args.accountIndex,
              instructions: compiled.instructions,
            },
          ],
        },
      },
    ],
  };
  const policyPayloadBytes = serializePolicyPayload(policyPayload);
  const remainingAccounts = compiled.accounts.slice(1);

  if (hasSettingsStateExpiration(policy.expiration)) {
    remainingAccounts.unshift({
      pubkey: policy.settings,
      isWritable: false,
      isSigner: false,
    });
  }

  const instructions: TransactionInstruction[] = [];
  const expectedFeeAta = getOwnerUsdcAta({
    owner: crank.publicKey,
    usdcMint: config.usdcMint,
    tokenProgramId: config.tokenProgramId,
    associatedTokenProgramId: config.associatedTokenProgramId,
  });

  if (args.createFeeAta) {
    if (!feeLiquidity.equals(expectedFeeAta)) {
      throw new Error(
        "--no-create-fee-ata is required when --fee-token-account is not the crank owner's ATA."
      );
    }
    instructions.push(
      createAssociatedTokenAccountIdempotentInstruction(
        crank.publicKey,
        feeLiquidity,
        crank.publicKey,
        config.usdcMint,
        config.tokenProgramId,
        config.associatedTokenProgramId
      )
    );
  }

  instructions.push(
    buildCrankRouteInstruction({
      policyPda: args.policyPda,
      crankAuthority,
      smartAccountProgramId: args.smartAccountProgramId,
      routerProgramId: config.routerProgramId,
      accountIndex: args.accountIndex,
      policyPayloadBytes,
      remainingAccounts,
    })
  );

  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  const transaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: crank.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions,
    }).compileToV0Message()
  );
  transaction.sign([crank]);

  let simulation: {
    err: unknown;
    logs: string[] | null;
  } | null = null;

  if (args.simulate || args.dryRun) {
    const result = await connection.simulateTransaction(transaction, {
      commitment: "confirmed",
    });
    simulation = {
      err: result.value.err,
      logs: result.value.logs,
    };
    if (result.value.err && args.simulate && !args.dryRun) {
      throw new Error(
        `Simulation failed: ${JSON.stringify(result.value.err)}\n${(
          result.value.logs ?? []
        ).join("\n")}`
      );
    }
  }

  let signature: string | null = null;
  if (!args.dryRun) {
    signature = await connection.sendTransaction(transaction, {
      skipPreflight: args.skipPreflight,
    });
    const confirmation = await connection.confirmTransaction(
      {
        signature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      },
      "confirmed"
    );
    if (confirmation.value.err) {
      throw new Error(
        `Transaction ${signature} failed to confirm: ${JSON.stringify(
          confirmation.value.err
        )}`
      );
    }
  }

  console.log(
    JSON.stringify(
      {
        signature,
        dryRun: args.dryRun,
        simulation,
        solanaEnv: args.solanaEnv,
        rpcUrl: args.rpcUrl,
        smartAccountProgramId: args.smartAccountProgramId.toBase58(),
        routerProgramId: config.routerProgramId.toBase58(),
        policyPda: args.policyPda.toBase58(),
        settingsPda: policy.settings.toBase58(),
        vaultPda: vaultPda.toBase58(),
        accountIndex: args.accountIndex,
        crank: crank.publicKey.toBase58(),
        crankAuthority: crankAuthority.toBase58(),
        sourceLiquidity: sourceLiquidity.toBase58(),
        feeLiquidity: feeLiquidity.toBase58(),
        createFeeAta: args.createFeeAta,
        vaultCollateralTokenAccount: vaultCollateralTokenAccount.toBase58(),
        keepLiquidityAmount: args.keepLiquidityAmount.toString(),
        minimumDepositAmount: args.minimumDepositAmount.toString(),
        policyPayloadLength: policyPayloadBytes.length,
        remainingAccountCount: remainingAccounts.length,
        instructionCount: instructions.length,
        kamino: {
          usdcMint: config.usdcMint.toBase58(),
          klendProgramId: config.klendProgramId.toBase58(),
          lendingMarket: config.lendingMarket.toBase58(),
          lendingMarketAuthority: config.lendingMarketAuthority.toBase58(),
          reserve: config.reserve.toBase58(),
          reserveLiquiditySupply: config.reserveLiquiditySupply.toBase58(),
          reserveCollateralMint: config.reserveCollateralMint.toBase58(),
        },
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Failed to crank Kamino router."
  );
  process.exit(1);
});
