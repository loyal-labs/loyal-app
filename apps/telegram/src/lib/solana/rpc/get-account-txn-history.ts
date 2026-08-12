import {
  type ParsedInnerInstruction,
  type ParsedInstruction,
  type ParsedMessage,
  type ParsedTransactionWithMeta,
  PartiallyDecodedInstruction,
  PublicKey,
} from "@solana/web3.js";

import {
  decodeTelegramPrivateTransferInstruction,
  decodeTelegramVerificationInstruction,
} from "../solana-helpers";
import { getConnection, getWebsocketConnection } from "./connection";
import { GetAccountTransactionHistoryOptions, WalletTransfer } from "./types";

type ListenForAccountTransactionsOptions = {
  onlySystemTransfers?: boolean;
};

type TokenBalanceEntry = {
  accountIndex: number;
  mint: string;
  owner?: string;
  programId?: string;
  uiTokenAmount?: {
    amount: string; // raw integer, as base-10 string
    decimals: number;
  };
};

type TokenChange = {
  mint: string;
  decimals: number;
  rawDelta: bigint; // post - pre, in base units
  direction: "in" | "out";
  absRaw: bigint;
};

const accountKeyToString = (
  key: ParsedMessage["accountKeys"][number] | PublicKey | string
): string => {
  if (typeof key === "string") return key;
  if ("pubkey" in (key as ParsedMessage["accountKeys"][number])) {
    const parsed = key as ParsedMessage["accountKeys"][number];
    return parsed.pubkey.toString();
  }
  const maybePubkey = key as PublicKey;
  return maybePubkey?.toString ? maybePubkey.toString() : String(key);
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

const absBigInt = (n: bigint): bigint => (n < BigInt(0) ? BigInt(0) - n : n);

const getAtaAddress = (args: {
  walletAddress: string;
  mint: string;
  tokenProgramId: PublicKey;
}): string => {
  const wallet = new PublicKey(args.walletAddress);
  const mint = new PublicKey(args.mint);
  const [ata] = PublicKey.findProgramAddressSync(
    [wallet.toBuffer(), args.tokenProgramId.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return ata.toBase58();
};

const isWalletTokenAccount = (args: {
  tokenAccount: string;
  owner: string | undefined;
  walletAddress: string;
  mint: string;
  programId: string | undefined;
}): boolean => {
  if (args.owner === args.walletAddress) return true;
  if (typeof args.owner === "string" && args.owner !== args.walletAddress) {
    return false;
  }

  // Fallback when owner is missing: treat the associated token account (ATA) as wallet-owned.
  // This covers the common case without extra RPC calls.
  const tokenProgramId =
    args.programId === TOKEN_2022_PROGRAM_ID.toBase58()
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;
  try {
    const ata = getAtaAddress({
      walletAddress: args.walletAddress,
      mint: args.mint,
      tokenProgramId,
    });
    return ata === args.tokenAccount;
  } catch {
    return false;
  }
};

const addToMintSum = (
  map: Map<string, { raw: bigint; decimals: number }>,
  mint: string,
  raw: bigint,
  decimals: number
) => {
  const existing = map.get(mint);
  if (!existing) {
    map.set(mint, { raw, decimals });
    return;
  }
  map.set(mint, { raw: existing.raw + raw, decimals: existing.decimals });
};

const pow10BigInt = (exp: number): bigint => {
  let result = BigInt(1);
  for (let i = 0; i < exp; i++) {
    result *= BigInt(10);
  }
  return result;
};

const formatTokenAmountFromRaw = (args: {
  absRaw: bigint;
  decimals: number;
  maxFractionDigits: number;
}): string => {
  const { absRaw, decimals } = args;
  if (decimals <= 0) return absRaw.toString();

  const fracDigits = Math.min(decimals, args.maxFractionDigits);
  const base = pow10BigInt(decimals);
  const integer = absRaw / base;
  const remainder = absRaw % base;

  if (fracDigits === 0) return integer.toString();

  // Truncate the fractional remainder to the desired precision.
  const drop =
    decimals > fracDigits ? pow10BigInt(decimals - fracDigits) : BigInt(1);
  const fracTruncated = remainder / drop;
  const fracStr = fracTruncated
    .toString()
    .padStart(fracDigits, "0")
    .replace(/0+$/, "");

  return fracStr.length
    ? `${integer.toString()}.${fracStr}`
    : integer.toString();
};

const findAllTokenBalanceChanges = (
  message: ParsedMessage,
  meta: NonNullable<ParsedTransactionWithMeta["meta"]>,
  walletAddress: string
): TokenChange[] => {
  const preList = (meta.preTokenBalances ?? []) as TokenBalanceEntry[];
  const postList = (meta.postTokenBalances ?? []) as TokenBalanceEntry[];

  const preByMint = new Map<string, { raw: bigint; decimals: number }>();
  const postByMint = new Map<string, { raw: bigint; decimals: number }>();

  for (const b of preList) {
    if (!b) continue;
    const key = message.accountKeys?.[b.accountIndex];
    const tokenAccount = key ? accountKeyToString(key) : null;
    if (
      !tokenAccount ||
      !isWalletTokenAccount({
        tokenAccount,
        owner: b.owner,
        walletAddress,
        mint: b.mint,
        programId: b.programId,
      })
    ) {
      continue;
    }
    const ui = b.uiTokenAmount;
    if (!ui || typeof ui.amount !== "string") continue;
    addToMintSum(preByMint, b.mint, BigInt(ui.amount), ui.decimals);
  }

  for (const b of postList) {
    if (!b) continue;
    const key = message.accountKeys?.[b.accountIndex];
    const tokenAccount = key ? accountKeyToString(key) : null;
    if (
      !tokenAccount ||
      !isWalletTokenAccount({
        tokenAccount,
        owner: b.owner,
        walletAddress,
        mint: b.mint,
        programId: b.programId,
      })
    ) {
      continue;
    }
    const ui = b.uiTokenAmount;
    if (!ui || typeof ui.amount !== "string") continue;
    addToMintSum(postByMint, b.mint, BigInt(ui.amount), ui.decimals);
  }

  const allMints = new Set<string>([
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
    if (delta === BigInt(0)) continue;

    changes.push({
      mint,
      decimals,
      rawDelta: delta,
      direction: delta > BigInt(0) ? "in" : "out",
      absRaw: absBigInt(delta),
    });
  }

  return changes;
};

const findSplTokenTransferCounterparty = (args: {
  message: ParsedMessage;
  innerInstructions: ParsedInnerInstruction[] | null | undefined;
  meta: NonNullable<ParsedTransactionWithMeta["meta"]>;
  walletAddress: string;
  mint: string;
  direction: "in" | "out";
}): string | undefined => {
  const { message, innerInstructions, meta, walletAddress, mint, direction } =
    args;

  const preList = (meta.preTokenBalances ?? []) as TokenBalanceEntry[];
  const postList = (meta.postTokenBalances ?? []) as TokenBalanceEntry[];
  const allBalances = [...preList, ...postList].filter((b) => b?.mint === mint);

  const tokenAccountToOwner = new Map<string, string>();
  const walletTokenAccounts = new Set<string>();

  for (const b of allBalances) {
    const key = message.accountKeys?.[b.accountIndex];
    if (!key) continue;
    const tokenAccount = accountKeyToString(key);
    if (b.owner) {
      tokenAccountToOwner.set(tokenAccount, b.owner);
    }
    if (
      isWalletTokenAccount({
        tokenAccount,
        owner: b.owner,
        walletAddress,
        mint: b.mint,
        programId: b.programId,
      })
    ) {
      walletTokenAccounts.add(tokenAccount);
    }
  }

  const topLevel = (message.instructions ?? []) as ParsedInstruction[];
  const innerList: ParsedInnerInstruction[] = innerInstructions ?? [];
  const inner = innerList.flatMap((ix: ParsedInnerInstruction) => {
    const instructions = ix.instructions ?? [];
    return instructions as ParsedInstruction[];
  });

  const allInstructions = [...topLevel, ...inner];

  for (const ix of allInstructions) {
    if (ix.program !== "spl-token" && ix.program !== "spl-token-2022") {
      continue;
    }
    const parsed = (
      ix as ParsedInstruction & {
        parsed?: {
          type?: string;
          info?: { source?: string; destination?: string };
        };
      }
    ).parsed;
    const parsedType = parsed?.type;
    if (parsedType !== "transfer" && parsedType !== "transferChecked") {
      continue;
    }
    const info = parsed?.info as
      | { source?: string; destination?: string }
      | undefined;
    const source = info?.source;
    const destination = info?.destination;
    if (!source || !destination) continue;

    if (direction === "out" && walletTokenAccounts.has(source)) {
      return tokenAccountToOwner.get(destination) ?? destination;
    }
    if (direction === "in" && walletTokenAccounts.has(destination)) {
      return tokenAccountToOwner.get(source) ?? source;
    }
  }

  return undefined;
};

const findSystemTransfer = (
  message: ParsedMessage,
  innerInstructions: ParsedInnerInstruction[] | null | undefined,
  walletAddress: string
): ParsedInstruction | undefined => {
  const topLevel = (message.instructions ?? []) as ParsedInstruction[];
  const innerList: ParsedInnerInstruction[] = innerInstructions ?? [];
  const inner = innerList.flatMap((ix: ParsedInnerInstruction) => {
    const instructions = ix.instructions ?? [];
    return instructions as ParsedInstruction[];
  });

  const allInstructions = [...topLevel, ...inner];

  return allInstructions.find((ix) => {
    if (ix.program !== "system") return false;
    const parsed = (
      ix as ParsedInstruction & { parsed?: { info?: Record<string, string> } }
    ).parsed;
    const info = parsed?.info;
    if (!info) return false;

    const source = info.source;
    const dest = info.destination ?? info.newAccount;
    if (source !== walletAddress && dest !== walletAddress) return false;

    return parsed?.type === "transfer" || parsed?.type === "createAccount";
  });
};

/** Threshold below which third-party transactions with no token change are treated as dust/noise */
const DUST_LAMPORTS_THRESHOLD = 10_000;

/** Jupiter V6 Aggregator program ID for deterministic swap detection */
const JUPITER_PROGRAM_ID = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";

const mapTransactionToTransfer = (
  tx: ParsedTransactionWithMeta,
  signature: string,
  walletAddress: string,
  onlySystemTransfers: boolean
): WalletTransfer | null => {
  const meta = tx.meta;
  if (!meta || !tx.transaction) return null;
  const safeMeta = meta as NonNullable<typeof meta>;

  const message = tx.transaction.message as ParsedMessage;
  const innerInstructions = safeMeta.innerInstructions as
    | ParsedInnerInstruction[]
    | null
    | undefined;

  const accountIndex = message.accountKeys.findIndex(
    (key) => accountKeyToString(key) === walletAddress
  );

  // Check if the wallet is the transaction signer (fee payer / first account key)
  const isSigner =
    accountIndex >= 0 &&
    !!(message.accountKeys[accountIndex] as { signer?: boolean })?.signer;

  const systemTransfer = findSystemTransfer(
    message,
    innerInstructions,
    walletAddress
  );
  if (onlySystemTransfers && !systemTransfer) return null;

  const allTokenChanges = onlySystemTransfers
    ? []
    : findAllTokenBalanceChanges(message, safeMeta, walletAddress);
  const tokenChange =
    allTokenChanges.length > 0
      ? allTokenChanges.reduce((best, c) => (c.absRaw > best.absRaw ? c : best))
      : null;

  if (accountIndex === -1 && !tokenChange) return null;

  const preLamports =
    accountIndex === -1 ? 0 : safeMeta.preBalances?.[accountIndex] ?? 0;
  const postLamports =
    accountIndex === -1 ? 0 : safeMeta.postBalances?.[accountIndex] ?? 0;
  const netChangeLamports = postLamports - preLamports;

  // Dust filter: skip third-party transactions with no token change and tiny SOL movement
  if (
    !isSigner &&
    !tokenChange &&
    Math.abs(netChangeLamports) < DUST_LAMPORTS_THRESHOLD
  ) {
    return null;
  }

  if (netChangeLamports === 0 && !tokenChange) return null;

  const solDirection: "in" | "out" = netChangeLamports > 0 ? "in" : "out";
  const solAmountLamports = Math.abs(netChangeLamports);

  let counterparty: string | undefined;
  if (systemTransfer && "parsed" in systemTransfer) {
    const info = (
      systemTransfer as ParsedInstruction & {
        parsed?: { info?: Record<string, string> };
      }
    ).parsed?.info;
    if (info) {
      counterparty =
        solDirection === "in"
          ? info.source ?? undefined
          : info.destination ?? undefined;
    }
  }

  const allInstructionsWithData = [
    ...(message.instructions as (
      | ParsedInstruction
      | PartiallyDecodedInstruction
    )[]),
    ...((innerInstructions ?? []) as ParsedInnerInstruction[]).flatMap(
      (ix: ParsedInnerInstruction) =>
        (ix.instructions ?? []) as (
          | ParsedInstruction
          | PartiallyDecodedInstruction
        )[]
    ),
  ].filter(
    (ix): ix is PartiallyDecodedInstruction =>
      "data" in ix &&
      typeof (ix as PartiallyDecodedInstruction).data === "string"
  );

  const knownInstructionTypes: WalletTransfer["type"][] = [
    // telegram-verification
    "verify_telegram_init_data",
    "store",
    // telegram-private-transfer
    "initialize_deposit",
    "initialize_username_deposit",
    "modify_balance",
    "claim_username_deposit_to_deposit",
    "transfer_deposit",
    "transfer_to_username_deposit",
    "create_permission",
    "create_username_permission",
    "delegate",
    "delegate_username_deposit",
    "undelegate",
    "undelegate_username_deposit",
  ];

  const decodeInstructionData = (data: string) => {
    const decoders = [
      decodeTelegramPrivateTransferInstruction,
      decodeTelegramVerificationInstruction,
    ];

    for (const decode of decoders) {
      try {
        const decoded = decode(data);
        if (decoded) return decoded;
      } catch {
        continue;
      }
    }

    return null;
  };

  const decodedInstruction = allInstructionsWithData
    .map((ix) => decodeInstructionData(ix.data))
    .find((decoded) => decoded !== null);

  const decodedType = decodedInstruction?.name;

  let type: WalletTransfer["type"] =
    decodedType &&
    knownInstructionTypes.includes(decodedType as WalletTransfer["type"])
      ? (decodedType as WalletTransfer["type"])
      : "transfer";

  // Detect shield/unshield from private transfer program's modify_balance instruction
  if (decodedType === "modify_balance" && decodedInstruction) {
    const modifyArgs = (
      decodedInstruction.data as { args?: { increase?: boolean } }
    )?.args;
    if (typeof modifyArgs?.increase === "boolean") {
      type = modifyArgs.increase ? "secure" : "unshield";
    }
  }

  const isTokenTransfer = type === "transfer" && tokenChange !== null;
  const isSecureWithToken =
    (type === "secure" || type === "unshield") && tokenChange !== null;

  // Deterministic swap detection: check if any instruction targets Jupiter
  // Requires token balance changes so downstream consumers always get populated swapFields
  const isJupiterSwap =
    type === "transfer" &&
    allTokenChanges.length > 0 &&
    [
      ...(message.instructions as (
        | ParsedInstruction
        | PartiallyDecodedInstruction
      )[]),
      ...((innerInstructions ?? []) as ParsedInnerInstruction[]).flatMap(
        (ix: ParsedInnerInstruction) =>
          (ix.instructions ?? []) as (
            | ParsedInstruction
            | PartiallyDecodedInstruction
          )[]
      ),
    ].some(
      (ix) =>
        "programId" in ix && ix.programId?.toBase58?.() === JUPITER_PROGRAM_ID
    );

  if (isJupiterSwap) {
    type = "swap";
  }

  // Swap detection: wallet is signer + opposing SOL/token movements
  let swapFields: Partial<WalletTransfer> = {};
  if (
    allTokenChanges.length > 0 &&
    (type === "swap" || (isSigner && type === "transfer"))
  ) {
    const tokenIn = allTokenChanges.find((c) => c.direction === "in");
    const tokenOut = allTokenChanges.find((c) => c.direction === "out");
    const solOut = netChangeLamports < -DUST_LAMPORTS_THRESHOLD;
    const solIn = netChangeLamports > DUST_LAMPORTS_THRESHOLD;

    // Token-to-token swap (e.g. USDT -> BONK)
    if (tokenIn && tokenOut) {
      type = "swap";
      swapFields = {
        swapFromMint: tokenOut.mint,
        swapFromAmount: formatTokenAmountFromRaw({
          absRaw: tokenOut.absRaw,
          decimals: tokenOut.decimals,
          maxFractionDigits: 6,
        }),
        swapFromDecimals: tokenOut.decimals,
        swapToMint: tokenIn.mint,
        swapToAmount: formatTokenAmountFromRaw({
          absRaw: tokenIn.absRaw,
          decimals: tokenIn.decimals,
          maxFractionDigits: 6,
        }),
        swapToDecimals: tokenIn.decimals,
      };
    }
    // SOL-to-token swap
    else if (solOut && tokenIn) {
      type = "swap";
      swapFields = {
        swapFromMint: "So11111111111111111111111111111111111111112",
        swapFromAmount: formatTokenAmountFromRaw({
          absRaw: BigInt(Math.abs(netChangeLamports)),
          decimals: 9,
          maxFractionDigits: 6,
        }),
        swapFromDecimals: 9,
        swapToMint: tokenIn.mint,
        swapToAmount: formatTokenAmountFromRaw({
          absRaw: tokenIn.absRaw,
          decimals: tokenIn.decimals,
          maxFractionDigits: 6,
        }),
        swapToDecimals: tokenIn.decimals,
      };
    }
    // Token-to-SOL swap
    else if (tokenOut && solIn) {
      type = "swap";
      swapFields = {
        swapFromMint: tokenOut.mint,
        swapFromAmount: formatTokenAmountFromRaw({
          absRaw: tokenOut.absRaw,
          decimals: tokenOut.decimals,
          maxFractionDigits: 6,
        }),
        swapFromDecimals: tokenOut.decimals,
        swapToMint: "So11111111111111111111111111111111111111112",
        swapToAmount: formatTokenAmountFromRaw({
          absRaw: BigInt(netChangeLamports),
          decimals: 9,
          maxFractionDigits: 6,
        }),
        swapToDecimals: 9,
      };
    }
  }

  const direction: "in" | "out" =
    type === "swap"
      ? "out" // swaps always show as outgoing (SOL/token spent)
      : isTokenTransfer || isSecureWithToken
      ? tokenChange!.direction
      : solDirection;
  const amountLamports =
    type === "swap"
      ? solAmountLamports
      : isTokenTransfer || isSecureWithToken
      ? 0
      : solAmountLamports;

  if (type === "transfer_to_username_deposit") {
    // FIXME: parse `transfer_to_username_deposit` accounts and find username in
    // `destination_deposit.username`:
    // const usernameFromInstruction = (
    //   decodedInstruction?.data as { username?: string }
    // )?.username;
    // if (usernameFromInstruction) {
    //   counterparty = usernameFromInstruction;
    // }
  }

  if (isTokenTransfer && type !== "swap") {
    const tokenCounterparty = findSplTokenTransferCounterparty({
      message,
      innerInstructions,
      meta: safeMeta,
      walletAddress,
      mint: tokenChange!.mint,
      direction: tokenChange!.direction,
    });
    if (tokenCounterparty) {
      counterparty = tokenCounterparty;
    }
  }

  const returnObject: WalletTransfer = {
    signature,
    slot: tx.slot,
    timestamp: tx.blockTime ? tx.blockTime * 1000 : null,
    direction,
    type,
    amountLamports,
    netChangeLamports,
    feeLamports: safeMeta.fee ?? 0,
    status: safeMeta.err ? "failed" : "success",
    counterparty,
    ...((isTokenTransfer || isSecureWithToken) && type !== "swap"
      ? {
          tokenMint: tokenChange!.mint,
          tokenAmount: formatTokenAmountFromRaw({
            absRaw: tokenChange!.absRaw,
            decimals: tokenChange!.decimals,
            maxFractionDigits: 4,
          }),
          tokenDecimals: tokenChange!.decimals,
        }
      : {}),
    ...swapFields,
  };

  return returnObject;
};

export const getAccountTransactionHistory = async (
  publicKey: PublicKey,
  options: GetAccountTransactionHistoryOptions = {}
): Promise<{ transfers: WalletTransfer[]; nextCursor?: string }> => {
  const connection = getConnection();

  const signatures = await connection.getSignaturesForAddress(publicKey, {
    limit: options.limit ?? 10,
    before: options.before,
  });

  if (signatures.length === 0) {
    return { transfers: [], nextCursor: undefined };
  }

  const signatureList = signatures.map((s) => s.signature);
  const parsedTransactions = await connection.getParsedTransactions(
    signatureList,
    {
      maxSupportedTransactionVersion: 0,
    }
  );

  const transfers: WalletTransfer[] = [];

  for (let i = 0; i < parsedTransactions.length; i++) {
    const tx = parsedTransactions[i];
    const signature = signatureList[i];
    if (!tx) continue;

    const transfer = mapTransactionToTransfer(
      tx,
      signature,
      publicKey.toString(),
      options.onlySystemTransfers ?? false
    );

    if (transfer) {
      transfers.push(transfer);
    }
  }

  const nextCursor = signatures[signatures.length - 1]?.signature;

  return { transfers, nextCursor };
};

export const listenForAccountTransactions = async (
  publicKey: PublicKey,
  onTransfer: (transfer: WalletTransfer) => void,
  options: ListenForAccountTransactionsOptions = {}
): Promise<() => Promise<void>> => {
  const connection = getWebsocketConnection();
  const walletAddress = publicKey.toBase58();
  const processedSignatures = new Set<string>();
  const rememberSignature = (sig: string) => {
    processedSignatures.add(sig);
    if (processedSignatures.size > 100) {
      const [first] = processedSignatures;
      processedSignatures.delete(first);
    }
  };

  const subscriptionId = await connection.onLogs(
    publicKey,
    async (logInfo) => {
      try {
        const signature = logInfo.signature;
        if (!signature) return;
        if (processedSignatures.has(signature)) return;
        rememberSignature(signature);

        const parsedTx = await connection.getParsedTransaction(signature, {
          maxSupportedTransactionVersion: 0,
        });
        if (!parsedTx) return;

        const transfer = mapTransactionToTransfer(
          parsedTx,
          signature,
          walletAddress,
          options.onlySystemTransfers ?? false
        );
        if (transfer) {
          onTransfer(transfer);
        }
      } catch (err) {
        console.error("Error handling websocket transaction", err);
      }
    },
    "confirmed"
  );

  return async () => {
    await connection.removeOnLogsListener(subscriptionId);
  };
};
