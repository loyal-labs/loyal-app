import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  getAuthToken,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  PERMISSION_PROGRAM_ID,
  permissionPdaFromAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  createAssociatedTokenAccountIdempotent,
  createMint,
  getAssociatedTokenAddressSync,
  mintToChecked,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Ed25519Program,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import fs from "fs";
import os from "os";
import path from "path";
import telegramPrivateTransferIdl from "../target/idl/telegram_private_transfer.json";
import telegramVerificationIdl from "../target/idl/telegram_verification.json";
import { TelegramPrivateTransfer } from "../target/types/telegram_private_transfer";
import { TelegramVerification } from "../target/types/telegram_verification";
import { sign } from "tweetnacl";

const DEPOSIT_PDA_SEED = Buffer.from("deposit_v2");
const USERNAME_DEPOSIT_PDA_SEED = Buffer.from("username_deposit_v2");
const VAULT_PDA_SEED = Buffer.from("vault");

const VALIDATION_BYTES: Uint8Array = new Uint8Array([
  56, 48, 54, 53, 49, 52, 48, 52, 57, 57, 58, 87, 101, 98, 65, 112, 112, 68,
  97, 116, 97, 10, 97, 117, 116, 104, 95, 100, 97, 116, 101, 61, 49, 55, 54,
  51, 53, 57, 56, 51, 55, 53, 10, 99, 104, 97, 116, 95, 105, 110, 115, 116,
  97, 110, 99, 101, 61, 45, 52, 53, 57, 55, 56, 48, 55, 53, 56, 53, 54, 55,
  51, 56, 52, 53, 53, 55, 49, 10, 99, 104, 97, 116, 95, 116, 121, 112, 101,
  61, 115, 101, 110, 100, 101, 114, 10, 117, 115, 101, 114, 61, 123, 34,
  105, 100, 34, 58, 56, 49, 51, 56, 55, 57, 55, 55, 54, 55, 44, 34, 102,
  105, 114, 115, 116, 95, 110, 97, 109, 101, 34, 58, 34, 84, 114, 97, 118,
  105, 115, 34, 44, 34, 108, 97, 115, 116, 95, 110, 97, 109, 101, 34, 58,
  34, 34, 44, 34, 117, 115, 101, 114, 110, 97, 109, 101, 34, 58, 34, 100,
  105, 103, 49, 51, 51, 55, 49, 51, 51, 51, 55, 34, 44, 34, 108, 97, 110,
  103, 117, 97, 103, 101, 95, 99, 111, 100, 101, 34, 58, 34, 101, 110, 34,
  44, 34, 97, 108, 108, 111, 119, 115, 95, 119, 114, 105, 116, 101, 95, 116,
  111, 95, 112, 109, 34, 58, 116, 114, 117, 101, 44, 34, 112, 104, 111, 116,
  111, 95, 117, 114, 108, 34, 58, 34, 104, 116, 116, 112, 115, 58, 92, 47,
  92, 47, 116, 46, 109, 101, 92, 47, 105, 92, 47, 117, 115, 101, 114, 112,
  105, 99, 92, 47, 51, 50, 48, 92, 47, 120, 99, 90, 85, 85, 85, 87, 51, 117,
  74, 50, 99, 79, 80, 86, 73, 81, 85, 111, 99, 104, 105, 119, 72, 99, 56,
  113, 118, 114, 56, 106, 114, 108, 66, 56, 74, 45, 72, 88, 120, 105, 112,
  98, 83, 74, 76, 122, 122, 118, 120, 73, 99, 79, 106, 55, 103, 55, 70, 49,
  69, 78, 116, 72, 71, 46, 115, 118, 103, 34, 125,
]);

const VALIDATION_SIGNATURE_BYTES: Uint8Array = new Uint8Array([
  139, 171, 57, 233, 145, 1, 218, 227, 29, 106, 55, 30, 237, 207, 28, 229,
  22, 234, 202, 160, 221, 31, 219, 251, 151, 181, 118, 207, 216, 254, 57, 79,
  209, 9, 176, 4, 81, 224, 69, 253, 250, 110, 16, 143, 73, 60, 35, 61, 66,
  177, 139, 178, 153, 248, 2, 121, 161, 49, 224, 103, 190, 108, 234, 4,
]);

const VALIDATION_USERNAME = "dig133713337";
const TELEGRAM_ED25519_PUBKEY = Buffer.from(
  "e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d",
  "hex"
);
const ER_VALIDATOR = new PublicKey(
  process.env.ER_VALIDATOR ??
    process.env.MAGICBLOCK_VALIDATOR ??
    "mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev"
);

const DEFAULT_DECIMALS = Number(process.env.DECIMALS ?? "6");
const DEFAULT_AMOUNT = BigInt(process.env.DEFAULT_AMOUNT ?? "1000000");
const STATE_PATH =
  process.env.STATE_PATH ??
  path.join(process.cwd(), "scripts", ".state", "telegram-private-transfer.json");

const usage = () => {
  console.log(`Usage: bun scripts/telegram-private-transfer.ts <delegate|send|subscribe|claim|undelegate>

Env:
  PROVIDER_ENDPOINT / ANCHOR_PROVIDER_URL  RPC endpoint (default http://127.0.0.1:8899)
  WS_ENDPOINT                              WS endpoint (default derived from RPC)
  EPHEMERAL_PROVIDER_ENDPOINT              ER RPC endpoint (default http://127.0.0.1:7799)
  EPHEMERAL_WS_ENDPOINT                    ER WS endpoint (default ws://127.0.0.1:7800)
  EPHEMERAL_AUTH                           if true, fetch MagicBlock auth token
  ER_VALIDATOR                             ER validator pubkey (default mAGicPQY...)
  COMMITMENT                               processed|confirmed|finalized (default confirmed)
  SENDER_KEYPAIR                           sender keypair path (default ~/.config/solana/id.json)
  CLAIMER_KEYPAIR                          claimer keypair path (default ~/.config/solana/id.json)
  TOKEN_MINT                               override mint (otherwise use state)
  STATE_PATH                               state file path (default scripts/.state/telegram-private-transfer.json)
  DEPOSIT_AMOUNT                           amount to lock into sender deposit (raw, default SEND_AMOUNT)
  SEND_AMOUNT                              amount to send (raw, default DEFAULT_AMOUNT)
  CLAIM_AMOUNT                             amount to claim (raw, default DEFAULT_AMOUNT)
  TARGET_AMOUNT                            stop subscribe when amount >= TARGET_AMOUNT
  AIRDROP                                 if true, request airdrop on localnet when balance low
`);
};

type ScriptState = {
  tokenMint?: string;
};

const readState = (): ScriptState => {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as ScriptState;
  } catch {
    return {};
  }
};

const writeState = (state: ScriptState) => {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
};

const resolvePath = (filePath: string) => {
  if (filePath.startsWith("~")) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
};

const loadKeypair = (filePath: string): Keypair => {
  const resolved = resolvePath(filePath);
  const raw = JSON.parse(fs.readFileSync(resolved, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
};

const deriveWsEndpoint = (rpcEndpoint: string) =>
  rpcEndpoint.replace(/^http:/, "ws:").replace(/^https:/, "wss:");

const getBaseConnection = () => {
  const rpcEndpoint =
    process.env.PROVIDER_ENDPOINT ??
    process.env.ANCHOR_PROVIDER_URL ??
    "http://127.0.0.1:8899";
  const defaultWs = deriveWsEndpoint(rpcEndpoint).replace(
    /:8899(\/?)$/,
    ":8900$1"
  );
  const wsEndpoint = process.env.WS_ENDPOINT ?? defaultWs;
  const commitment =
    (process.env.COMMITMENT as anchor.web3.Commitment) ?? "confirmed";
  return {
    rpcEndpoint,
    wsEndpoint,
    commitment,
    connection: new Connection(rpcEndpoint, {
      wsEndpoint,
      commitment,
    }),
  };
};

const getEphemeralConnection = () => {
  const rpcEndpoint =
    process.env.EPHEMERAL_PROVIDER_ENDPOINT ?? "http://127.0.0.1:7799";
  const defaultWs =
    process.env.EPHEMERAL_WS_ENDPOINT ??
    (rpcEndpoint.includes("127.0.0.1") || rpcEndpoint.includes("localhost")
      ? "ws://127.0.0.1:7800"
      : deriveWsEndpoint(rpcEndpoint));
  const commitment =
    (process.env.COMMITMENT as anchor.web3.Commitment) ?? "confirmed";
  return {
    rpcEndpoint,
    wsEndpoint: defaultWs,
    commitment,
    connection: new Connection(rpcEndpoint, {
      wsEndpoint: defaultWs,
      commitment,
    }),
  };
};

const maybeAirdrop = async (connection: Connection, pubkey: PublicKey) => {
  const allowAirdrop =
    process.env.AIRDROP === "true" ||
    connection.rpcEndpoint.includes("127.0.0.1") ||
    connection.rpcEndpoint.includes("localhost");
  if (!allowAirdrop) return;
  const balance = await connection.getBalance(pubkey, "confirmed");
  if (balance > 0.2 * LAMPORTS_PER_SOL) return;
  const sig = await connection.requestAirdrop(pubkey, 1 * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, "confirmed");
};

const appendToken = (url: string, token: string) =>
  url.includes("?") ? `${url}&token=${token}` : `${url}?token=${token}`;

const buildProvider = (
  connection: Connection,
  wallet: anchor.Wallet,
  commitment: anchor.web3.Commitment
) =>
  new anchor.AnchorProvider(connection, wallet, {
    commitment,
    preflightCommitment: commitment,
  });

const buildEphemeralProvider = async (
  config: ReturnType<typeof getEphemeralConnection>,
  keypair: Keypair
) => {
  const hasToken =
    config.rpcEndpoint.includes("token=") || config.wsEndpoint.includes("token=");
  const useAuth =
    process.env.EPHEMERAL_AUTH === "true" ||
    (!hasToken &&
      (config.rpcEndpoint.includes("magicblock.app") ||
        config.rpcEndpoint.includes("tee.magicblock.app") ||
        config.rpcEndpoint.includes("mainnet-tee.magicblock.app")));
  let rpcEndpoint = config.rpcEndpoint;
  let wsEndpoint = config.wsEndpoint;
  if (useAuth) {
    const { token } = await getAuthToken(
      config.rpcEndpoint,
      keypair.publicKey,
      async (message) => sign.detached(message, keypair.secretKey)
    );
    rpcEndpoint = appendToken(rpcEndpoint, token);
    wsEndpoint = appendToken(wsEndpoint, token);
  }
  const connection = new Connection(rpcEndpoint, {
    wsEndpoint,
    commitment: config.commitment,
  });
  return buildProvider(connection, new anchor.Wallet(keypair), config.commitment);
};

const getPrograms = (provider: anchor.AnchorProvider) => {
  const privateTransfer = new Program<TelegramPrivateTransfer>(
    telegramPrivateTransferIdl as TelegramPrivateTransfer,
    provider
  );
  const verification = new Program<TelegramVerification>(
    telegramVerificationIdl as TelegramVerification,
    provider
  );
  return { privateTransfer, verification };
};

const parseAmount = (envKey: string, fallback: bigint) => {
  const raw = process.env[envKey];
  const value = raw ? BigInt(raw) : fallback;
  return {
    raw: value,
    bn: new anchor.BN(value.toString()),
  };
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const waitForTokenMint = async (): Promise<string> => {
  while (true) {
    const current = readState();
    if (current.tokenMint) {
      return current.tokenMint;
    }
    console.log("waiting for token mint in state...");
    await sleep(1000);
  }
};

const ensureMint = async (
  connection: Connection,
  payer: Keypair,
  state: ScriptState
) => {
  if (state.tokenMint) {
    const existing = new PublicKey(state.tokenMint);
    const info = await connection.getAccountInfo(existing);
    if (info) {
      return existing;
    }
  }
  const mint = await createMint(
    connection,
    payer,
    payer.publicKey,
    null,
    DEFAULT_DECIMALS,
    undefined,
    undefined,
    TOKEN_PROGRAM_ID
  );
  state.tokenMint = mint.toBase58();
  writeState(state);
  return mint;
};

const ensureAta = async (
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey
) =>
  createAssociatedTokenAccountIdempotent(
    connection,
    payer,
    mint,
    owner,
    undefined,
    TOKEN_PROGRAM_ID
  );

const ensureTokenBalance = async (
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  tokenAccount: PublicKey,
  amount: bigint
) => {
  const balance = await connection.getTokenAccountBalance(tokenAccount);
  const current = BigInt(balance.value.amount);
  if (current >= amount) return;
  const toMint = amount - current;
  await mintToChecked(
    connection,
    payer,
    mint,
    tokenAccount,
    payer.publicKey,
    toMint,
    DEFAULT_DECIMALS,
    undefined,
    undefined,
    TOKEN_PROGRAM_ID
  );
};

const getUsernameDepositPda = (programId: PublicKey, mint: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [USERNAME_DEPOSIT_PDA_SEED, Buffer.from(VALIDATION_USERNAME), mint.toBuffer()],
    programId
  )[0];

const getDepositPda = (programId: PublicKey, user: PublicKey, mint: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [DEPOSIT_PDA_SEED, user.toBuffer(), mint.toBuffer()],
    programId
  )[0];

const getVaultPda = (programId: PublicKey, mint: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [VAULT_PDA_SEED, mint.toBuffer()],
    programId
  )[0];

const getSessionPda = (programId: PublicKey, user: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("tg_session_v2"), user.toBuffer()],
    programId
  )[0];

const ensureVerifiedSession = async (
  connection: Connection,
  verificationProgram: Program<TelegramVerification>,
  claimer: Keypair
) => {
  const sessionPda = getSessionPda(verificationProgram.programId, claimer.publicKey);
  try {
    const existing = await verificationProgram.account.telegramSession.fetch(
      sessionPda
    );
    if (existing.verified) {
      return sessionPda;
    }
  } catch {
    // Fall through and create.
  }

  await verificationProgram.methods
    .store(Buffer.from(VALIDATION_BYTES))
    .accounts({
      payer: claimer.publicKey,
      user: claimer.publicKey,
      session: sessionPda,
      systemProgram: SystemProgram.programId,
    })
    .signers([claimer])
    .rpc({ commitment: "confirmed" });

  const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
    publicKey: TELEGRAM_ED25519_PUBKEY,
    message: VALIDATION_BYTES,
    signature: VALIDATION_SIGNATURE_BYTES,
  });

  const verifyIx = await verificationProgram.methods
    .verifyTelegramInitData()
    .accounts({
      session: sessionPda,
      instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
    })
    .instruction();

  const tx = new Transaction().add(ed25519Ix, verifyIx);
  tx.feePayer = claimer.publicKey;
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.sign(claimer);
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
  });
  await connection.confirmTransaction(sig, "confirmed");

  return sessionPda;
};

const command = process.argv[2];
if (
  !command ||
  !["delegate", "send", "subscribe", "claim", "undelegate"].includes(command)
) {
  usage();
  process.exit(1);
}

const main = async () => {
  const state = readState();
  const base = getBaseConnection();
  const er = getEphemeralConnection();

  if (command === "delegate") {
    const sender = loadKeypair(
      process.env.SENDER_KEYPAIR ?? "~/.config/solana/id.json"
    );
    const claimer = loadKeypair(
      process.env.CLAIMER_KEYPAIR ?? "~/.config/solana/id.json"
    );
    await maybeAirdrop(base.connection, sender.publicKey);
    await maybeAirdrop(base.connection, claimer.publicKey);

    const senderProvider = buildProvider(
      base.connection,
      new anchor.Wallet(sender),
      base.commitment
    );
    const claimerProvider = buildProvider(
      base.connection,
      new anchor.Wallet(claimer),
      base.commitment
    );
    const senderPrograms = getPrograms(senderProvider);
    const claimerPrograms = getPrograms(claimerProvider);

    const mint = process.env.TOKEN_MINT
      ? new PublicKey(process.env.TOKEN_MINT)
      : await ensureMint(base.connection, sender, state);
    if (state.tokenMint !== mint.toBase58()) {
      state.tokenMint = mint.toBase58();
      writeState(state);
    }

    const senderAta = await ensureAta(
      base.connection,
      sender,
      mint,
      sender.publicKey
    );

    const { raw: depositRaw, bn: depositBn } = parseAmount(
      "DEPOSIT_AMOUNT",
      BigInt(process.env.SEND_AMOUNT ?? DEFAULT_AMOUNT.toString())
    );
    await ensureTokenBalance(base.connection, sender, mint, senderAta, depositRaw);

    const depositPda = getDepositPda(
      senderPrograms.privateTransfer.programId,
      sender.publicKey,
      mint
    );
    const usernameDepositPda = getUsernameDepositPda(
      senderPrograms.privateTransfer.programId,
      mint
    );
    const vaultPda = getVaultPda(senderPrograms.privateTransfer.programId, mint);
    const vaultTokenAccount = getAssociatedTokenAddressSync(
      mint,
      vaultPda,
      true,
      TOKEN_PROGRAM_ID
    );

    await senderPrograms.privateTransfer.methods
      .initializeDeposit()
      .accountsPartial({
        user: sender.publicKey,
        deposit: depositPda,
        tokenMint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc({ skipPreflight: true });

    const depositAccount =
      await senderPrograms.privateTransfer.account.deposit.fetch(depositPda);
    const desired = BigInt(depositBn.toString());
    const current = BigInt(depositAccount.amount.toString());
    if (current < desired) {
      const diff = new anchor.BN((desired - current).toString());
      await senderPrograms.privateTransfer.methods
        .modifyBalance({ amount: diff, increase: true })
        .accountsPartial({
          user: sender.publicKey,
          payer: sender.publicKey,
          deposit: depositPda,
          userTokenAccount: senderAta,
          vault: vaultPda,
          vaultTokenAccount,
          tokenMint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([sender])
        .rpc({ skipPreflight: true });
    }

    const usernameInfo = await base.connection.getAccountInfo(
      usernameDepositPda
    );
    if (!usernameInfo) {
      await senderPrograms.privateTransfer.methods
        .depositForUsername(VALIDATION_USERNAME, new anchor.BN(0))
        .accountsPartial({
          payer: sender.publicKey,
          depositor: sender.publicKey,
          deposit: usernameDepositPda,
          vault: vaultPda,
          vaultTokenAccount,
          depositorTokenAccount: senderAta,
          tokenMint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([sender])
        .rpc({ skipPreflight: true });
    }

    const depositPermission = permissionPdaFromAccount(depositPda);
    await senderPrograms.privateTransfer.methods
      .createPermission()
      .accountsPartial({
        payer: sender.publicKey,
        user: sender.publicKey,
        deposit: depositPda,
        permission: depositPermission,
        permissionProgram: PERMISSION_PROGRAM_ID,
      })
      .signers([sender])
      .rpc({ skipPreflight: true });

    await senderPrograms.privateTransfer.methods
      .delegate(sender.publicKey, mint)
      .accountsPartial({
        payer: sender.publicKey,
        deposit: depositPda,
        validator: ER_VALIDATOR,
      })
      .signers([sender])
      .rpc({ skipPreflight: true });

    const sessionPda = await ensureVerifiedSession(
      base.connection,
      claimerPrograms.verification,
      claimer
    );
    const usernamePermission = permissionPdaFromAccount(usernameDepositPda);
    await claimerPrograms.privateTransfer.methods
      .createUsernamePermission()
      .accountsPartial({
        payer: claimer.publicKey,
        authority: claimer.publicKey,
        session: sessionPda,
        deposit: usernameDepositPda,
        permission: usernamePermission,
        permissionProgram: PERMISSION_PROGRAM_ID,
      })
      .signers([claimer])
      .rpc({ skipPreflight: true });

    await claimerPrograms.privateTransfer.methods
      .delegateUsernameDeposit(VALIDATION_USERNAME, mint)
      .accountsPartial({
        payer: claimer.publicKey,
        deposit: usernameDepositPda,
        validator: ER_VALIDATOR,
        session: sessionPda,
      })
      .signers([claimer])
      .rpc({ skipPreflight: true });

    console.log("delegate ok");
    console.log("token mint", mint.toBase58());
    console.log("deposit pda", depositPda.toBase58());
    console.log("username deposit pda", usernameDepositPda.toBase58());
    return;
  }

  if (command === "send") {
    const sender = loadKeypair(
      process.env.SENDER_KEYPAIR ?? "~/.config/solana/id.json"
    );
    const tokenMint =
      process.env.TOKEN_MINT ?? state.tokenMint ?? (await waitForTokenMint());
    const mint = new PublicKey(tokenMint);
    const { bn: sendBn } = parseAmount("SEND_AMOUNT", DEFAULT_AMOUNT);

    const erProvider = await buildEphemeralProvider(er, sender);
    const { privateTransfer } = getPrograms(erProvider);
    const depositPda = getDepositPda(
      privateTransfer.programId,
      sender.publicKey,
      mint
    );
    const usernameDepositPda = getUsernameDepositPda(
      privateTransfer.programId,
      mint
    );

    const sig = await privateTransfer.methods
      .transferToUsernameDeposit(sendBn)
      .accountsPartial({
        user: sender.publicKey,
        payer: sender.publicKey,
        sourceDeposit: depositPda,
        destinationDeposit: usernameDepositPda,
        sessionToken: null,
        tokenMint: mint,
      })
      .signers([sender])
      .rpc({ skipPreflight: true });

    console.log("send sig", sig);
    console.log("token mint", mint.toBase58());
    console.log("username deposit pda", usernameDepositPda.toBase58());
    return;
  }

  if (command === "subscribe") {
    const claimer = loadKeypair(
      process.env.CLAIMER_KEYPAIR ?? "~/.config/solana/id.json"
    );
    const tokenMint =
      process.env.TOKEN_MINT ?? state.tokenMint ?? (await waitForTokenMint());
    const mint = new PublicKey(tokenMint);

    const erProvider = await buildEphemeralProvider(er, claimer);
    const { privateTransfer } = getPrograms(erProvider);
    const usernameDepositPda = getUsernameDepositPda(
      privateTransfer.programId,
      mint
    );

    const targetEnv = process.env.TARGET_AMOUNT ?? process.env.SEND_AMOUNT;
    const targetAmount = targetEnv ? BigInt(targetEnv) : null;
    let lastAmount: string | null = null;

    console.log("subscribing to", usernameDepositPda.toBase58());
    console.log("token mint", mint.toBase58());
    if (targetAmount !== null) {
      console.log("target amount", targetAmount.toString());
    }

    let subscriptionId: number | null = null;
    const onChange = async (info: anchor.web3.AccountInfo<Buffer>) => {
      try {
        const decoded = privateTransfer.coder.accounts.decode(
          "usernameDeposit",
          info.data
        ) as { amount: anchor.BN; username: string };
        const amount = decoded.amount.toString();
        if (amount !== lastAmount) {
          console.log("username", decoded.username, "amount", amount);
          lastAmount = amount;
        }
        if (targetAmount !== null && BigInt(amount) >= targetAmount) {
          console.log("target reached");
          if (subscriptionId !== null) {
            await erProvider.connection.removeAccountChangeListener(
              subscriptionId
            );
          }
          process.exit(0);
        }
      } catch (err) {
        console.error("decode error", err);
      }
    };

    subscriptionId = await erProvider.connection.onAccountChange(
      usernameDepositPda,
      onChange,
      er.commitment
    );

    const existing = await erProvider.connection.getAccountInfo(
      usernameDepositPda
    );
    if (existing) {
      await onChange(existing);
    } else {
      console.log("waiting for username deposit account to be created...");
    }

    process.stdin.resume();
    return;
  }

  if (command === "claim") {
    const claimer = loadKeypair(
      process.env.CLAIMER_KEYPAIR ?? "~/.config/solana/id.json"
    );
    await maybeAirdrop(base.connection, claimer.publicKey);

    const claimerProvider = buildProvider(
      base.connection,
      new anchor.Wallet(claimer),
      base.commitment
    );
    const { privateTransfer, verification } = getPrograms(claimerProvider);

    const tokenMint =
      process.env.TOKEN_MINT ??
      state.tokenMint ??
      (() => {
        throw new Error(
          "TOKEN_MINT not set and state missing. Run delegate first or set TOKEN_MINT."
        );
      })();
    const mint = new PublicKey(tokenMint);

    const { bn: claimBn } = parseAmount("CLAIM_AMOUNT", DEFAULT_AMOUNT);
    const recipientAta = await ensureAta(
      base.connection,
      claimer,
      mint,
      claimer.publicKey
    );

    const sessionPda = await ensureVerifiedSession(
      base.connection,
      verification,
      claimer
    );

    const usernameDepositPda = getUsernameDepositPda(
      privateTransfer.programId,
      mint
    );
    const vaultPda = getVaultPda(privateTransfer.programId, mint);
    const vaultTokenAccount = getAssociatedTokenAddressSync(
      mint,
      vaultPda,
      true,
      TOKEN_PROGRAM_ID
    );

    const sig = await privateTransfer.methods
      .claimUsernameDeposit(claimBn)
      .accountsPartial({
        recipientTokenAccount: recipientAta,
        vault: vaultPda,
        vaultTokenAccount,
        deposit: usernameDepositPda,
        tokenMint: mint,
        session: sessionPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc({ skipPreflight: true });

    console.log("claim sig", sig);
    console.log("recipient ata", recipientAta.toBase58());
    return;
  }

  if (command === "undelegate") {
    const sender = loadKeypair(
      process.env.SENDER_KEYPAIR ?? "~/.config/solana/id.json"
    );
    const claimer = loadKeypair(
      process.env.CLAIMER_KEYPAIR ?? "~/.config/solana/id.json"
    );

    const tokenMint =
      process.env.TOKEN_MINT ??
      state.tokenMint ??
      (() => {
        throw new Error(
          "TOKEN_MINT not set and state missing. Run delegate first or set TOKEN_MINT."
        );
      })();
    const mint = new PublicKey(tokenMint);

    const sessionPda = await ensureVerifiedSession(
      base.connection,
      getPrograms(
        buildProvider(
          base.connection,
          new anchor.Wallet(claimer),
          base.commitment
        )
      ).verification,
      claimer
    );

    const erProviderSender = await buildEphemeralProvider(er, sender);
    const erProviderClaimer = await buildEphemeralProvider(er, claimer);
    const erSenderPrograms = getPrograms(erProviderSender);
    const erClaimerPrograms = getPrograms(erProviderClaimer);

    const depositPda = getDepositPda(
      erSenderPrograms.privateTransfer.programId,
      sender.publicKey,
      mint
    );
    const usernameDepositPda = getUsernameDepositPda(
      erSenderPrograms.privateTransfer.programId,
      mint
    );

    const sig1 = await erSenderPrograms.privateTransfer.methods
      .undelegate()
      .accountsPartial({
        user: sender.publicKey,
        payer: sender.publicKey,
        deposit: depositPda,
        sessionToken: null,
        magicProgram: MAGIC_PROGRAM_ID,
        magicContext: MAGIC_CONTEXT_ID,
      })
      .signers([sender])
      .rpc({ skipPreflight: true });

    const sig2 = await erClaimerPrograms.privateTransfer.methods
      .undelegateUsernameDeposit(VALIDATION_USERNAME, mint)
      .accountsPartial({
        payer: claimer.publicKey,
        deposit: usernameDepositPda,
        magicProgram: MAGIC_PROGRAM_ID,
        magicContext: MAGIC_CONTEXT_ID,
        session: sessionPda,
      })
      .signers([claimer])
      .rpc({ skipPreflight: true });

    console.log("undelegate sig deposit", sig1);
    console.log("undelegate sig username", sig2);
    return;
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
