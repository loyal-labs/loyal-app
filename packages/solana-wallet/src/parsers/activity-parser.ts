import {
  type ParsedInnerInstruction,
  type ParsedInstruction,
  type ParsedMessage,
  type ParsedTransactionWithMeta,
  PartiallyDecodedInstruction,
  PublicKey,
} from "@solana/web3.js";

import {
  DUST_LAMPORTS_THRESHOLD,
  JUPITER_PROGRAM_ID,
  NATIVE_SOL_DECIMALS,
  NATIVE_SOL_MINT,
} from "../constants";
import { isDustSolTransfer, isDustTokenTransfer } from "../domain/dust-filter";
import { decodeWalletInstruction } from "./instruction-manifest";
import type {
  WalletActivity,
  WalletProgramActionActivity,
  WalletTokenAmount,
} from "../types";

type TokenBalanceEntry = {
  accountIndex: number;
  mint: string;
  owner?: string;
  programId?: string;
  uiTokenAmount?: {
    amount: string;
    decimals: number;
  };
};

type TokenChange = {
  mint: string;
  decimals: number;
  rawDelta: bigint;
  direction: "in" | "out";
  absRaw: bigint;
};

const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);
const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
);

const accountKeyToString = (
  key: ParsedMessage["accountKeys"][number] | PublicKey | string
): string => {
  if (typeof key === "string") {
    return key;
  }

  if ("pubkey" in (key as ParsedMessage["accountKeys"][number])) {
    return (key as ParsedMessage["accountKeys"][number]).pubkey.toString();
  }

  return (key as PublicKey).toString();
};

const absBigInt = (value: bigint): bigint =>
  value < BigInt(0) ? BigInt(0) - value : value;

function getAtaAddress(args: {
  walletAddress: string;
  mint: string;
  tokenProgramId: PublicKey;
}): string {
  const wallet = new PublicKey(args.walletAddress);
  const mint = new PublicKey(args.mint);
  const [ata] = PublicKey.findProgramAddressSync(
    [wallet.toBuffer(), args.tokenProgramId.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return ata.toBase58();
}

function isWalletTokenAccount(args: {
  tokenAccount: string;
  owner: string | undefined;
  walletAddress: string;
  mint: string;
  programId: string | undefined;
}): boolean {
  if (args.owner === args.walletAddress) {
    return true;
  }

  if (typeof args.owner === "string" && args.owner !== args.walletAddress) {
    return false;
  }

  const tokenProgramId =
    args.programId === TOKEN_2022_PROGRAM_ID.toBase58()
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;

  try {
    return (
      getAtaAddress({
        walletAddress: args.walletAddress,
        mint: args.mint,
        tokenProgramId,
      }) === args.tokenAccount
    );
  } catch {
    return false;
  }
}

function addToMintSum(
  map: Map<string, { raw: bigint; decimals: number }>,
  mint: string,
  raw: bigint,
  decimals: number
) {
  const existing = map.get(mint);
  if (!existing) {
    map.set(mint, { raw, decimals });
    return;
  }

  map.set(mint, {
    raw: existing.raw + raw,
    decimals: existing.decimals,
  });
}

function pow10BigInt(exp: number): bigint {
  let result = BigInt(1);
  for (let index = 0; index < exp; index += 1) {
    result *= BigInt(10);
  }
  return result;
}

function formatTokenAmountFromRaw(args: {
  absRaw: bigint;
  decimals: number;
  maxFractionDigits: number;
}): string {
  if (args.decimals <= 0) {
    return args.absRaw.toString();
  }

  const fractionDigits = Math.min(args.decimals, args.maxFractionDigits);
  const base = pow10BigInt(args.decimals);
  const integer = args.absRaw / base;
  const remainder = args.absRaw % base;

  if (fractionDigits === 0) {
    return integer.toString();
  }

  const drop =
    args.decimals > fractionDigits
      ? pow10BigInt(args.decimals - fractionDigits)
      : BigInt(1);
  const fraction = remainder / drop;
  const fractionString = fraction
    .toString()
    .padStart(fractionDigits, "0")
    .replace(/0+$/, "");

  return fractionString
    ? `${integer.toString()}.${fractionString}`
    : integer.toString();
}

function toTokenAmount(change: TokenChange): WalletTokenAmount {
  return {
    mint: change.mint,
    amount: formatTokenAmountFromRaw({
      absRaw: change.absRaw,
      decimals: change.decimals,
      maxFractionDigits: 4,
    }),
    decimals: change.decimals,
  };
}

function findAllTokenBalanceChanges(
  message: ParsedMessage,
  meta: NonNullable<ParsedTransactionWithMeta["meta"]>,
  walletAddress: string
): TokenChange[] {
  const preList = (meta.preTokenBalances ?? []) as TokenBalanceEntry[];
  const postList = (meta.postTokenBalances ?? []) as TokenBalanceEntry[];

  const preByMint = new Map<string, { raw: bigint; decimals: number }>();
  const postByMint = new Map<string, { raw: bigint; decimals: number }>();

  for (const balance of preList) {
    const key = message.accountKeys?.[balance.accountIndex];
    const tokenAccount = key ? accountKeyToString(key) : null;
    if (
      !tokenAccount ||
      !isWalletTokenAccount({
        tokenAccount,
        owner: balance.owner,
        walletAddress,
        mint: balance.mint,
        programId: balance.programId,
      })
    ) {
      continue;
    }

    const uiTokenAmount = balance.uiTokenAmount;
    if (!uiTokenAmount || typeof uiTokenAmount.amount !== "string") {
      continue;
    }

    addToMintSum(
      preByMint,
      balance.mint,
      BigInt(uiTokenAmount.amount),
      uiTokenAmount.decimals
    );
  }

  for (const balance of postList) {
    const key = message.accountKeys?.[balance.accountIndex];
    const tokenAccount = key ? accountKeyToString(key) : null;
    if (
      !tokenAccount ||
      !isWalletTokenAccount({
        tokenAccount,
        owner: balance.owner,
        walletAddress,
        mint: balance.mint,
        programId: balance.programId,
      })
    ) {
      continue;
    }

    const uiTokenAmount = balance.uiTokenAmount;
    if (!uiTokenAmount || typeof uiTokenAmount.amount !== "string") {
      continue;
    }

    addToMintSum(
      postByMint,
      balance.mint,
      BigInt(uiTokenAmount.amount),
      uiTokenAmount.decimals
    );
  }

  const allMints = new Set([
    ...Array.from(preByMint.keys()),
    ...Array.from(postByMint.keys()),
  ]);

  const changes: TokenChange[] = [];
  for (const mint of allMints) {
    const pre = preByMint.get(mint);
    const post = postByMint.get(mint);
    const preRaw = pre?.raw ?? BigInt(0);
    const postRaw = post?.raw ?? BigInt(0);
    const decimals = post?.decimals ?? pre?.decimals ?? 0;
    const delta = postRaw - preRaw;
    if (delta === BigInt(0)) {
      continue;
    }

    changes.push({
      mint,
      decimals,
      rawDelta: delta,
      direction: delta > BigInt(0) ? "in" : "out",
      absRaw: absBigInt(delta),
    });
  }

  return changes;
}

function flattenInstructions(
  message: ParsedMessage,
  innerInstructions: ParsedInnerInstruction[] | null | undefined
): Array<ParsedInstruction | PartiallyDecodedInstruction> {
  return [
    ...(message.instructions as Array<
      ParsedInstruction | PartiallyDecodedInstruction
    >),
    ...((innerInstructions ?? []) as ParsedInnerInstruction[]).flatMap(
      (instruction) =>
        (instruction.instructions ?? []) as Array<
          ParsedInstruction | PartiallyDecodedInstruction
        >
    ),
  ];
}

function findSplTokenTransferCounterparty(args: {
  message: ParsedMessage;
  innerInstructions: ParsedInnerInstruction[] | null | undefined;
  meta: NonNullable<ParsedTransactionWithMeta["meta"]>;
  walletAddress: string;
  mint: string;
  direction: "in" | "out";
}): string | undefined {
  const allBalances = [
    ...((args.meta.preTokenBalances ?? []) as TokenBalanceEntry[]),
    ...((args.meta.postTokenBalances ?? []) as TokenBalanceEntry[]),
  ].filter((balance) => balance?.mint === args.mint);

  const tokenAccountToOwner = new Map<string, string>();
  const walletTokenAccounts = new Set<string>();

  for (const balance of allBalances) {
    const key = args.message.accountKeys?.[balance.accountIndex];
    if (!key) {
      continue;
    }

    const tokenAccount = accountKeyToString(key);
    if (balance.owner) {
      tokenAccountToOwner.set(tokenAccount, balance.owner);
    }

    if (
      isWalletTokenAccount({
        tokenAccount,
        owner: balance.owner,
        walletAddress: args.walletAddress,
        mint: balance.mint,
        programId: balance.programId,
      })
    ) {
      walletTokenAccounts.add(tokenAccount);
    }
  }

  const instructions = flattenInstructions(
    args.message,
    args.innerInstructions
  );
  for (const instruction of instructions) {
    if (!("program" in instruction)) {
      continue;
    }

    if (
      instruction.program !== "spl-token" &&
      instruction.program !== "spl-token-2022"
    ) {
      continue;
    }

    const parsed = (
      instruction as ParsedInstruction & {
        parsed?: {
          type?: string;
          info?: { source?: string; destination?: string };
        };
      }
    ).parsed;

    if (parsed?.type !== "transfer" && parsed?.type !== "transferChecked") {
      continue;
    }

    const source = parsed.info?.source;
    const destination = parsed.info?.destination;

    if (!source || !destination) {
      continue;
    }

    if (args.direction === "out" && walletTokenAccounts.has(source)) {
      return tokenAccountToOwner.get(destination) ?? destination;
    }

    if (args.direction === "in" && walletTokenAccounts.has(destination)) {
      return tokenAccountToOwner.get(source) ?? source;
    }
  }

  return undefined;
}

function findSystemTransfer(
  message: ParsedMessage,
  innerInstructions: ParsedInnerInstruction[] | null | undefined,
  walletAddress: string
): ParsedInstruction | undefined {
  return flattenInstructions(message, innerInstructions).find((instruction) => {
    if (!("program" in instruction)) {
      return false;
    }

    if (instruction.program !== "system") {
      return false;
    }

    const parsed = (
      instruction as ParsedInstruction & {
        parsed?: { type?: string; info?: Record<string, string> };
      }
    ).parsed;

    const source = parsed?.info?.source;
    const destination = parsed?.info?.destination ?? parsed?.info?.newAccount;
    if (source !== walletAddress && destination !== walletAddress) {
      return false;
    }

    return parsed?.type === "transfer" || parsed?.type === "createAccount";
  }) as ParsedInstruction | undefined;
}

function getCounterpartyFromSystemTransfer(args: {
  systemTransfer: ParsedInstruction | undefined;
  direction: "in" | "out";
}): string | undefined {
  if (!args.systemTransfer || !("parsed" in args.systemTransfer)) {
    return undefined;
  }

  const info = (
    args.systemTransfer as ParsedInstruction & {
      parsed?: { info?: Record<string, string> };
    }
  ).parsed?.info;

  return args.direction === "in"
    ? info?.source ?? undefined
    : info?.destination ?? undefined;
}

function toProgramActionActivity(args: {
  signature: string;
  tx: ParsedTransactionWithMeta;
  decodedAction: WalletProgramActionActivity["action"];
  direction: "in" | "out";
  amountLamports: number;
  netChangeLamports: number;
  counterparty?: string;
  tokenChange?: TokenChange | null;
}): WalletProgramActionActivity {
  return {
    type: "program_action",
    action: args.decodedAction,
    signature: args.signature,
    slot: args.tx.slot,
    timestamp: args.tx.blockTime ? args.tx.blockTime * 1000 : null,
    direction: args.direction,
    amountLamports: args.amountLamports,
    netChangeLamports: args.netChangeLamports,
    feeLamports: args.tx.meta?.fee ?? 0,
    status: args.tx.meta?.err ? "failed" : "success",
    counterparty: args.counterparty,
    ...(args.tokenChange ? { token: toTokenAmount(args.tokenChange) } : {}),
  };
}

export function normalizeParsedTransaction(args: {
  tx: ParsedTransactionWithMeta;
  signature: string;
  walletAddress: string;
  onlySystemTransfers?: boolean;
}): WalletActivity | null {
  const meta = args.tx.meta;
  if (!meta || !args.tx.transaction) {
    return null;
  }

  const message = args.tx.transaction.message as ParsedMessage;
  const innerInstructions = meta.innerInstructions as
    | ParsedInnerInstruction[]
    | null
    | undefined;

  const accountIndex = message.accountKeys.findIndex(
    (key) => accountKeyToString(key) === args.walletAddress
  );
  const isSigner =
    accountIndex >= 0 &&
    !!(message.accountKeys[accountIndex] as { signer?: boolean })?.signer;

  const systemTransfer = findSystemTransfer(
    message,
    innerInstructions,
    args.walletAddress
  );
  if (args.onlySystemTransfers && !systemTransfer) {
    return null;
  }

  const tokenChanges = args.onlySystemTransfers
    ? []
    : findAllTokenBalanceChanges(message, meta, args.walletAddress);
  const tokenChange =
    tokenChanges.length > 0
      ? tokenChanges.reduce((best, current) =>
          current.absRaw > best.absRaw ? current : best
        )
      : null;

  if (accountIndex === -1 && !tokenChange) {
    return null;
  }

  const preLamports =
    accountIndex === -1 ? 0 : meta.preBalances?.[accountIndex] ?? 0;
  const postLamports =
    accountIndex === -1 ? 0 : meta.postBalances?.[accountIndex] ?? 0;
  const netChangeLamports = postLamports - preLamports;

  if (
    isDustSolTransfer({
      isUserSigned: isSigner,
      hasTokenChange: tokenChange !== null,
      lamports: netChangeLamports,
    })
  ) {
    return null;
  }

  if (
    tokenChange &&
    isDustTokenTransfer({
      isUserSigned: isSigner,
      direction: tokenChange.direction,
      rawAmount: tokenChange.absRaw,
      decimals: tokenChange.decimals,
    })
  ) {
    return null;
  }

  if (netChangeLamports === 0 && !tokenChange) {
    return null;
  }

  const solDirection: "in" | "out" = netChangeLamports > 0 ? "in" : "out";
  const solAmountLamports = Math.abs(netChangeLamports);
  let counterparty = getCounterpartyFromSystemTransfer({
    systemTransfer,
    direction: solDirection,
  });

  const decodedInstruction = flattenInstructions(message, innerInstructions)
    .filter(
      (instruction): instruction is PartiallyDecodedInstruction =>
        "data" in instruction && typeof instruction.data === "string"
    )
    .map((instruction) => decodeWalletInstruction(instruction.data))
    .find((instruction) => instruction !== null);

  if (decodedInstruction?.type === "modify_balance" && tokenChange !== null) {
    return {
      type: decodedInstruction.increase ? "secure" : "unshield",
      signature: args.signature,
      slot: args.tx.slot,
      timestamp: args.tx.blockTime ? args.tx.blockTime * 1000 : null,
      direction: decodedInstruction.increase ? "out" : "in",
      token: toTokenAmount(tokenChange),
      feeLamports: meta.fee ?? 0,
      status: meta.err ? "failed" : "success",
      counterparty,
    };
  }

  const instructions = flattenInstructions(message, innerInstructions);
  const isJupiterSwap =
    tokenChanges.length > 0 &&
    instructions.some(
      (instruction) =>
        "programId" in instruction &&
        instruction.programId?.toBase58?.() === JUPITER_PROGRAM_ID
    );

  if (isJupiterSwap || (isSigner && tokenChanges.length > 1)) {
    const tokenIn = tokenChanges.find((change) => change.direction === "in");
    const tokenOut = tokenChanges.find((change) => change.direction === "out");
    const solOut = netChangeLamports < -DUST_LAMPORTS_THRESHOLD;
    const solIn = netChangeLamports > DUST_LAMPORTS_THRESHOLD;

    if (tokenIn && tokenOut) {
      return {
        type: "swap",
        signature: args.signature,
        slot: args.tx.slot,
        timestamp: args.tx.blockTime ? args.tx.blockTime * 1000 : null,
        direction: "out",
        fromToken: toTokenAmount(tokenOut),
        toToken: toTokenAmount(tokenIn),
        amountLamports: solAmountLamports,
        feeLamports: meta.fee ?? 0,
        status: meta.err ? "failed" : "success",
        counterparty: "Swap",
      };
    }

    if (solOut && tokenIn) {
      return {
        type: "swap",
        signature: args.signature,
        slot: args.tx.slot,
        timestamp: args.tx.blockTime ? args.tx.blockTime * 1000 : null,
        direction: "out",
        fromToken: {
          mint: NATIVE_SOL_MINT,
          amount: formatTokenAmountFromRaw({
            absRaw: BigInt(Math.abs(netChangeLamports)),
            decimals: NATIVE_SOL_DECIMALS,
            maxFractionDigits: 6,
          }),
          decimals: NATIVE_SOL_DECIMALS,
        },
        toToken: {
          mint: tokenIn.mint,
          amount: formatTokenAmountFromRaw({
            absRaw: tokenIn.absRaw,
            decimals: tokenIn.decimals,
            maxFractionDigits: 6,
          }),
          decimals: tokenIn.decimals,
        },
        amountLamports: solAmountLamports,
        feeLamports: meta.fee ?? 0,
        status: meta.err ? "failed" : "success",
        counterparty: "Swap",
      };
    }

    if (tokenOut && solIn) {
      return {
        type: "swap",
        signature: args.signature,
        slot: args.tx.slot,
        timestamp: args.tx.blockTime ? args.tx.blockTime * 1000 : null,
        direction: "out",
        fromToken: {
          mint: tokenOut.mint,
          amount: formatTokenAmountFromRaw({
            absRaw: tokenOut.absRaw,
            decimals: tokenOut.decimals,
            maxFractionDigits: 6,
          }),
          decimals: tokenOut.decimals,
        },
        toToken: {
          mint: NATIVE_SOL_MINT,
          amount: formatTokenAmountFromRaw({
            absRaw: BigInt(netChangeLamports),
            decimals: NATIVE_SOL_DECIMALS,
            maxFractionDigits: 6,
          }),
          decimals: NATIVE_SOL_DECIMALS,
        },
        amountLamports: solAmountLamports,
        feeLamports: meta.fee ?? 0,
        status: meta.err ? "failed" : "success",
        counterparty: "Swap",
      };
    }
  }

  if (decodedInstruction?.type === "program_action") {
    return toProgramActionActivity({
      signature: args.signature,
      tx: args.tx,
      decodedAction: decodedInstruction.action,
      direction: tokenChange !== null ? tokenChange.direction : solDirection,
      amountLamports: tokenChange !== null ? 0 : solAmountLamports,
      netChangeLamports,
      counterparty,
      tokenChange,
    });
  }

  if (tokenChange) {
    const tokenCounterparty = findSplTokenTransferCounterparty({
      message,
      innerInstructions,
      meta,
      walletAddress: args.walletAddress,
      mint: tokenChange.mint,
      direction: tokenChange.direction,
    });

    if (tokenCounterparty) {
      counterparty = tokenCounterparty;
    }

    return {
      type: "token_transfer",
      signature: args.signature,
      slot: args.tx.slot,
      timestamp: args.tx.blockTime ? args.tx.blockTime * 1000 : null,
      direction: tokenChange.direction,
      token: toTokenAmount(tokenChange),
      feeLamports: meta.fee ?? 0,
      status: meta.err ? "failed" : "success",
      counterparty,
    };
  }

  return {
    type: "sol_transfer",
    signature: args.signature,
    slot: args.tx.slot,
    timestamp: args.tx.blockTime ? args.tx.blockTime * 1000 : null,
    direction: solDirection,
    amountLamports: solAmountLamports,
    netChangeLamports,
    feeLamports: meta.fee ?? 0,
    status: meta.err ? "failed" : "success",
    counterparty,
  };
}
