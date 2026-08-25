import {
  codecs,
  createLoyalSmartAccountsClient,
  type PreparedLoyalSmartAccountsOperation,
} from "@loyal-labs/loyal-smart-accounts";
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  TransactionInstruction,
  type Connection,
} from "@solana/web3.js";

import { clusterConfigFor } from "./cluster.ts";
import {
  createProgramInteractionPolicyInstruction,
} from "./internal/squads.ts";
import { LoyalCluster } from "./types.ts";

const SMART_ACCOUNT_SEED = new TextEncoder().encode("smart_account");
const FARM_USER_SEED = new TextEncoder().encode("user");

export const EARN_MAX_MANIFEST_VERSION = "earn-max-v2";
export const EARN_MAX_VAULT_INDEX = 0;

const KLEND = new PublicKey("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
const FARMS = new PublicKey("FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr");
const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const ASSOCIATED_TOKEN = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);
const MEMO = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
export const USDC_MINT = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);
export const PYUSD_MINT = new PublicKey(
  "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo"
);
export const USDS_MINT = new PublicKey(
  "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA"
);
const USER_METADATA_SEED = new TextEncoder().encode("user_meta");
const INIT_USER_METADATA = [117, 169, 176, 69, 197, 23, 15, 162] as const;
const INIT_OBLIGATION = [251, 10, 231, 76, 27, 11, 159, 96] as const;
const INIT_OBLIGATION_FARM = [136, 63, 15, 186, 211, 152, 168, 164] as const;
const SETUP_RENT_BUFFER_LAMPORTS = 39_532_800;

const DEPOSIT = [216, 224, 191, 27, 204, 151, 102, 175] as const;
const BORROW = [161, 128, 143, 245, 171, 199, 194, 6] as const;
const REPAY = [116, 174, 213, 76, 180, 53, 210, 144] as const;
const WITHDRAW = [235, 52, 119, 152, 149, 197, 20, 7] as const;
const SHARED_ACCOUNTS_ROUTE = [193, 32, 155, 51, 65, 214, 156, 129] as const;

export type EarnMaxStrategyKey =
  | "onyc_usdc"
  | "onyc_usds"
  | "prime_usdc"
  | "prime_pyusd"
  | "prime_usds"
  | "syrup_usdc_usdc"
  | "syrup_usdc_pyusd";

type EarnMaxStrategyTemplate = {
  key: EarnMaxStrategyKey;
  label: string;
  market: string;
  marketAuthority: string;
  collateralReserve: string;
  collateralMint: string;
  debtReserve: string;
  debtMint: string;
  debtTokenProgram: "token" | "token2022";
  debtFarm?: string;
  targetLtvBps: number;
};

const STRATEGY_TEMPLATES: readonly EarnMaxStrategyTemplate[] = [
  {
    key: "onyc_usdc", label: "ONyc / USDC",
    market: "47tfyEG9SsdEnUm9cw5kY9BXngQGqu3LBoop9j5uTAv8", marketAuthority: "FsvTiXTUFDc4aLbrov4PrvDTjXCWCniL1dxTUkZ1T2ss",
    collateralReserve: "6ZxkBSJEqsXA3Kdm2PDAzHLUdPTPUK93Lf4bAezec1UQ", collateralMint: "5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5",
    debtReserve: "AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z", debtMint: USDC_MINT.toBase58(), debtTokenProgram: "token",
    debtFarm: "7vNfe1qX8iDxP5p3A4fosrjLqdn1YjmmGcZZkG2b4APF", targetLtvBps: 5_000,
  },
  {
    key: "onyc_usds", label: "ONyc / USDS",
    market: "47tfyEG9SsdEnUm9cw5kY9BXngQGqu3LBoop9j5uTAv8", marketAuthority: "FsvTiXTUFDc4aLbrov4PrvDTjXCWCniL1dxTUkZ1T2ss",
    collateralReserve: "6ZxkBSJEqsXA3Kdm2PDAzHLUdPTPUK93Lf4bAezec1UQ", collateralMint: "5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5",
    debtReserve: "3yDc9ARvtPLhYxZLgucZGuBtZ9bHshBvXTwHxGe3nhmC", debtMint: USDS_MINT.toBase58(), debtTokenProgram: "token",
    debtFarm: "5piFMvvPonJM8zJbCGoPD2jZt59hNURDLDTpXQzgbydc", targetLtvBps: 5_000,
  },
  {
    key: "prime_usdc", label: "PRIME / USDC",
    market: "CqAoLuqWtavaVE8deBjMKe8ZfSt9ghR6Vb8nfsyabyHA", marketAuthority: "9SLBVnPz8dRGvafST6zNBZYSSt3HtdU68XQLGR13t3uM",
    collateralReserve: "BUTND9T7Ux4KR8RAEgd4WoZwnP7xA279oA1y3iPVcvSh", collateralMint: "3b8X44fLF9ooXaUm3hhSgjpmVs6rZZ3pPoGnGahc3Uu7",
    debtReserve: "9GJ9GBRwCp4pHmWrQ43L5xpc9Vykg7jnfwcFGN8FoHYu", debtMint: USDC_MINT.toBase58(), debtTokenProgram: "token",
    targetLtvBps: 6_500,
  },
  {
    key: "prime_pyusd", label: "PRIME / PYUSD",
    market: "CqAoLuqWtavaVE8deBjMKe8ZfSt9ghR6Vb8nfsyabyHA", marketAuthority: "9SLBVnPz8dRGvafST6zNBZYSSt3HtdU68XQLGR13t3uM",
    collateralReserve: "BUTND9T7Ux4KR8RAEgd4WoZwnP7xA279oA1y3iPVcvSh", collateralMint: "3b8X44fLF9ooXaUm3hhSgjpmVs6rZZ3pPoGnGahc3Uu7",
    debtReserve: "3ZUAwhEtK8XWfK4fy98z4yoptm4GeyeAu21L11HPXaZ5", debtMint: PYUSD_MINT.toBase58(), debtTokenProgram: "token2022",
    targetLtvBps: 6_500,
  },
  {
    key: "prime_usds", label: "PRIME / USDS",
    market: "CqAoLuqWtavaVE8deBjMKe8ZfSt9ghR6Vb8nfsyabyHA", marketAuthority: "9SLBVnPz8dRGvafST6zNBZYSSt3HtdU68XQLGR13t3uM",
    collateralReserve: "BUTND9T7Ux4KR8RAEgd4WoZwnP7xA279oA1y3iPVcvSh", collateralMint: "3b8X44fLF9ooXaUm3hhSgjpmVs6rZZ3pPoGnGahc3Uu7",
    debtReserve: "7SzMWArC8WAenndXFmRyfvcvrNPodqUFkmPrmmoRZvn4", debtMint: USDS_MINT.toBase58(), debtTokenProgram: "token",
    targetLtvBps: 6_500,
  },
  {
    key: "syrup_usdc_usdc", label: "syrupUSDC / USDC",
    market: "6WEGfej9B9wjxRs6t4BYpb9iCXd8CpTpJ8fVSNzHCC5y", marketAuthority: "6QbtpY2jDNcncRFmVf343NThnCdaY8gCAsYATPnYQR9g",
    collateralReserve: "AwCyCPZYJSZ93xcVKNK7jR8e1BHzJXq1D4bReNuh9woY", collateralMint: "AvZZF1YaZDziPY2RCK4oJrRVrbN3mTD9NL24hPeaZeUj",
    debtReserve: "Atj6UREVWa7WxbF2EMKNyfmYUY1U1txughe2gjhcPDCo", debtMint: USDC_MINT.toBase58(), debtTokenProgram: "token",
    debtFarm: "87gUNr8LwYJCT25HjPEHnrfBBjwEMAjfqCfnKcJNqy9Y", targetLtvBps: 6_500,
  },
  {
    key: "syrup_usdc_pyusd", label: "syrupUSDC / PYUSD",
    market: "6WEGfej9B9wjxRs6t4BYpb9iCXd8CpTpJ8fVSNzHCC5y", marketAuthority: "6QbtpY2jDNcncRFmVf343NThnCdaY8gCAsYATPnYQR9g",
    collateralReserve: "AwCyCPZYJSZ93xcVKNK7jR8e1BHzJXq1D4bReNuh9woY", collateralMint: "AvZZF1YaZDziPY2RCK4oJrRVrbN3mTD9NL24hPeaZeUj",
    debtReserve: "92qeAka3ZzCGPfJriDXrE7tiNqfATVCAM6ZjjctR3TrS", debtMint: PYUSD_MINT.toBase58(), debtTokenProgram: "token2022",
    debtFarm: "9AUA7XZ1rynUsZcmVCgj8UFdQuDozFSMpaNGBZAtiPWj", targetLtvBps: 6_500,
  },
] as const;

export type EarnMaxStrategyTopology = {
  key: EarnMaxStrategyKey;
  label: string;
  market: PublicKey;
  marketAuthority: PublicKey;
  collateralReserve: PublicKey;
  collateralMint: PublicKey;
  collateralCustody: PublicKey;
  debtReserve: PublicKey;
  debtMint: PublicKey;
  debtTokenProgram: PublicKey;
  debtCustody: PublicKey;
  debtFarm?: PublicKey;
  debtFarmUser?: PublicKey;
  obligation: PublicKey;
  targetLtvBps: number;
};

export type EarnMaxTopology = {
  vault: PublicKey;
  claimCustody: PublicKey;
  collateralCustody: PublicKey;
  obligation: PublicKey;
  debtFarmUser: PublicKey;
  pyusdCustody: PublicKey;
  pyusdObligation: PublicKey;
  pyusdDebtFarmUser: PublicKey;
  market: PublicKey;
  collateralReserve: PublicKey;
  debtReserve: PublicKey;
  collateralMint: PublicKey;
  claimMint: PublicKey;
  debtFarm: PublicKey;
  pyusdDebtFarm: PublicKey;
  strategies: readonly EarnMaxStrategyTopology[];
};

export type EarnMaxPolicyPreparation = {
  family: "collateral" | "debt" | "swap";
  seed: bigint;
  policy: PublicKey;
  instruction: TransactionInstruction;
};

function associatedToken(
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram = TOKEN
): PublicKey {
  const config = clusterConfigFor(LoyalCluster.MainnetBeta);
  return PublicKey.findProgramAddressSync(
    [owner.toBytes(), tokenProgram.toBytes(), mint.toBytes()],
    config.associatedTokenProgramId
  )[0];
}

export function deriveEarnMaxTopology(settings: PublicKey): EarnMaxTopology {
  const config = clusterConfigFor(LoyalCluster.MainnetBeta);
  const vault = PublicKey.findProgramAddressSync(
    [
      SMART_ACCOUNT_SEED,
      settings.toBytes(),
      SMART_ACCOUNT_SEED,
      Uint8Array.of(EARN_MAX_VAULT_INDEX),
    ],
    config.squadsSmartAccountProgramId
  )[0];
  const strategies = STRATEGY_TEMPLATES.map((template): EarnMaxStrategyTopology => {
    const market = new PublicKey(template.market);
    const collateralMint = new PublicKey(template.collateralMint);
    const debtMint = new PublicKey(template.debtMint);
    const debtTokenProgram = template.debtTokenProgram === "token" ? TOKEN : TOKEN_2022;
    const obligation = PublicKey.findProgramAddressSync([
      Uint8Array.of(1), Uint8Array.of(0), vault.toBytes(), market.toBytes(), collateralMint.toBytes(), debtMint.toBytes(),
    ], KLEND)[0];
    const debtFarm = template.debtFarm ? new PublicKey(template.debtFarm) : undefined;
    return {
      key: template.key, label: template.label, market,
      marketAuthority: new PublicKey(template.marketAuthority),
      collateralReserve: new PublicKey(template.collateralReserve), collateralMint,
      collateralCustody: associatedToken(vault, collateralMint),
      debtReserve: new PublicKey(template.debtReserve), debtMint, debtTokenProgram,
      debtCustody: associatedToken(vault, debtMint, debtTokenProgram), debtFarm,
      debtFarmUser: debtFarm ? PublicKey.findProgramAddressSync([FARM_USER_SEED, debtFarm.toBytes(), obligation.toBytes()], FARMS)[0] : undefined,
      obligation, targetLtvBps: template.targetLtvBps,
    };
  });
  const syrupUsdc = strategies.find(({ key }) => key === "syrup_usdc_usdc")!;
  const syrupPyusd = strategies.find(({ key }) => key === "syrup_usdc_pyusd")!;
  return {
    vault,
    claimCustody: associatedToken(vault, USDC_MINT),
    collateralCustody: syrupUsdc.collateralCustody,
    obligation: syrupUsdc.obligation,
    debtFarmUser: syrupUsdc.debtFarmUser!,
    pyusdCustody: syrupPyusd.debtCustody,
    pyusdObligation: syrupPyusd.obligation,
    pyusdDebtFarmUser: syrupPyusd.debtFarmUser!,
    market: syrupUsdc.market,
    collateralReserve: syrupUsdc.collateralReserve,
    debtReserve: syrupUsdc.debtReserve,
    collateralMint: syrupUsdc.collateralMint,
    claimMint: USDC_MINT,
    debtFarm: syrupUsdc.debtFarm!,
    pyusdDebtFarm: syrupPyusd.debtFarm!,
    strategies,
  };
}

function sliceEquals(value: readonly number[]) {
  return {
    dataOffset: BigInt(0),
    dataValue: { type: "u8Slice" as const, value },
    operator: "equals" as const,
  };
}

function u16Equals(value: number) {
  return {
    dataOffset: BigInt(0),
    dataValue: { type: "u16Le" as const, value },
    operator: "equals" as const,
  };
}

function pubkey(accountIndex: number, ...pubkeys: PublicKey[]) {
  return { accountIndex, kind: { type: "pubkey" as const, pubkeys } };
}

function accountDataPubkey(
  accountIndex: number,
  owner: PublicKey,
  dataOffset: bigint,
  value: PublicKey
) {
  return {
    accountIndex,
    kind: {
      type: "accountData" as const,
      dataConstraints: [
        {
          dataOffset,
          dataValue: {
            type: "u8Slice" as const,
            value: [...value.toBytes()],
          },
          operator: "equals" as const,
        },
      ],
    },
    owner,
  };
}

function uniquePubkeys(pubkeys: readonly PublicKey[]): PublicKey[] {
  return [...new Map(pubkeys.map((value) => [value.toBase58(), value])).values()];
}

export function createEarnMaxPolicyManifest(input: {
  authority: PublicKey;
  delegatedSigner: PublicKey;
  firstPolicySeed: bigint;
  settings: PublicKey;
}): readonly EarnMaxPolicyPreparation[] {
  const config = clusterConfigFor(LoyalCluster.MainnetBeta);
  const topology = deriveEarnMaxTopology(input.settings);
  const policy = (
    family: EarnMaxPolicyPreparation["family"],
    seed: bigint,
    constraints: Parameters<typeof createProgramInteractionPolicyInstruction>[2]
  ): EarnMaxPolicyPreparation => {
    const instruction = createProgramInteractionPolicyInstruction(
      config,
      {
        settings: input.settings,
        authority: input.authority,
        delegatedSigner: input.delegatedSigner,
        accountIndex: EARN_MAX_VAULT_INDEX,
        vault: topology.vault,
      },
      constraints,
      seed,
      [],
      "legacy"
    );
    const policy = instruction.keys[5]!.pubkey;
    return {
      family,
      seed,
      policy,
      instruction,
    };
  };

  const swapBiclique = (
    sources: readonly PublicKey[],
    destinations: readonly PublicKey[]
  ) => ({
    programId: config.jupiterV6ProgramId,
    accountConstraints: [
      pubkey(2, topology.vault),
      pubkey(3, ...sources),
      pubkey(6, ...destinations),
    ],
    dataConstraints: [
      u16Equals(
        SHARED_ACCOUNTS_ROUTE[0] | (SHARED_ACCOUNTS_ROUTE[1] << 8)
      ),
    ],
  });

  const markets = uniquePubkeys(topology.strategies.map(({ market }) => market));
  const collateralReserves = uniquePubkeys(topology.strategies.map(({ collateralReserve }) => collateralReserve));
  const collateralCustodies = uniquePubkeys(topology.strategies.map(({ collateralCustody }) => collateralCustody));
  const debtCustodies = uniquePubkeys(topology.strategies.map(({ debtCustody }) => debtCustody));
  const obligationOwnedByVault = accountDataPubkey(
    1,
    KLEND,
    BigInt(64),
    topology.vault
  );

  const collateralConstraints = [
    {
      programId: KLEND,
      accountConstraints: [
        pubkey(0, topology.vault),
        obligationOwnedByVault,
        pubkey(4, ...collateralReserves),
        pubkey(9, ...collateralCustodies),
      ],
      dataConstraints: [sliceEquals(DEPOSIT)],
    },
    {
      programId: KLEND,
      accountConstraints: [
        pubkey(0, topology.vault),
        obligationOwnedByVault,
        pubkey(4, ...collateralReserves),
        pubkey(9, ...collateralCustodies),
      ],
      dataConstraints: [sliceEquals(WITHDRAW)],
    },
  ] as const;
  const debtConstraints = [
    {
      programId: KLEND,
      accountConstraints: [
        pubkey(0, topology.vault),
        obligationOwnedByVault,
        pubkey(2, ...markets),
        pubkey(8, ...debtCustodies),
      ],
      dataConstraints: [sliceEquals(BORROW)],
    },
    {
      programId: KLEND,
      accountConstraints: [
        pubkey(0, topology.vault),
        obligationOwnedByVault,
        pubkey(2, ...markets),
        pubkey(6, ...debtCustodies),
      ],
      dataConstraints: [sliceEquals(REPAY)],
    },
  ] as const;
  const strategy = (key: EarnMaxStrategyKey) =>
    topology.strategies.find((candidate) => candidate.key === key)!;
  const usdc = strategy("onyc_usdc").debtCustody;
  const usds = strategy("onyc_usds").debtCustody;
  const pyusd = strategy("prime_pyusd").debtCustody;
  const onyc = strategy("onyc_usdc").collateralCustody;
  const prime = strategy("prime_usdc").collateralCustody;
  const syrup = strategy("syrup_usdc_usdc").collateralCustody;
  const swapConstraints = [
    swapBiclique([usdc, usds], [onyc, prime]),
    swapBiclique([usdc, pyusd], [prime, syrup]),
    swapBiclique([onyc, prime], [usdc, usds]),
    swapBiclique([prime, syrup], [usdc, pyusd]),
  ];

  return [
    policy("collateral", input.firstPolicySeed, collateralConstraints),
    policy("debt", input.firstPolicySeed + BigInt(1), debtConstraints),
    policy("swap", input.firstPolicySeed + BigInt(2), swapConstraints),
  ];
}

export type EarnMaxClientOperation =
  PreparedLoyalSmartAccountsOperation<string>;

async function resolveEarnMaxInstallSeedBase(input: {
  connection: Connection;
  delegatedSigner: PublicKey;
  feePayer: PublicKey;
  firstPolicySeed?: bigint;
  programId: PublicKey;
  settings: PublicKey;
}): Promise<bigint> {
  const currentPolicySeed = BigInt(
    (
      await createLoyalSmartAccountsClient({
        connection: input.connection,
        programId: input.programId,
      }).smartAccounts.queries.fetchSettings(input.settings)
    ).policySeed?.toString() ?? "0"
  );
  if (input.firstPolicySeed === undefined) return currentPolicySeed + BigInt(1);

  const requestedPolicySeed = input.firstPolicySeed;
  const requestedManifest = createEarnMaxPolicyManifest({
    authority: input.feePayer,
    delegatedSigner: input.delegatedSigner,
    firstPolicySeed: requestedPolicySeed,
    settings: input.settings,
  });
  const requestedAccounts = await input.connection.getMultipleAccountsInfo(
    requestedManifest.map((entry) => entry.policy),
    "confirmed"
  );
  const existingCount = requestedAccounts.filter(Boolean).length;
  const requestedLastSeed =
    requestedPolicySeed + BigInt(requestedManifest.length - 1);

  if (existingCount === 0 && currentPolicySeed >= requestedLastSeed) {
    return currentPolicySeed + BigInt(1);
  }
  if (
    existingCount > 0 &&
    existingCount < requestedManifest.length &&
    currentPolicySeed > requestedLastSeed
  ) {
    throw new Error(
      "Earn MAX policy manifest is partially missing after the Settings policy seed advanced."
    );
  }
  return requestedPolicySeed;
}

function prepared(
  input: Omit<
    EarnMaxClientOperation,
    "lookupTableAccounts" | "requiresConfirmation"
  >,
  lookupTableAccounts: readonly AddressLookupTableAccount[] = []
): EarnMaxClientOperation {
  return { ...input, lookupTableAccounts, requiresConfirmation: true };
}

function createAssociatedTokenAccount(
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram = TOKEN
): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      {
        pubkey: associatedToken(owner, mint, tokenProgram),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

function transferChecked(input: {
  amountRaw: bigint;
  destination: PublicKey;
  mint: PublicKey;
  owner: PublicKey;
  source: PublicKey;
}): TransactionInstruction {
  if (
    input.amountRaw <= BigInt(0) ||
    input.amountRaw > BigInt("18446744073709551615")
  ) {
    throw new Error("Earn MAX token amount must fit in u64 and be positive.");
  }
  const amount = Buffer.alloc(8);
  amount.writeBigUInt64LE(input.amountRaw);
  return new TransactionInstruction({
    programId: TOKEN,
    keys: [
      { pubkey: input.source, isSigner: false, isWritable: true },
      { pubkey: input.mint, isSigner: false, isWritable: false },
      { pubkey: input.destination, isSigner: false, isWritable: true },
      { pubkey: input.owner, isSigner: true, isWritable: true },
    ],
    data: Buffer.concat([Buffer.from([12]), amount, Buffer.from([6])]),
  });
}

async function buildVaultExecution(input: {
  connection: Connection;
  feePayer: PublicKey;
  inner: TransactionInstruction[];
  programId: PublicKey;
  settings: PublicKey;
  vault: PublicKey;
  operation: string;
}): Promise<EarnMaxClientOperation> {
  const compiled = codecs.compileToSynchronousMessageAndAccountsV2({
    vaultPda: input.vault,
    members: [input.feePayer],
    instructions: input.inner,
  });
  const operation = await createLoyalSmartAccountsClient({
    connection: input.connection,
    programId: input.programId,
  }).features.execution.prepare.executeTransactionSyncV2({
    feePayer: input.feePayer,
    settingsPda: input.settings,
    accountIndex: EARN_MAX_VAULT_INDEX,
    numSigners: 1,
    instructions: compiled.instructions,
    instruction_accounts: compiled.accounts,
  } as never);
  return { ...operation, operation: input.operation };
}

export async function buildEarnMaxInstallInstructions(input: {
  connection: Connection;
  delegatedSigner: PublicKey;
  feePayer: PublicKey;
  firstPolicySeed?: bigint;
  programId: PublicKey;
  settings: PublicKey;
  matchingPolicyAccounts?: ReadonlySet<string>;
}): Promise<EarnMaxClientOperation[]> {
  const firstPolicySeed = await resolveEarnMaxInstallSeedBase(input);
  const manifest = createEarnMaxPolicyManifest({
    authority: input.feePayer,
    delegatedSigner: input.delegatedSigner,
    firstPolicySeed,
    settings: input.settings,
  });
  const accounts = await input.connection.getMultipleAccountsInfo(
    manifest.map((entry) => entry.policy),
    "confirmed"
  );
  const matching = input.matchingPolicyAccounts ?? new Set<string>();
  const missing = manifest.filter((entry, index) => {
    const exists = Boolean(accounts[index]);
    const matches = matching.has(entry.policy.toBase58());
    if (exists && !matches) {
      throw new Error(
        `Earn MAX ${entry.family} policy exists with non-canonical bytes; close it before reinstalling.`
      );
    }
    return !exists;
  });
  if (missing.length === 0) return [];

  const operations: EarnMaxClientOperation[] = [];
  const swap = missing.find((entry) => entry.family === "swap");
  let swapLookupTable: AddressLookupTableAccount | undefined;
  if (swap) {
    const confirmedSlot = await input.connection.getSlot("confirmed");
    if (confirmedSlot < 1) throw new Error("Solana confirmed slot is invalid.");
    const recentSlot = confirmedSlot - 1;
    const [createLookupTable, lookupTableAddress] =
      AddressLookupTableProgram.createLookupTable({
        authority: input.feePayer,
        payer: input.feePayer,
        recentSlot,
      });
    const addresses = uniquePubkeys([
      swap.instruction.programId,
      ...swap.instruction.keys
        .filter(({ isSigner }) => !isSigner)
        .map(({ pubkey }) => pubkey),
    ]);
    const extendLookupTable = AddressLookupTableProgram.extendLookupTable({
      authority: input.feePayer,
      lookupTable: lookupTableAddress,
      payer: input.feePayer,
      addresses,
    });
    swapLookupTable = new AddressLookupTableAccount({
      key: lookupTableAddress,
      state: {
        authority: input.feePayer,
        addresses,
        deactivationSlot: BigInt("18446744073709551615"),
        lastExtendedSlot: recentSlot,
        lastExtendedSlotStartIndex: 0,
      },
    });
    operations.push(
      prepared({
        instructions: [createLookupTable],
        operation: "earnMaxInstall:createLookupTable",
        payer: input.feePayer,
        programId: AddressLookupTableProgram.programId,
      }),
      prepared({
        instructions: [extendLookupTable],
        operation: "earnMaxInstall:extendLookupTable",
        payer: input.feePayer,
        programId: AddressLookupTableProgram.programId,
      })
    );
  }

  for (const entry of missing) {
    operations.push(
      prepared(
        {
          instructions: [entry.instruction],
          operation: `earnMaxInstall:create:${entry.family}`,
          payer: input.feePayer,
          programId: input.programId,
        },
        entry.family === "swap" && swapLookupTable ? [swapLookupTable] : []
      )
    );
  }
  return operations;
}

function initUserMetadata(vault: PublicKey, userMetadata: PublicKey) {
  return new TransactionInstruction({
    programId: KLEND,
    keys: [
      { pubkey: vault, isSigner: true, isWritable: false },
      { pubkey: vault, isSigner: true, isWritable: true },
      { pubkey: userMetadata, isSigner: false, isWritable: true },
      { pubkey: KLEND, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([...INIT_USER_METADATA, ...PublicKey.default.toBytes()]),
  });
}

export async function buildEarnMaxSetupInstructions(input: {
  connection: Connection;
  feePayer: PublicKey;
  programId: PublicKey;
  settings: PublicKey;
}): Promise<EarnMaxClientOperation[]> {
  const topology = deriveEarnMaxTopology(input.settings);
  const userMetadata = PublicKey.findProgramAddressSync(
    [USER_METADATA_SEED, topology.vault.toBytes()],
    KLEND
  )[0];
  const custodians = uniquePubkeys([
    topology.claimCustody,
    ...topology.strategies.flatMap((strategy) => [strategy.collateralCustody, strategy.debtCustody]),
  ]);
  const accountKeys = [
    ...custodians,
    userMetadata,
    ...topology.strategies.map(({ obligation }) => obligation),
    ...topology.strategies.flatMap(({ debtFarmUser }) => debtFarmUser ? [debtFarmUser] : []),
  ];
  const accountInfos = await input.connection.getMultipleAccountsInfo(accountKeys, "confirmed");
  const info = new Map(accountKeys.map((key, index) => [key.toBase58(), accountInfos[index]]));
  const operations: EarnMaxClientOperation[] = [];
  const custodyMetadata = uniquePubkeys([
    USDC_MINT,
    ...topology.strategies.map(({ collateralMint }) => collateralMint),
    ...topology.strategies.map(({ debtMint }) => debtMint),
  ]).map((mint) => {
    const strategy = topology.strategies.find(({ debtMint }) => debtMint.equals(mint));
    return { mint, tokenProgram: strategy?.debtTokenProgram ?? TOKEN };
  });
  for (const { mint, tokenProgram } of custodyMetadata) {
    const custody = associatedToken(topology.vault, mint, tokenProgram);
    if (!info.get(custody.toBase58())) {
      operations.push(prepared({
        instructions: [createAssociatedTokenAccount(input.feePayer, topology.vault, mint, tokenProgram)],
        operation: `earnMaxCustodySetup:${mint.toBase58()}`,
        payer: input.feePayer,
        programId: input.programId,
      }));
    }
  }
  const missingMetadata = !info.get(userMetadata.toBase58());
  const missingObligations = topology.strategies.filter(({ obligation }) => !info.get(obligation.toBase58()));
  const missingFarms = topology.strategies.filter(({ debtFarmUser }) => debtFarmUser && !info.get(debtFarmUser.toBase58()));
  const setupCount = Number(missingMetadata) + missingObligations.length + missingFarms.length;
  if (setupCount > 0) {
    const vaultLamports = await input.connection.getBalance(
      topology.vault,
      "confirmed"
    );
    const topUp = Math.max(0, SETUP_RENT_BUFFER_LAMPORTS * setupCount - vaultLamports);
    if (topUp > 0) {
      operations.unshift(prepared({
        instructions: [SystemProgram.transfer({
          fromPubkey: input.feePayer,
          toPubkey: topology.vault,
          lamports: topUp,
        })],
        operation: "earnMaxRentSetup",
        payer: input.feePayer,
        programId: input.programId,
      }));
    }
  }
  if (missingMetadata) {
    operations.push(await buildVaultExecution({
      ...input,
      inner: [initUserMetadata(topology.vault, userMetadata)],
      vault: topology.vault,
      operation: "earnMaxUserMetadataSetup",
    }));
  }
  for (const strategy of missingObligations) {
    const init = new TransactionInstruction({
      programId: KLEND,
      keys: [
        { pubkey: topology.vault, isSigner: true, isWritable: false },
        { pubkey: topology.vault, isSigner: true, isWritable: true },
        { pubkey: strategy.obligation, isSigner: false, isWritable: true },
        { pubkey: strategy.market, isSigner: false, isWritable: false },
        { pubkey: strategy.collateralMint, isSigner: false, isWritable: false },
        { pubkey: strategy.debtMint, isSigner: false, isWritable: false },
        { pubkey: userMetadata, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([...INIT_OBLIGATION, 1, 0]),
    });
    operations.push(await buildVaultExecution({
      ...input, inner: [init], vault: topology.vault,
      operation: `earnMaxObligationSetup:${strategy.key}`,
    }));
  }
  for (const strategy of missingFarms) {
    const debtFarm = strategy.debtFarm!;
    const debtFarmUser = strategy.debtFarmUser!;
    const init = new TransactionInstruction({
      programId: KLEND,
      keys: [
        { pubkey: topology.vault, isSigner: true, isWritable: true },
        { pubkey: topology.vault, isSigner: false, isWritable: false },
        { pubkey: strategy.obligation, isSigner: false, isWritable: true },
        { pubkey: strategy.marketAuthority, isSigner: false, isWritable: false },
        { pubkey: strategy.debtReserve, isSigner: false, isWritable: true },
        { pubkey: debtFarm, isSigner: false, isWritable: true },
        { pubkey: debtFarmUser, isSigner: false, isWritable: true },
        { pubkey: strategy.market, isSigner: false, isWritable: false },
        { pubkey: FARMS, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([...INIT_OBLIGATION_FARM, 1]),
    });
    operations.push(await buildVaultExecution({
      ...input, inner: [init], vault: topology.vault,
      operation: `earnMaxDebtFarmSetup:${strategy.key}`,
    }));
  }
  return operations;
}

export async function buildEarnMaxDepositInstructions(input: {
  amountRaw: bigint;
  connection: Connection;
  feePayer: PublicKey;
  programId: PublicKey;
  settings: PublicKey;
}): Promise<EarnMaxClientOperation[]> {
  const topology = deriveEarnMaxTopology(input.settings);
  const operations = await buildEarnMaxSetupInstructions(input);
  operations.push(
    prepared({
      instructions: [
        transferChecked({
          amountRaw: input.amountRaw,
          destination: topology.claimCustody,
          mint: topology.claimMint,
          owner: input.feePayer,
          source: associatedToken(input.feePayer, topology.claimMint),
        }),
        earnMaxCashFlowMemo({
          // SPL Memo requires every supplied account to sign. The memo text
          // binds Settings and amount; LaserStream derives custody/source and
          // proves them against the confirmed transfer in this transaction.
          accounts: [
            { pubkey: input.feePayer, isSigner: true, isWritable: false },
          ],
          value: `loyal:earn-max:v2:deposit:${
            input.amountRaw
          }:${input.settings.toBase58()}`,
        }),
      ],
      operation: "earnMaxDeposit",
      payer: input.feePayer,
      programId: TOKEN,
    })
  );
  return operations;
}

function requestId(value: string): string {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(value)) {
    throw new Error("Earn MAX request id must be 8-64 URL-safe characters.");
  }
  return value;
}

function earnMaxIntent(
  vault: PublicKey,
  value: string
): TransactionInstruction {
  if (Buffer.byteLength(value) > 180)
    throw new Error("Earn MAX intent is too large.");
  return new TransactionInstruction({
    programId: MEMO,
    // The synchronous Smart Account compiler requires its signing vault to be
    // writable. Memo does not mutate it, but the outer execution must still
    // carry the vault through the writable-signer account class.
    keys: [{ pubkey: vault, isSigner: true, isWritable: true }],
    data: Buffer.from(value, "utf8"),
  });
}

function earnMaxCashFlowMemo(input: {
  accounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[];
  value: string;
}): TransactionInstruction {
  if (Buffer.byteLength(input.value) > 220)
    throw new Error("Earn MAX cash-flow evidence is too large.");
  return new TransactionInstruction({
    programId: MEMO,
    keys: input.accounts,
    data: Buffer.from(input.value, "utf8"),
  });
}

export async function buildEarnMaxWithdrawalRequestInstructions(input: {
  amountRaw: bigint | "max";
  connection: Connection;
  destination: PublicKey;
  feePayer: PublicKey;
  programId: PublicKey;
  requestId: string;
  settings: PublicKey;
}): Promise<EarnMaxClientOperation> {
  const topology = deriveEarnMaxTopology(input.settings);
  const amount = input.amountRaw === "max" ? "max" : input.amountRaw.toString();
  if (input.amountRaw !== "max" && input.amountRaw <= BigInt(0)) {
    throw new Error("Earn MAX withdrawal amount must be positive.");
  }
  return buildVaultExecution({
    ...input,
    vault: topology.vault,
    operation: "earnMaxWithdrawalRequest",
    inner: [
      earnMaxIntent(
        topology.vault,
        `loyal:earn-max:v2:withdraw:${requestId(
          input.requestId
        )}:${amount}:${input.destination.toBase58()}`
      ),
    ],
  });
}

export async function buildEarnMaxWithdrawalCancelInstructions(input: {
  connection: Connection;
  feePayer: PublicKey;
  programId: PublicKey;
  requestId: string;
  settings: PublicKey;
}): Promise<EarnMaxClientOperation> {
  const topology = deriveEarnMaxTopology(input.settings);
  return buildVaultExecution({
    ...input,
    vault: topology.vault,
    operation: "earnMaxWithdrawalCancel",
    inner: [
      earnMaxIntent(
        topology.vault,
        `loyal:earn-max:v2:cancel:${requestId(input.requestId)}`
      ),
    ],
  });
}

export async function buildEarnMaxClaimInstructions(input: {
  amountRaw: bigint;
  connection: Connection;
  feePayer: PublicKey;
  programId: PublicKey;
  requestId: string;
  settings: PublicKey;
}): Promise<{ destination: PublicKey; operation: EarnMaxClientOperation }> {
  const topology = deriveEarnMaxTopology(input.settings);
  const destination = associatedToken(input.feePayer, topology.claimMint);
  return {
    destination,
    operation: await buildVaultExecution({
      ...input,
      vault: topology.vault,
      operation: "earnMaxClaim",
      inner: [
        transferChecked({
          amountRaw: input.amountRaw,
          destination,
          mint: topology.claimMint,
          owner: topology.vault,
          source: topology.claimCustody,
        }),
        earnMaxCashFlowMemo({
          // The Squads vault is the only Memo account because every Memo
          // account must sign. Settings, destination and amount are in the
          // payload and independently reconciled to confirmed token deltas.
          accounts: [
            { pubkey: topology.vault, isSigner: true, isWritable: true },
          ],
          value: `loyal:earn-max:v2:claim:${requestId(input.requestId)}:${
            input.amountRaw
          }:${destination.toBase58()}:${input.settings.toBase58()}`,
        }),
      ],
    }),
  };
}

export async function buildEarnMaxCloseInstructions(input: {
  connection: Connection;
  feePayer: PublicKey;
  policies: readonly PublicKey[];
  programId: PublicKey;
  settings: PublicKey;
}): Promise<EarnMaxClientOperation | null> {
  const accounts = await input.connection.getMultipleAccountsInfo(
    [...input.policies],
    "confirmed"
  );
  const existing = input.policies.filter((_, index) => accounts[index]);
  if (existing.length === 0) return null;
  return createLoyalSmartAccountsClient({
    connection: input.connection,
    programId: input.programId,
  }).features.execution.prepare.executeSettingsTransactionSync({
    feePayer: input.feePayer,
    settingsPda: input.settings,
    signers: [input.feePayer],
    actions: existing.map((policy) => ({ __kind: "PolicyRemove", policy })),
    memo: "Earn MAX close",
    remainingAccounts: existing.map((pubkey) => ({
      pubkey,
      isSigner: false,
      isWritable: true,
    })),
  } as never);
}

export function deriveEarnMaxWalletClaimAta(wallet: PublicKey): PublicKey {
  return associatedToken(wallet, USDC_MINT);
}
