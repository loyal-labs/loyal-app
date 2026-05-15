import bs58 from "bs58";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createLoyalSmartAccountsClient } from "../sdk/loyal-smart-accounts/src/client.ts";
import { generated, pda } from "../sdk/loyal-smart-accounts/src/index.ts";
import {
  Settings,
  freezePreparedOperation,
  settingsDiscriminator,
  toBigInt,
} from "../sdk/loyal-smart-accounts-core/src/index.ts";
import {
  ROUTE_DEPOSIT_DISCRIMINATOR,
  USDC_DECIMALS,
  dataOperatorName,
  getCrankAuthorityPda,
  getPolicyPda,
  getVaultCollateralAta,
  getVaultPda,
  getVaultUsdcAta,
  inferRouterSolanaEnvFromRpcUrl,
  loadKeypair,
  parseThresholdOperator,
  parseUiAmountToAtomic,
  requireArg,
  resolveDefaultRpcUrl,
  resolveDefaultRouterSolanaEnv,
  resolveDefaultSmartAccountProgramId,
  resolveKaminoRouterConfig,
  resolveRouterSolanaEnv,
  type KaminoRouterConfig,
  type KaminoRouterConfigOverrides,
  type RouterSolanaEnv,
} from "./kamino-router-common.ts";

type ParsedArgs = {
  settingsPda: PublicKey | null;
  userAddress: PublicKey | null;
  signerKeypairPath: string;
  feePayerKeypairPath: string | null;
  accountIndex: number;
  policySeed: number | null;
  solanaEnv: RouterSolanaEnv;
  rpcUrl: string;
  smartAccountProgramId: PublicKey;
  sourceLiquidity: PublicKey | null;
  feeLiquidity: PublicKey | null;
  vaultCollateralTokenAccount: PublicKey | null;
  keepLiquidityAmount: bigint;
  minimumDepositAmount: bigint;
  thresholdOperator: generated.DataOperator;
  maxRoutedPerPeriod: bigint | null;
  spendingLimitPeriod: generated.PeriodV2;
  configOverrides: KaminoRouterConfigOverrides;
  approve: boolean;
  execute: boolean;
  memo?: string;
};

function printHelpAndExit(): never {
  console.log(`Usage:
  bun run scripts/create-kamino-router-policy.ts (--settings-pda <PUBKEY> | --user <PUBKEY>) --keypair <USER_KEYPAIR> [options]

Required:
  --keypair <PATH>                     Current Settings signer keypair

Account selector:
  --settings-pda <PUBKEY>              Smart-account Settings PDA
  --user <PUBKEY>                      User wallet address; resolves Settings PDA on-chain

Sponsorship:
  --fee-payer-keypair <PATH>           Sponsor/rent payer keypair. Defaults to --keypair.

Policy:
  --policy-seed <NUMBER>               Override next policy seed. Defaults to Settings.policySeed + 1.
  --vault-index <NUMBER>               Vault account index. Default: 0.
  --keep-liquidity-usdc <DECIMAL>      Vault USDC amount to keep liquid. Default: 500.
  --threshold-usdc <DECIMAL>           Alias for --keep-liquidity-usdc.
  --minimum-deposit-usdc <DECIMAL>     Exact route_deposit minimum. Default: 0.000001.
  --threshold-operator <OP>            gt, gte, greater-than, or greater-than-or-equal. Default: gt.
  --threshold-inclusive                Alias for --threshold-operator gte.
  --source-token-account <PUBKEY>      Override source vault USDC token account.
  --pin-fee-token-account <PUBKEY>     Optional: pin fee account. Omit for permissionless crank fees.
  --max-routed-usdc-per-period <DECIMAL>
                                       Optional ProgramInteraction spending cap for USDC balance decrease.
  --spending-limit-period <PERIOD>     one-time, daily, weekly, monthly, or custom:<seconds>. Default: daily.

Routing:
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
  --vault-collateral-token-account <PUBKEY>
  --instruction-sysvar-account <PUBKEY>
  --token-program-id <PUBKEY>
  --associated-token-program-id <PUBKEY>
  --system-program-id <PUBKEY>

Execution:
  --memo <TEXT>                        Optional memo on the settings transaction.
  --approve                            Also approve with --keypair.
  --execute                            Also execute after approval. Implies --approve.
`);
  process.exit(0);
}

function parsePeriodV2(value: string): generated.PeriodV2 {
  const normalized = value.trim().toLowerCase();
  if (["one-time", "onetime", "once"].includes(normalized)) {
    return { __kind: "OneTime" };
  }
  if (["daily", "day"].includes(normalized)) {
    return { __kind: "Daily" };
  }
  if (["weekly", "week"].includes(normalized)) {
    return { __kind: "Weekly" };
  }
  if (["monthly", "month"].includes(normalized)) {
    return { __kind: "Monthly" };
  }
  if (normalized.startsWith("custom:")) {
    const seconds = BigInt(normalized.slice("custom:".length));
    if (seconds <= 0n) {
      throw new Error(
        "--spending-limit-period custom seconds must be positive."
      );
    }
    return { __kind: "Custom", fields: [seconds] };
  }
  throw new Error(
    "--spending-limit-period must be one-time, daily, weekly, monthly, or custom:<seconds>."
  );
}

function parseArgs(argv: string[]): ParsedArgs {
  let settingsPda: PublicKey | null = null;
  let userAddress: PublicKey | null = null;
  let signerKeypairPath: string | undefined;
  let feePayerKeypairPath: string | null = null;
  let accountIndex = 0;
  let policySeed: number | null = null;
  let solanaEnv = resolveDefaultRouterSolanaEnv();
  let solanaEnvProvided = false;
  let rpcUrl = resolveDefaultRpcUrl(solanaEnv);
  let rpcUrlProvided = false;
  let smartAccountProgramId = resolveDefaultSmartAccountProgramId(solanaEnv);
  let smartAccountProgramProvided = false;
  let sourceLiquidity: PublicKey | null = null;
  let feeLiquidity: PublicKey | null = null;
  let vaultCollateralTokenAccount: PublicKey | null = null;
  let keepLiquidityAmount = parseUiAmountToAtomic("500", USDC_DECIMALS);
  let minimumDepositAmount = parseUiAmountToAtomic("0.000001", USDC_DECIMALS);
  let thresholdOperator = generated.DataOperator.GreaterThan;
  let maxRoutedPerPeriod: bigint | null = null;
  let spendingLimitPeriod: generated.PeriodV2 = { __kind: "Daily" };
  const configOverrides: KaminoRouterConfigOverrides = {};
  let approve = false;
  let execute = false;
  let memo: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--settings-pda" && next) {
      settingsPda = new PublicKey(next);
      index += 1;
      continue;
    }

    if ((current === "--user" || current === "--wallet") && next) {
      userAddress = new PublicKey(next);
      index += 1;
      continue;
    }

    if (current === "--keypair" && next) {
      signerKeypairPath = next;
      index += 1;
      continue;
    }

    if (current === "--fee-payer-keypair" && next) {
      feePayerKeypairPath = next;
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

    if (current === "--policy-seed" && next) {
      policySeed = Number.parseInt(next, 10);
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

    if (current === "--threshold-operator" && next) {
      thresholdOperator = parseThresholdOperator(next);
      index += 1;
      continue;
    }

    if (current === "--threshold-inclusive") {
      thresholdOperator = generated.DataOperator.GreaterThanOrEqualTo;
      continue;
    }

    if (current === "--source-token-account" && next) {
      sourceLiquidity = new PublicKey(next);
      index += 1;
      continue;
    }

    if (current === "--pin-fee-token-account" && next) {
      feeLiquidity = new PublicKey(next);
      index += 1;
      continue;
    }

    if (current === "--vault-collateral-token-account" && next) {
      vaultCollateralTokenAccount = new PublicKey(next);
      index += 1;
      continue;
    }

    if (current === "--max-routed-usdc-per-period" && next) {
      maxRoutedPerPeriod = parseUiAmountToAtomic(next, USDC_DECIMALS);
      index += 1;
      continue;
    }

    if (current === "--spending-limit-period" && next) {
      spendingLimitPeriod = parsePeriodV2(next);
      index += 1;
      continue;
    }

    if (current === "--memo" && next) {
      memo = next;
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

    if (current === "--approve") {
      approve = true;
      continue;
    }

    if (current === "--execute") {
      execute = true;
      approve = true;
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

  if (!settingsPda && !userAddress) {
    throw new Error("Provide --settings-pda or --user.");
  }

  if (
    !Number.isInteger(accountIndex) ||
    accountIndex < 0 ||
    accountIndex > 255
  ) {
    throw new Error("--vault-index must fit in u8.");
  }

  if (
    policySeed !== null &&
    (!Number.isInteger(policySeed) || policySeed <= 0)
  ) {
    throw new Error("--policy-seed must be a positive integer.");
  }

  if (minimumDepositAmount <= 0n) {
    throw new Error("--minimum-deposit-usdc must be greater than zero.");
  }

  return {
    settingsPda,
    userAddress,
    signerKeypairPath: requireArg("--keypair", signerKeypairPath),
    feePayerKeypairPath,
    accountIndex,
    policySeed,
    solanaEnv,
    rpcUrl,
    smartAccountProgramId,
    sourceLiquidity,
    feeLiquidity,
    vaultCollateralTokenAccount,
    keepLiquidityAmount,
    minimumDepositAmount,
    thresholdOperator,
    maxRoutedPerPeriod,
    spendingLimitPeriod,
    configOverrides: {
      ...configOverrides,
      smartAccountProgramId,
    },
    approve,
    execute,
    memo,
  };
}

async function resolveSettingsPdaFromUser(args: {
  connection: Connection;
  programId: PublicKey;
  userAddress: PublicKey;
}): Promise<PublicKey> {
  const accounts = await args.connection.getProgramAccounts(args.programId, {
    commitment: "confirmed",
    filters: [
      {
        memcmp: {
          offset: 0,
          bytes: bs58.encode(Buffer.from(settingsDiscriminator)),
        },
      },
    ],
  });
  const matches: Array<{ address: PublicKey; settings: Settings }> = [];

  for (const account of accounts) {
    const [settings] = Settings.fromAccountInfo(account.account);

    if (
      settings.signers.some((signer) => signer.key.equals(args.userAddress))
    ) {
      matches.push({
        address: account.pubkey,
        settings,
      });
    }
  }

  if (matches.length === 0) {
    throw new Error(
      `No smart-account Settings account found for user ${args.userAddress.toBase58()}.`
    );
  }

  if (matches.length > 1) {
    throw new Error(
      `Found multiple Settings accounts for user ${args.userAddress.toBase58()}: ` +
        matches.map((match) => match.address.toBase58()).join(", ") +
        ". Re-run with --settings-pda."
    );
  }

  return matches[0].address;
}

function pubkeyConstraint(args: {
  accountIndex: number;
  pubkey: PublicKey;
  owner?: PublicKey | null;
}): generated.AccountConstraint {
  return {
    accountIndex: args.accountIndex,
    owner: args.owner ?? null,
    accountConstraint: {
      __kind: "Pubkey",
      fields: [[args.pubkey]],
    },
  };
}

function accountDataConstraint(args: {
  accountIndex: number;
  owner?: PublicKey | null;
  constraints: generated.DataConstraint[];
}): generated.AccountConstraint {
  return {
    accountIndex: args.accountIndex,
    owner: args.owner ?? null,
    accountConstraint: {
      __kind: "AccountData",
      fields: [args.constraints],
    },
  };
}

function equalsPubkeyData(
  offset: bigint,
  pubkey: PublicKey
): generated.DataConstraint {
  return {
    dataOffset: offset,
    dataValue: {
      __kind: "U8Slice",
      fields: [pubkey.toBuffer()],
    },
    operator: generated.DataOperator.Equals,
  };
}

function buildRouterPolicyCreationPayload(args: {
  config: KaminoRouterConfig;
  accountIndex: number;
  vaultPda: PublicKey;
  sourceLiquidity: PublicKey;
  feeLiquidity: PublicKey | null;
  vaultCollateralTokenAccount: PublicKey;
  keepLiquidityAmount: bigint;
  minimumDepositAmount: bigint;
  thresholdOperator: generated.DataOperator;
  maxRoutedPerPeriod: bigint | null;
  spendingLimitPeriod: generated.PeriodV2;
}): generated.PolicyCreationPayload {
  const accountConstraints: generated.AccountConstraint[] = [
    pubkeyConstraint({ accountIndex: 1, pubkey: args.vaultPda }),
    pubkeyConstraint({ accountIndex: 2, pubkey: args.sourceLiquidity }),
    accountDataConstraint({
      accountIndex: 2,
      owner: args.config.tokenProgramId,
      constraints: [
        equalsPubkeyData(0n, args.config.usdcMint),
        equalsPubkeyData(32n, args.vaultPda),
        {
          dataOffset: 64n,
          dataValue: {
            __kind: "U64Le",
            fields: [args.keepLiquidityAmount],
          },
          operator: args.thresholdOperator,
        },
      ],
    }),
    pubkeyConstraint({
      accountIndex: 3,
      pubkey: args.config.usdcMint,
      owner: args.config.tokenProgramId,
    }),
    accountDataConstraint({
      accountIndex: 4,
      owner: args.config.tokenProgramId,
      constraints: [equalsPubkeyData(0n, args.config.usdcMint)],
    }),
    pubkeyConstraint({
      accountIndex: 5,
      pubkey: args.config.lendingMarket,
    }),
    pubkeyConstraint({
      accountIndex: 6,
      pubkey: args.config.lendingMarketAuthority,
    }),
    pubkeyConstraint({ accountIndex: 7, pubkey: args.config.reserve }),
    pubkeyConstraint({
      accountIndex: 8,
      pubkey: args.config.reserveLiquiditySupply,
    }),
    pubkeyConstraint({
      accountIndex: 9,
      pubkey: args.config.reserveCollateralMint,
      owner: args.config.tokenProgramId,
    }),
    pubkeyConstraint({
      accountIndex: 10,
      pubkey: args.vaultCollateralTokenAccount,
    }),
    pubkeyConstraint({
      accountIndex: 11,
      pubkey: args.config.instructionSysvarAccount,
    }),
    pubkeyConstraint({
      accountIndex: 12,
      pubkey: args.config.klendProgramId,
    }),
    pubkeyConstraint({
      accountIndex: 13,
      pubkey: args.config.tokenProgramId,
    }),
    pubkeyConstraint({
      accountIndex: 14,
      pubkey: args.config.associatedTokenProgramId,
    }),
    pubkeyConstraint({
      accountIndex: 15,
      pubkey: args.config.systemProgramId,
    }),
  ];

  if (args.feeLiquidity) {
    accountConstraints.push(
      pubkeyConstraint({ accountIndex: 4, pubkey: args.feeLiquidity })
    );
  }

  const spendingLimits: generated.LimitedSpendingLimit[] =
    args.maxRoutedPerPeriod === null
      ? []
      : [
          {
            mint: args.config.usdcMint,
            timeConstraints: {
              start: 0n,
              expiration: null,
              period: args.spendingLimitPeriod,
            },
            quantityConstraints: {
              maxPerPeriod: args.maxRoutedPerPeriod,
            },
          },
        ];

  return {
    __kind: "ProgramInteraction",
    fields: [
      {
        accountIndex: args.accountIndex,
        instructionsConstraints: [
          {
            programId: args.config.routerProgramId,
            accountConstraints,
            dataConstraints: [
              {
                dataOffset: 0n,
                dataValue: {
                  __kind: "U8Slice",
                  fields: [ROUTE_DEPOSIT_DISCRIMINATOR],
                },
                operator: generated.DataOperator.Equals,
              },
              {
                dataOffset: 8n,
                dataValue: {
                  __kind: "U64Le",
                  fields: [args.keepLiquidityAmount],
                },
                operator: generated.DataOperator.Equals,
              },
              {
                dataOffset: 16n,
                dataValue: {
                  __kind: "U64Le",
                  fields: [args.minimumDepositAmount],
                },
                operator: generated.DataOperator.Equals,
              },
            ],
          },
        ],
        preHook: null,
        postHook: null,
        spendingLimits,
      },
    ],
  };
}

function dedupeSigners(signers: Keypair[]) {
  const unique = new Map<string, Keypair>();
  for (const signer of signers) {
    unique.set(signer.publicKey.toBase58(), signer);
  }
  return [...unique.values()];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const settingsSigner = loadKeypair(args.signerKeypairPath);
  const feePayer = args.feePayerKeypairPath
    ? loadKeypair(args.feePayerKeypairPath)
    : settingsSigner;
  const connection = new Connection(args.rpcUrl, { commitment: "confirmed" });
  const client = createLoyalSmartAccountsClient({
    connection,
    programId: args.smartAccountProgramId,
    defaultCommitment: "confirmed",
  });
  const settingsPda =
    args.settingsPda ??
    (await resolveSettingsPdaFromUser({
      connection,
      programId: args.smartAccountProgramId,
      userAddress: args.userAddress!,
    }));
  const settings = await client.smartAccounts.queries.fetchSettings(
    settingsPda
  );

  if (
    !settings.signers.some((signer) =>
      signer.key.equals(settingsSigner.publicKey)
    )
  ) {
    throw new Error(
      `Signer ${settingsSigner.publicKey.toBase58()} is not a member of settings ${settingsPda.toBase58()}.`
    );
  }

  const config = resolveKaminoRouterConfig({
    env: args.solanaEnv,
    overrides: args.configOverrides,
  });
  const policySeed =
    args.policySeed ??
    Number(
      (settings.policySeed == null ? 0n : toBigInt(settings.policySeed)) + 1n
    );
  const transactionIndex = toBigInt(settings.transactionIndex) + 1n;
  const policyPda = getPolicyPda({
    settingsPda,
    policySeed,
    smartAccountProgramId: args.smartAccountProgramId,
  });
  const vaultPda = getVaultPda({
    settingsPda,
    accountIndex: args.accountIndex,
    smartAccountProgramId: args.smartAccountProgramId,
  });
  const crankAuthority = getCrankAuthorityPda({
    policyPda,
    routerProgramId: config.routerProgramId,
  });
  const sourceLiquidity =
    args.sourceLiquidity ??
    getVaultUsdcAta({
      vaultPda,
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
  const policyCreationPayload = buildRouterPolicyCreationPayload({
    config,
    accountIndex: args.accountIndex,
    vaultPda,
    sourceLiquidity,
    feeLiquidity: args.feeLiquidity,
    vaultCollateralTokenAccount,
    keepLiquidityAmount: args.keepLiquidityAmount,
    minimumDepositAmount: args.minimumDepositAmount,
    thresholdOperator: args.thresholdOperator,
    maxRoutedPerPeriod: args.maxRoutedPerPeriod,
    spendingLimitPeriod: args.spendingLimitPeriod,
  });
  const createSettingsTransaction =
    await client.features.smartAccounts.prepare.createSettingsTransaction({
      feePayer: feePayer.publicKey,
      rentPayer: feePayer.publicKey,
      settingsPda,
      transactionIndex,
      creator: settingsSigner.publicKey,
      actions: [
        {
          __kind: "PolicyCreate",
          seed: policySeed,
          policyCreationPayload,
          signers: [
            {
              key: crankAuthority,
              permissions: { mask: 7 },
            },
          ],
          threshold: 1,
          timeLock: 0,
          startTimestamp: null,
          expirationArgs: null,
        },
      ],
      memo: args.memo,
    } as never);
  const createProposal = await client.features.proposals.prepare.create({
    feePayer: feePayer.publicKey,
    rentPayer: feePayer.publicKey,
    settingsPda,
    transactionIndex,
    creator: settingsSigner.publicKey,
  } as never);
  const preparedCreateAndPropose = freezePreparedOperation({
    operation: "createKaminoRouterPolicyProposal",
    payer: feePayer.publicKey,
    programId: args.smartAccountProgramId,
    requiresConfirmation: true,
    instructions: [
      ...createSettingsTransaction.instructions,
      ...createProposal.instructions,
    ],
    lookupTableAccounts: [],
  });
  const signers = dedupeSigners([feePayer, settingsSigner]);
  const createSignature = await client.send(preparedCreateAndPropose, {
    signers,
    confirm: true,
  });
  const followUpSignatures: Record<string, string> = {};

  if (args.approve) {
    const approvePrepared = await client.features.proposals.prepare.approve({
      feePayer: feePayer.publicKey,
      settingsPda,
      transactionIndex,
      signer: settingsSigner.publicKey,
    } as never);
    followUpSignatures.approve = await client.send(approvePrepared, {
      signers,
      confirm: true,
    });
  }

  if (args.execute) {
    const executePrepared =
      await client.features.execution.prepare.executeSettingsTransaction({
        feePayer: feePayer.publicKey,
        rentPayer: feePayer.publicKey,
        settingsPda,
        transactionIndex,
        signer: settingsSigner.publicKey,
        policies: [policyPda],
      } as never);
    followUpSignatures.execute = await client.send(executePrepared, {
      signers,
      confirm: true,
    });
  }

  const [transactionPda] = pda.getTransactionPda({
    settingsPda,
    transactionIndex,
    programId: args.smartAccountProgramId,
  });
  const [proposalPda] = pda.getProposalPda({
    settingsPda,
    transactionIndex,
    programId: args.smartAccountProgramId,
  });

  console.log(
    JSON.stringify(
      {
        signature: createSignature,
        followUpSignatures,
        solanaEnv: args.solanaEnv,
        rpcUrl: args.rpcUrl,
        smartAccountProgramId: args.smartAccountProgramId.toBase58(),
        settingsPda: settingsPda.toBase58(),
        vaultPda: vaultPda.toBase58(),
        accountIndex: args.accountIndex,
        policySeed,
        policyPda: policyPda.toBase58(),
        crankAuthority: crankAuthority.toBase58(),
        transactionIndex: transactionIndex.toString(),
        transactionPda: transactionPda.toBase58(),
        proposalPda: proposalPda.toBase58(),
        settingsSigner: settingsSigner.publicKey.toBase58(),
        feePayer: feePayer.publicKey.toBase58(),
        routerProgramId: config.routerProgramId.toBase58(),
        usdcMint: config.usdcMint.toBase58(),
        sourceLiquidity: sourceLiquidity.toBase58(),
        feeLiquidityPinned: args.feeLiquidity?.toBase58() ?? null,
        vaultCollateralTokenAccount: vaultCollateralTokenAccount.toBase58(),
        keepLiquidityAmount: args.keepLiquidityAmount.toString(),
        minimumDepositAmount: args.minimumDepositAmount.toString(),
        thresholdOperator: dataOperatorName(args.thresholdOperator),
        maxRoutedPerPeriod: args.maxRoutedPerPeriod?.toString() ?? null,
        routeDepositDiscriminator: Buffer.from(
          ROUTE_DEPOSIT_DISCRIMINATOR
        ).toString("hex"),
        kamino: {
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
    error instanceof Error
      ? error.message
      : "Failed to create Kamino router policy."
  );
  process.exit(1);
});
