import "server-only";
import { getPrivyClient } from "./config";

export async function authenticatePrivyWallet(
  request: Request,
  claimedWallet: string
) {
  const identityToken = request.headers.get("privy-id-token");
  if (!identityToken) throw new Error("Missing Privy identity token.");
  const user = await getPrivyClient().users().get({ id_token: identityToken });
  const ownsWallet = user.linked_accounts.some(
    (account) =>
      account.type === "wallet" &&
      "chain_type" in account &&
      account.chain_type === "solana" &&
      account.address === claimedWallet &&
      "connector_type" in account &&
      account.connector_type === "embedded"
  );
  if (!ownsWallet)
    throw new Error(
      "Wallet is not the authenticated user's Privy embedded Solana wallet."
    );
  return user;
}
