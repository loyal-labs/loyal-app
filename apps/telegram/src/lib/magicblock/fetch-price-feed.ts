import { PublicKey } from "@solana/web3.js";

import { getEphemeralConnection } from "./connection";
import {
  PRICE_PROGRAM_ID,
  SOLANA_FEED,
  SOLANA_PYTH_LAZER_PRICE_OFFSET,
} from "./constants";

function deriveFeedAddress(feedId: string): PublicKey {
  const [addr] = PublicKey.findProgramAddressSync(
    [Buffer.from("price_feed"), Buffer.from("pyth-lazer"), Buffer.from(feedId)],
    PRICE_PROGRAM_ID
  );
  return addr;
}

function fetchSolanaPythLazerFeedAddress() {
  return deriveFeedAddress(SOLANA_FEED.id);
}

export const fetchSolUsdPrice = async () => {
  const address = fetchSolanaPythLazerFeedAddress();
  const ephemeralConnection = getEphemeralConnection();
  const accountInfo = await ephemeralConnection.getAccountInfo(address, {
    commitment: "confirmed",
  });

  if (!accountInfo) {
    throw new Error("Account not found");
  }

  const dv = new DataView(
    accountInfo.data.buffer,
    accountInfo.data.byteOffset,
    accountInfo.data.byteLength
  );
  const raw = dv.getBigUint64(SOLANA_PYTH_LAZER_PRICE_OFFSET, true);
  const price = Number(raw) * Math.pow(10, SOLANA_FEED.exponent);
  return price;
};
