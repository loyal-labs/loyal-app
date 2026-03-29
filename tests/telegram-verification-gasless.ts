import * as anchor from "@coral-xyz/anchor";
import { BN, Program, web3 } from "@coral-xyz/anchor";
import { expect } from "chai";
import { TelegramPrivateTransfer } from "../target/types/telegram_private_transfer";

import {
  Transaction,
  SystemProgram,
  PublicKey,
  Keypair,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { TelegramVerification } from "../target/types/telegram_verification";
import { Ed25519Program } from "@solana/web3.js";
import { publicKey } from "@coral-xyz/anchor/dist/cjs/utils";
import { SYSVAR_INSTRUCTIONS_PUBKEY } from "@solana/web3.js";
import bs58 from "bs58";

// --- Testing fixtures ---
const VALIDATION_BYTES: Uint8Array = new Uint8Array([
  56, 48, 54, 53, 49, 52, 48, 52, 57, 57, 58, 87, 101, 98, 65, 112, 112, 68, 97,
  116, 97, 10, 97, 117, 116, 104, 95, 100, 97, 116, 101, 61, 49, 55, 54, 51, 53,
  57, 56, 51, 55, 53, 10, 99, 104, 97, 116, 95, 105, 110, 115, 116, 97, 110, 99,
  101, 61, 45, 52, 53, 57, 55, 56, 48, 55, 53, 56, 53, 54, 55, 51, 56, 52, 53,
  53, 55, 49, 10, 99, 104, 97, 116, 95, 116, 121, 112, 101, 61, 115, 101, 110,
  100, 101, 114, 10, 117, 115, 101, 114, 61, 123, 34, 105, 100, 34, 58, 56, 49,
  51, 56, 55, 57, 55, 55, 54, 55, 44, 34, 102, 105, 114, 115, 116, 95, 110, 97,
  109, 101, 34, 58, 34, 84, 114, 97, 118, 105, 115, 34, 44, 34, 108, 97, 115,
  116, 95, 110, 97, 109, 101, 34, 58, 34, 34, 44, 34, 117, 115, 101, 114, 110,
  97, 109, 101, 34, 58, 34, 100, 105, 103, 49, 51, 51, 55, 49, 51, 51, 51, 55,
  34, 44, 34, 108, 97, 110, 103, 117, 97, 103, 101, 95, 99, 111, 100, 101, 34,
  58, 34, 101, 110, 34, 44, 34, 97, 108, 108, 111, 119, 115, 95, 119, 114, 105,
  116, 101, 95, 116, 111, 95, 112, 109, 34, 58, 116, 114, 117, 101, 44, 34, 112,
  104, 111, 116, 111, 95, 117, 114, 108, 34, 58, 34, 104, 116, 116, 112, 115,
  58, 92, 47, 92, 47, 116, 46, 109, 101, 92, 47, 105, 92, 47, 117, 115, 101,
  114, 112, 105, 99, 92, 47, 51, 50, 48, 92, 47, 120, 99, 90, 85, 85, 85, 87,
  51, 117, 74, 50, 99, 79, 80, 86, 73, 81, 85, 111, 99, 104, 105, 119, 72, 99,
  56, 113, 118, 114, 56, 106, 114, 108, 66, 56, 74, 45, 72, 88, 120, 105, 112,
  98, 83, 74, 76, 122, 122, 118, 120, 73, 99, 79, 106, 55, 103, 55, 70, 49, 69,
  78, 116, 72, 71, 46, 115, 118, 103, 34, 125,
]);

const VALIDATION_SIGNATURE_BYTES: Uint8Array = new Uint8Array([
  139, 171, 57, 233, 145, 1, 218, 227, 29, 106, 55, 30, 237, 207, 28, 229, 22,
  234, 202, 160, 221, 31, 219, 251, 151, 181, 118, 207, 216, 254, 57, 79, 209,
  9, 176, 4, 81, 224, 69, 253, 250, 110, 16, 143, 73, 60, 35, 61, 66, 177, 139,
  178, 153, 248, 2, 121, 161, 49, 224, 103, 190, 108, 234, 4,
]);

const encodeAnchorStringFilter = (value: string): string => {
  const valueBytes = Buffer.from(value, "utf8");
  const filterBuf = Buffer.alloc(4 + valueBytes.length);
  filterBuf.writeUInt32LE(valueBytes.length, 0);
  valueBytes.copy(filterBuf, 4);
  return bs58.encode(filterBuf);
};

const VALIDATION_AUTH_DATE = 1763598375;
const VALIDATION_USERNAME = "dig133713337";

const TELEGRAM_PUBKEY_PROD_HEX =
  "e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d";
const TELEGRAM_PUBKEY_PROD_BYTES = Buffer.from(TELEGRAM_PUBKEY_PROD_HEX, "hex");
const TELEGRAM_PUBKEY_UINT8ARRAY = new Uint8Array(TELEGRAM_PUBKEY_PROD_BYTES);

describe.only("telegram-verification test suite", () => {
  const baseProvider = anchor.AnchorProvider.env();

  const userKp = web3.Keypair.generate();
  const user = userKp.publicKey;
  // const user = baseProvider.wallet.publicKey;
  const wallet = new anchor.Wallet(userKp);

  const otherUserKp = web3.Keypair.generate();
  const otherUser = otherUserKp.publicKey;
  const otherWallet = new anchor.Wallet(otherUserKp);

  const initialAmount = LAMPORTS_PER_SOL * 6;

  const provider = new anchor.AnchorProvider(
    baseProvider.connection,
    wallet,
    baseProvider.opts
  );

  // const provider = baseProvider;

  anchor.setProvider(baseProvider);

  const verificationProgram = anchor.workspace
    .TelegramVerification as Program<TelegramVerification>;
  const transferProgram = anchor.workspace
    .TelegramPrivateTransfer as Program<TelegramPrivateTransfer>;

  let sessionPda: PublicKey;
  let vaultPda: PublicKey;
  let depositPda: PublicKey;

  before(async () => {
    const { blockhash, lastValidBlockHeight } =
      await provider.connection.getLatestBlockhash();
    const signature = await provider.connection.requestAirdrop(
      user,
      initialAmount
    );

    await provider.connection.confirmTransaction(
      {
        signature,
        blockhash,
        lastValidBlockHeight,
      },
      "confirmed"
    );
  });

  it("[gasless] Create deposit for user A and put money in the vault", async () => {
    await transferProgram.methods
      .depositForUsername(VALIDATION_USERNAME, new BN(initialAmount / 2))
      .accounts({
        payer: user,
        depositor: user,
      })
      .signers([userKp])
      .rpc({ commitment: "confirmed" });

    [depositPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("deposit_v2"),
        user.toBuffer(),
        Buffer.from(VALIDATION_USERNAME),
      ],
      transferProgram.programId
    );

    const deposit = await transferProgram.account.deposit.fetch(depositPda);
    expect(deposit.amount.toNumber()).to.equal(initialAmount / 2);
    expect(deposit.user.toBase58()).to.equal(user.toBase58());
    expect(deposit.username).to.equal(VALIDATION_USERNAME);
  });

  it("[gasless] User B stores initData, User A acts as a payer", async () => {
    console.log("User A public key:", user.toBase58());
    console.log("User B public key:", otherUser.toBase58());

    [sessionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("tg_session"), otherUser.toBuffer()],
      verificationProgram.programId
    );

    const storeTx = await verificationProgram.methods
      .store(Buffer.from(VALIDATION_BYTES))
      .accounts({
        payer: user,
        user: otherUser,
        // @ts-ignore
        session: sessionPda,
        systemProgram: SystemProgram.programId,
      })
      .transaction();

    const { blockhash, lastValidBlockHeight } =
      await provider.connection.getLatestBlockhash();

    storeTx.feePayer = user;
    storeTx.recentBlockhash = blockhash;
    storeTx.lastValidBlockHeight = lastValidBlockHeight;

    await otherWallet.signTransaction(storeTx);
    await wallet.signTransaction(storeTx);

    const sig = await provider.connection.sendRawTransaction(
      storeTx.serialize(),
      {
        skipPreflight: false,
      }
    );
    await provider.connection.confirmTransaction(sig, "confirmed");

    const session = await verificationProgram.account.telegramSession.fetch(
      sessionPda
    );
    console.log("session:", session);
  });

  it("[gasless] User B verifies Telegram initData with native sysvar instructions", async () => {
    // this ix verifies ed25519 signature
    const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
      publicKey: TELEGRAM_PUBKEY_UINT8ARRAY,
      message: VALIDATION_BYTES,
      signature: VALIDATION_SIGNATURE_BYTES,
    });

    const verifyIx = await verificationProgram.methods
      .verifyTelegramInitData()
      .accounts({
        session: sessionPda,
        // @ts-ignore
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();

    const tx = new Transaction().add(ed25519Ix, verifyIx);
    tx.feePayer = user;
    const { blockhash } = await provider.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    await wallet.signTransaction(tx);

    let threw = false;
    try {
      const sig = await provider.connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
      });
      await provider.connection.confirmTransaction(sig, "confirmed");
    } catch (e) {
      threw = true;
      console.error("Error:", e);
    }
    expect(threw).to.eq(false);

    let session = await verificationProgram.account.telegramSession.fetch(
      sessionPda
    );
    expect(session.username).to.eq(VALIDATION_USERNAME);
    expect(session.verified).to.be.true;
    expect(session.verifiedAt).to.not.be.null;
  });

  it("User B claims deposit from user A with verified initData", async () => {
    [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault")],
      transferProgram.programId
    );
    let vault = await transferProgram.account.vault.fetch(vaultPda);
    const vaultBalanceInitial = vault.totalDeposited.toNumber();

    const claimTx = await transferProgram.methods
      .claimDeposit(new BN(initialAmount / 4))
      .accounts({
        recipient: otherUser,
        // @ts-ignore
        vault: vaultPda,
        deposit: depositPda,
        session: sessionPda,
      })
      .transaction();

    claimTx.feePayer = user;
    const { blockhash, lastValidBlockHeight } =
      await provider.connection.getLatestBlockhash();
    claimTx.recentBlockhash = blockhash;
    claimTx.lastValidBlockHeight = lastValidBlockHeight;
    await wallet.signTransaction(claimTx);

    const sig = await provider.connection.sendRawTransaction(
      claimTx.serialize(),
      {
        skipPreflight: false,
      }
    );
    await provider.connection.confirmTransaction(sig, "confirmed");

    const deposit = await transferProgram.account.deposit.fetch(depositPda);

    const otherUserBalance = await provider.connection.getBalance(otherUser);
    console.log("otherUserBalance:", otherUserBalance);
  });
});
