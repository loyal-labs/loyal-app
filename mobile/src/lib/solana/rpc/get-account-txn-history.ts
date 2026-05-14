import {
  isDustSolTransfer,
  isDustTokenTransfer,
  SOL_DUST_THRESHOLD_LAMPORTS,
} from "@loyal-labs/shared";
import {
  type ParsedInnerInstruction,
  type ParsedInstruction,
  type ParsedMessage,
  type ParsedTransactionWithMeta,
  PartiallyDecodedInstruction,
  PublicKey,
} from "@solana/web3.js";

import { NATIVE_SOL_DECIMALS, NATIVE_SOL_MINT } from "../constants";
import {
  decodeTelegramPrivateTransferInstruction,
  decodeTelegramTransferInstruction,
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
    amount: string;
    decimals: number;
  };
};

export type TokenChange = {
  mint: string;
  decimals: number;
  rawDelta: bigint;
  direction: "in" | "out";
  absRaw: bigint;
};

const accountKeyToString = (
  key: ParsedMessage["accountKeys"][number] | PublicKey | string,
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
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);
const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
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
    ASSOCIATED_TOKEN_PROGRAM_ID,
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
  decimals: number,
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
  walletAddress: string,
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
  walletAddress: string,
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

const JUPITER_PROGRAM_ID = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";

export type SwapClassification = {
  type: WalletTransfer["type"];
  swapFields: Partial<WalletTransfer>;
};

/**
 * Classify the swap sides of a transaction given its token changes and
 * lamports delta. Exported for unit tests.
 *
 * WSOL shares the native SOL mint, and Jupiter's `wrapAndUnwrapSol` can
 * leave pre-existing WSOL dust in the user's ATA flowing as a token
 * "out"/"in" change — the wrap/unwrap is already reflected in the
 * lamports delta, so including it here would flip a USDC → SOL swap
 * into "Swap SOL → SOL" (ASK-1136). Strip WSOL before picking sides.
 */
export function classifySwap(params: {
  currentType: WalletTransfer["type"];
  allTokenChanges: TokenChange[];
  netChangeLamports: number;
  isSigner: boolean;
  isJupiterSwap: boolean;
}): SwapClassification {
  let type = params.currentType;
  if (params.isJupiterSwap && type === "transfer") {
    type = "swap";
  }

  const tokenChanges = params.allTokenChanges.filter(
    (change) => change.mint !== NATIVE_SOL_MINT,
  );

  const canClassify =
    tokenChanges.length > 0 &&
    (type === "swap" || (params.isSigner && type === "transfer"));
  if (!canClassify) {
    return { type, swapFields: {} };
  }

  const tokenIn = tokenChanges.find((change) => change.direction === "in");
  const tokenOut = tokenChanges.find((change) => change.direction === "out");
  const solOut =
    params.netChangeLamports < -SOL_DUST_THRESHOLD_LAMPORTS;
  const solIn = params.netChangeLamports > SOL_DUST_THRESHOLD_LAMPORTS;

  if (tokenIn && tokenOut) {
    return {
      type: "swap",
      swapFields: {
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
      },
    };
  }

  if (solOut && tokenIn) {
    return {
      type: "swap",
      swapFields: {
        swapFromMint: NATIVE_SOL_MINT,
        swapFromAmount: formatTokenAmountFromRaw({
          absRaw: BigInt(Math.abs(params.netChangeLamports)),
          decimals: NATIVE_SOL_DECIMALS,
          maxFractionDigits: 6,
        }),
        swapFromDecimals: NATIVE_SOL_DECIMALS,
        swapToMint: tokenIn.mint,
        swapToAmount: formatTokenAmountFromRaw({
          absRaw: tokenIn.absRaw,
          decimals: tokenIn.decimals,
          maxFractionDigits: 6,
        }),
        swapToDecimals: tokenIn.decimals,
      },
    };
  }

  if (tokenOut && solIn) {
    return {
      type: "swap",
      swapFields: {
        swapFromMint: tokenOut.mint,
        swapFromAmount: formatTokenAmountFromRaw({
          absRaw: tokenOut.absRaw,
          decimals: tokenOut.decimals,
          maxFractionDigits: 6,
        }),
        swapFromDecimals: tokenOut.decimals,
        swapToMint: NATIVE_SOL_MINT,
        swapToAmount: formatTokenAmountFromRaw({
          absRaw: BigInt(params.netChangeLamports),
          decimals: NATIVE_SOL_DECIMALS,
          maxFractionDigits: 6,
        }),
        swapToDecimals: NATIVE_SOL_DECIMALS,
      },
    };
  }

  return { type, swapFields: {} };
}

const mapTransactionToTransfer = (
  tx: ParsedTransactionWithMeta,
  signature: string,
  walletAddress: string,
  onlySystemTransfers: boolean,
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
    (key) => accountKeyToString(key) === walletAddress,
  );

  const isSigner =
    accountIndex >= 0 &&
    !!(message.accountKeys[accountIndex] as { signer?: boolean })?.signer;

  const systemTransfer = findSystemTransfer(
    message,
    innerInstructions,
    walletAddress,
  );
  if (onlySystemTransfers && !systemTransfer) return null;

  const allTokenChanges = onlySystemTransfers
    ? []
    : findAllTokenBalanceChanges(message, safeMeta, walletAddress);
  const tokenChange =
    allTokenChanges.length > 0
      ? allTokenChanges.reduce((best, c) =>
          c.absRaw > best.absRaw ? c : best,
        )
      : null;

  if (accountIndex === -1 && !tokenChange) return null;

  const preLamports =
    accountIndex === -1 ? 0 : safeMeta.preBalances?.[accountIndex] ?? 0;
  const postLamports =
    accountIndex === -1 ? 0 : safeMeta.postBalances?.[accountIndex] ?? 0;
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
        )[],
    ),
  ].filter(
    (ix): ix is PartiallyDecodedInstruction =>
      "data" in ix &&
      typeof (ix as PartiallyDecodedInstruction).data === "string",
  );

  const knownInstructionTypes: WalletTransfer["type"][] = [
    "verify_telegram_init_data",
    "store",
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
      decodeTelegramTransferInstruction,
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

  const decodedInstructions = allInstructionsWithData
    .map((ix) => decodeInstructionData(ix.data))
    .filter(
      (decoded): decoded is NonNullable<typeof decoded> => decoded !== null,
    );

  // First shield for a given mint bundles initialize_deposit +
  // modify_balance + create_permission + delegate_deposit into one tx.
  // A plain .find() returned `initialize_deposit`, which is not a
  // shield/unshield type — the UI then rendered the tx as a generic
  // "SOL Sent" row. `modify_balance` is the canonical shield/unshield
  // marker; when present it must win regardless of instruction order.
  const decodedInstruction =
    decodedInstructions.find((decoded) => decoded.name === "modify_balance") ??
    decodedInstructions[0];

  const decodedType = decodedInstruction?.name;

  let type: WalletTransfer["type"] =
    decodedType &&
    knownInstructionTypes.includes(decodedType as WalletTransfer["type"])
      ? (decodedType as WalletTransfer["type"])
      : "transfer";

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
          )[],
      ),
    ].some(
      (ix) =>
        "programId" in ix && ix.programId?.toBase58?.() === JUPITER_PROGRAM_ID,
    );

  const classification = classifySwap({
    currentType: type,
    allTokenChanges,
    netChangeLamports,
    isSigner,
    isJupiterSwap,
  });
  type = classification.type;
  const swapFields = classification.swapFields;

  const direction: "in" | "out" =
    type === "swap"
      ? "out"
      : isTokenTransfer || isSecureWithToken
        ? tokenChange!.direction
        : solDirection;
  const amountLamports =
    type === "swap"
      ? solAmountLamports
      : isTokenTransfer || isSecureWithToken
        ? 0
        : solAmountLamports;

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
  options: GetAccountTransactionHistoryOptions = {},
): Promise<{ transfers: WalletTransfer[]; nextCursor?: string }> => {
  const connection = getConnection();

  const signatures = await connection.getSignaturesForAddress(publicKey, {
    limit: options.limit ?? 10,
    before: options.before,
    until: options.until,
  });

  if (signatures.length === 0) {
    return { transfers: [], nextCursor: undefined };
  }

  const signatureList = signatures.map((s) => s.signature);
  const parsedTransactions = await connection.getParsedTransactions(
    signatureList,
    {
      maxSupportedTransactionVersion: 0,
    },
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
      options.onlySystemTransfers ?? false,
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
  options: ListenForAccountTransactionsOptions = {},
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

  let subscriptionId: number;
  try {
    subscriptionId = await connection.onLogs(
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
            options.onlySystemTransfers ?? false,
          );
          if (transfer) {
            onTransfer(transfer);
          }
        } catch (err) {
          console.error("[ws/txs] Error handling websocket transaction", err);
        }
      },
      "confirmed",
    );
  } catch (error) {
    console.error("[ws/txs] onLogs subscription setup failed", error);
    throw error;
  }

  return async () => {
    try {
      await connection.removeOnLogsListener(subscriptionId);
    } catch (error) {
      console.error("[ws/txs] Failed to remove onLogs listener", error);
    }
  };
};
