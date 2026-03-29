import {
  Connection,
  PublicKey,
  clusterApiUrl,
  type Commitment,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  KLEND_PROGRAM_ID,
  USDC_MINT,
  USDT_MINT,
  WSOL_MINT,
  estimateSupplyApy,
  estimateUnderlyingFromSharesAtSlot,
  estimateWarpSlotsForRequiredYield,
  fetchKlendReserveSnapshot,
  quoteSharesFromUnderlyingFloor,
} from "../sdk/private-transactions/index";

const USER_PUBLIC_KEY = new PublicKey(
  "4WRGdAZ8LHmbPC3CfdCR8sspKhBATs9EZ8H83RYJQ8RG"
);

const DEFAULT_COMMITMENT: Commitment = "confirmed";
const DEFAULT_MIN_WARP_SLOTS = 172_800n;
const DEFAULT_REQUIRED_YIELD = 1n;
const DEFAULT_LEDGER_ROOT = "test-ledger-kamino";

const SUPPORTED_MINTS = {
  SOL: WSOL_MINT,
  USDC: USDC_MINT,
  USDT: USDT_MINT,
} as const;

const DEFAULT_PRINCIPAL_BY_MINT: Record<keyof typeof SUPPORTED_MINTS, bigint> =
  {
    SOL: 1_000_000_000n,
    USDC: 100_000_000n,
    USDT: 100_000_000n,
  };

type MintLabel = keyof typeof SUPPORTED_MINTS;

type CliConfig = {
  mintLabel: MintLabel;
  upstreamRpcUrl: string;
  ledgerDir: string;
  principalRaw: bigint;
  requiredYieldRaw: bigint;
  minWarpSlots: bigint;
  output: "pretty" | "json";
};

function parseArgs(argv: string[]): CliConfig {
  let mintLabel = (
    process.env.PRIVATE_TRANSACTIONS_TEST_MINT ??
    process.env.KAMINO_LOCAL_TEST_MINT ??
    "SOL"
  ).toUpperCase() as MintLabel;
  let upstreamRpcUrl =
    process.env.PRIVATE_TRANSACTIONS_MAINNET_RPC_URL ??
    process.env.KAMINO_LOCAL_UPSTREAM_RPC_URL ??
    clusterApiUrl("mainnet-beta");
  const envLedgerDir = process.env.KAMINO_LOCAL_LEDGER_DIR;
  const envPrincipalRaw = readBigIntEnv("KAMINO_LOCAL_PRINCIPAL_RAW");
  let ledgerDir =
    envLedgerDir ?? `${DEFAULT_LEDGER_ROOT}-${mintLabel.toLowerCase()}`;
  let principalRaw = envPrincipalRaw ?? DEFAULT_PRINCIPAL_BY_MINT[mintLabel];
  let requiredYieldRaw =
    readBigIntEnv("KAMINO_LOCAL_REQUIRED_YIELD_RAW") ?? DEFAULT_REQUIRED_YIELD;
  let minWarpSlots =
    readBigIntEnv("KAMINO_LOCAL_MIN_WARP_SLOTS") ?? DEFAULT_MIN_WARP_SLOTS;
  let output: "pretty" | "json" =
    process.env.KAMINO_LOCAL_OUTPUT === "json" ? "json" : "pretty";
  let ledgerDirOverridden = envLedgerDir !== undefined;
  let principalOverridden = envPrincipalRaw !== null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if ((arg === "--mint" || arg === "-m") && next) {
      mintLabel = next.toUpperCase() as MintLabel;
      index += 1;
      continue;
    }
    if (arg.startsWith("--mint=")) {
      mintLabel = arg.slice("--mint=".length).toUpperCase() as MintLabel;
      continue;
    }
    if ((arg === "--upstream-rpc" || arg === "-u") && next) {
      upstreamRpcUrl = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("--upstream-rpc=")) {
      upstreamRpcUrl = arg.slice("--upstream-rpc=".length);
      continue;
    }
    if ((arg === "--ledger-dir" || arg === "-l") && next) {
      ledgerDir = next;
      ledgerDirOverridden = true;
      index += 1;
      continue;
    }
    if (arg.startsWith("--ledger-dir=")) {
      ledgerDir = arg.slice("--ledger-dir=".length);
      ledgerDirOverridden = true;
      continue;
    }
    if (arg === "--principal" && next) {
      principalRaw = BigInt(next);
      principalOverridden = true;
      index += 1;
      continue;
    }
    if (arg.startsWith("--principal=")) {
      principalRaw = BigInt(arg.slice("--principal=".length));
      principalOverridden = true;
      continue;
    }
    if (arg === "--required-yield" && next) {
      requiredYieldRaw = BigInt(next);
      index += 1;
      continue;
    }
    if (arg.startsWith("--required-yield=")) {
      requiredYieldRaw = BigInt(arg.slice("--required-yield=".length));
      continue;
    }
    if (arg === "--min-warp-slots" && next) {
      minWarpSlots = BigInt(next);
      index += 1;
      continue;
    }
    if (arg.startsWith("--min-warp-slots=")) {
      minWarpSlots = BigInt(arg.slice("--min-warp-slots=".length));
      continue;
    }
    if (arg === "--json") {
      output = "json";
    }
    if (arg === "--help" || arg === "-h") {
      printHelpAndExit();
    }
  }

  if (!SUPPORTED_MINTS[mintLabel]) {
    throw new Error(`Unsupported mint ${mintLabel}. Use SOL, USDC, or USDT.`);
  }
  if (!ledgerDirOverridden) {
    ledgerDir = `${DEFAULT_LEDGER_ROOT}-${mintLabel.toLowerCase()}`;
  }
  if (!principalOverridden) {
    principalRaw = DEFAULT_PRINCIPAL_BY_MINT[mintLabel];
  }

  return {
    mintLabel,
    upstreamRpcUrl,
    ledgerDir,
    principalRaw,
    requiredYieldRaw,
    minWarpSlots,
    output,
  };
}

function readBigIntEnv(name: string): bigint | null {
  const raw = process.env[name];
  return raw ? BigInt(raw) : null;
}

function printHelpAndExit(): never {
  console.log(`Usage: bun scripts/kamino-local-validator.ts [options]

Options:
  --mint <SOL|USDC|USDT>       Selected Kamino-backed mint
  --upstream-rpc <url>         Upstream mainnet RPC for account cloning
  --ledger-dir <path>          Local ledger directory
  --principal <raw>            Shield principal in raw token units
  --required-yield <raw>       Minimum extra raw units expected on unshield
  --min-warp-slots <slots>     Lower bound for slot warp search
  --json                       Emit JSON instead of readable text
  -h, --help                   Show help

Env:
  PRIVATE_TRANSACTIONS_TEST_MINT
  PRIVATE_TRANSACTIONS_MAINNET_RPC_URL
  KAMINO_LOCAL_LEDGER_DIR
  KAMINO_LOCAL_PRINCIPAL_RAW
  KAMINO_LOCAL_REQUIRED_YIELD_RAW
  KAMINO_LOCAL_MIN_WARP_SLOTS
`);
  process.exit(0);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  const tokenMint = SUPPORTED_MINTS[config.mintLabel];
  const connection = new Connection(config.upstreamRpcUrl, {
    commitment: DEFAULT_COMMITMENT,
  });
  const snapshot = await fetchKlendReserveSnapshot(connection, tokenMint);

  if (snapshot.borrowedAmountSf === 0n) {
    throw new Error(
      `${config.mintLabel} reserve has zero borrowed amount on the selected upstream RPC snapshot; APY test will not accrue yield.`
    );
  }

  const shareAmount = quoteSharesFromUnderlyingFloor(
    config.principalRaw,
    snapshot
  );
  if (shareAmount === 0n) {
    throw new Error(
      `${
        config.mintLabel
      } principal ${config.principalRaw.toString()} is too small to mint any KLend shares.`
    );
  }

  const estimatedSupplyApy = estimateSupplyApy(snapshot);
  const warpSlots = estimateWarpSlotsForRequiredYield(
    snapshot,
    shareAmount,
    config.requiredYieldRaw,
    config.minWarpSlots
  );
  const warpToSlot = snapshot.currentSlot + warpSlots;
  const projectedUnderlying = estimateUnderlyingFromSharesAtSlot(
    shareAmount,
    snapshot,
    warpToSlot
  );
  const projectedYield = projectedUnderlying - config.principalRaw;

  const userSourceTokenAta = tokenMint.equals(WSOL_MINT)
    ? null
    : getAssociatedTokenAddressSync(tokenMint, USER_PUBLIC_KEY);

  const cloneArgs = [
    "--clone-upgradeable-program",
    KLEND_PROGRAM_ID.toBase58(),
    "--clone",
    snapshot.lendingMarket.toBase58(),
    "--clone",
    snapshot.reserve.toBase58(),
    "--clone",
    tokenMint.toBase58(),
    "--clone",
    snapshot.reserveLiquiditySupply.toBase58(),
    "--clone",
    snapshot.reserveCollateralMint.toBase58(),
  ];
  if (userSourceTokenAta) {
    cloneArgs.push("--maybe-clone", userSourceTokenAta.toBase58());
  }

  const baseValidatorCommand = [
    "solana-test-validator",
    "--reset",
    "--ledger",
    config.ledgerDir,
    "--url",
    config.upstreamRpcUrl,
    ...cloneArgs,
  ];
  const warpRestartCommand = [
    "solana-test-validator",
    "--ledger",
    config.ledgerDir,
    "--url",
    config.upstreamRpcUrl,
    "--warp-slot",
    warpToSlot.toString(),
  ];

  const report = {
    mintLabel: config.mintLabel,
    tokenMint: tokenMint.toBase58(),
    user: USER_PUBLIC_KEY.toBase58(),
    upstreamRpcUrl: config.upstreamRpcUrl,
    ledgerDir: config.ledgerDir,
    principalRaw: config.principalRaw.toString(),
    requiredYieldRaw: config.requiredYieldRaw.toString(),
    reserve: snapshot.reserve.toBase58(),
    lendingMarket: snapshot.lendingMarket.toBase58(),
    reserveLiquiditySupply: snapshot.reserveLiquiditySupply.toBase58(),
    reserveCollateralMint: snapshot.reserveCollateralMint.toBase58(),
    userSourceTokenAta: userSourceTokenAta?.toBase58() ?? null,
    currentSlot: snapshot.currentSlot.toString(),
    lastUpdateSlot: snapshot.lastUpdateSlot.toString(),
    shareAmount: shareAmount.toString(),
    estimatedSupplyApy,
    warpSlots: warpSlots.toString(),
    warpToSlot: warpToSlot.toString(),
    projectedUnderlying: projectedUnderlying.toString(),
    projectedYield: projectedYield.toString(),
    baseValidatorCommand,
    warpRestartCommand,
    phaseCommands: {
      shield: [
        "PRIVATE_TRANSACTIONS_LOCAL_KAMINO=true",
        "PRIVATE_TRANSACTIONS_LOCAL_KAMINO_PHASE=shield",
        `PRIVATE_TRANSACTIONS_TEST_MINT=${config.mintLabel}`,
        "bun test sdk/private-transactions/tests/private-transactions-kamino-local.test.ts --timeout 120000",
      ].join(" "),
      unshield: [
        "PRIVATE_TRANSACTIONS_LOCAL_KAMINO=true",
        "PRIVATE_TRANSACTIONS_LOCAL_KAMINO_PHASE=unshield",
        `PRIVATE_TRANSACTIONS_TEST_MINT=${config.mintLabel}`,
        `KAMINO_LOCAL_WARP_TO_SLOT=${warpToSlot.toString()}`,
        "bun test sdk/private-transactions/tests/private-transactions-kamino-local.test.ts --timeout 120000",
      ].join(" "),
    },
  };

  if (config.output === "json") {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`Mint: ${report.mintLabel} (${report.tokenMint})`);
  console.log(`User: ${report.user}`);
  console.log(`Reserve: ${report.reserve}`);
  console.log(`Lending market: ${report.lendingMarket}`);
  console.log(`Reserve liquidity supply: ${report.reserveLiquiditySupply}`);
  console.log(`Reserve collateral mint: ${report.reserveCollateralMint}`);
  console.log(`Principal: ${report.principalRaw}`);
  console.log(`Share amount (floor): ${report.shareAmount}`);
  console.log(`Current slot: ${report.currentSlot}`);
  console.log(`Estimated supply APY: ${report.estimatedSupplyApy}`);
  console.log(`Recommended warp slots: ${report.warpSlots}`);
  console.log(`Warp target slot: ${report.warpToSlot}`);
  console.log(`Projected underlying after warp: ${report.projectedUnderlying}`);
  console.log(`Projected yield after warp: ${report.projectedYield}`);
  console.log("");
  console.log(
    `Base validator: ${baseValidatorCommand.map(shellQuote).join(" ")}`
  );
  console.log(`Warp restart: ${warpRestartCommand.map(shellQuote).join(" ")}`);
  console.log("");
  console.log(`Shield test: ${report.phaseCommands.shield}`);
  console.log(`Unshield test: ${report.phaseCommands.unshield}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
