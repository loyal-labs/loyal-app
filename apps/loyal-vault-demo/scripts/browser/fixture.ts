import { readFileSync } from "node:fs";
import { address, isAddress } from "@solana/kit";
import { VersionedTransaction, PublicKey } from "@solana/web3.js";
import { buildUnsignedTransaction, deriveCanonicalUserAccounts, claimPreview } from "../../src/features/vault/domain/transactions";
import { transactionMessageDigest } from "../../src/features/vault/domain/client-transaction";
const wallet = process.argv[2];
if (!wallet || !isAddress(wallet)) throw new Error("Expected fixture wallet address");
const fixture = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8"));
const blockhash = new PublicKey(new Uint8Array(32).fill(process.argv[3] === "3" ? 3 : 2)).toBase58();
const built = await buildUnsignedTransaction({ wallet: address(wallet), action: "claim", amountRaw: null, withdrawAll: false,
  blockhash, lastValidBlockHeight: 100n, walletUsdcAtaExists: true, walletLpAtaExists: true });
if (!built.ok) throw new Error(built.reason);
fixture.quote.wallet = wallet;
fixture.quote.transaction = { ...built.transaction, lastValidBlockHeight: "100", messageSha256:
  await transactionMessageDigest(VersionedTransaction.deserialize(Buffer.from(built.transaction.wireBase64, "base64"))) };
fixture.quote.quote.validForBlockHeight = "100";
fixture.quote.preview = claimPreview({ escrowedLpRaw: 1000n, assetAtRequestRaw: "1000", assetEffectiveRaw: "1000", lpDecimals: 9, createsUsdcAta: false });
fixture.quote.observation.vaultSlot = fixture.quote.observation.positionSlot = 1;
const accounts = await deriveCanonicalUserAccounts(address(wallet));
fixture.position.wallet = fixture.position.receipt.user = wallet;
fixture.position.usdc.accountAddress = accounts.userAssetAta;
fixture.position.lp.accountAddress = accounts.userLpAta;
fixture.position.receipt.receiptAddress = accounts.receipt;
for (const amount of [fixture.position.escrowedLp, fixture.position.escrowTokenAccountBalance, fixture.position.receipt.escrowedLp]) amount.raw = "1000";
for (const key of ["assetAtRequestRaw", "assetAtPresentRaw", "assetEffectiveRaw"]) fixture.position.receipt[key] = "1000";
console.log(JSON.stringify(fixture));
