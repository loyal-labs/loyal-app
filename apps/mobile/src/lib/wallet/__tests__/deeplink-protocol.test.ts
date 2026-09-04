// Guards the Phantom/Solflare deeplink encryption/session contract
// (docs.phantom.com deeplinks; Solflare mirrors it). The connect handshake
// must derive the same x25519 shared secret the wallet derives, our request
// payloads must decrypt on the wallet side, wallet responses must decrypt on
// ours, and error redirects must classify without touching crypto. All of it
// still compiles while broken, so it is asserted against a simulated wallet.

import bs58 from "bs58";
import nacl from "tweetnacl";

import {
  buildRequestUrl,
  decryptResponseData,
  DeeplinkResponseError,
  generateDappKeypair,
  parseConnectResponse,
} from "../deeplink-protocol";

type WalletSide = {
  encryptionPublicKey: string;
  sharedSecret: Uint8Array;
  encrypt: (payload: Record<string, unknown>) => { nonce: string; data: string };
  decrypt: (nonceB58: string, payloadB58: string) => Record<string, unknown>;
};

// The wallet's half of the Diffie-Hellman exchange, per the spec.
function makeWallet(dappPublicKey: string): WalletSide {
  const pair = nacl.box.keyPair();
  const sharedSecret = nacl.box.before(
    bs58.decode(dappPublicKey),
    pair.secretKey,
  );
  return {
    encryptionPublicKey: bs58.encode(pair.publicKey),
    sharedSecret,
    encrypt: (payload) => {
      const nonce = nacl.randomBytes(24);
      const data = nacl.box.after(
        new Uint8Array(Buffer.from(JSON.stringify(payload), "utf8")),
        nonce,
        sharedSecret,
      );
      return { nonce: bs58.encode(nonce), data: bs58.encode(data) };
    },
    decrypt: (nonceB58, payloadB58) => {
      const opened = nacl.box.open.after(
        bs58.decode(payloadB58),
        bs58.decode(nonceB58),
        sharedSecret,
      );
      if (!opened) throw new Error("wallet could not decrypt payload");
      return JSON.parse(Buffer.from(opened).toString("utf8"));
    },
  };
}

describe("deeplink connect handshake", () => {
  it("derives the wallet's shared secret and decrypts the session grant", async () => {
    const dapp = await generateDappKeypair();
    const wallet = makeWallet(dapp.publicKey);
    const { nonce, data } = wallet.encrypt({
      public_key: "BSFtCudCd4pR4LSFqWPjbtXPKSNVbGkc35gRNdnqjMCU",
      session: "session-token",
    });

    const result = await parseConnectResponse({
      provider: "solflare",
      params: {
        solflare_encryption_public_key: wallet.encryptionPublicKey,
        nonce,
        data,
      },
      dappSecretKey: dapp.secretKey,
    });

    expect(result.walletPublicKey).toBe(
      "BSFtCudCd4pR4LSFqWPjbtXPKSNVbGkc35gRNdnqjMCU",
    );
    expect(result.session).toBe("session-token");
    expect(bs58.decode(result.sharedSecret)).toEqual(wallet.sharedSecret);
  });

  it("throws the wallet's error redirect as a classified decline", async () => {
    const dapp = await generateDappKeypair();
    const attempt = parseConnectResponse({
      provider: "phantom",
      params: { errorCode: "4001", errorMessage: "User rejected the request." },
      dappSecretKey: dapp.secretKey,
    });
    await expect(attempt).rejects.toThrow(DeeplinkResponseError);
    await expect(attempt).rejects.toMatchObject({ isUserDecline: true });
  });
});

describe("deeplink request/response encryption", () => {
  it("round-trips: wallet decrypts our payload, we decrypt its response", async () => {
    const dapp = await generateDappKeypair();
    const wallet = makeWallet(dapp.publicKey);
    const sharedSecret = bs58.encode(wallet.sharedSecret);

    const url = await buildRequestUrl({
      provider: "phantom",
      method: "signMessage",
      dappPublicKey: dapp.publicKey,
      sharedSecret,
      redirectLink: "https://askloyal.com/ul/wallet/signMessage",
      payload: { message: bs58.encode(Buffer.from("hi")), session: "s1" },
    });

    const params = new URL(url).searchParams;
    expect(url.startsWith("https://phantom.app/ul/v1/signMessage?")).toBe(true);
    expect(params.get("redirect_link")).toBe(
      "https://askloyal.com/ul/wallet/signMessage",
    );
    // The wallet must be able to open our encrypted payload…
    const requestPayload = wallet.decrypt(
      params.get("nonce")!,
      params.get("payload")!,
    );
    expect(requestPayload).toEqual({
      message: bs58.encode(Buffer.from("hi")),
      session: "s1",
    });

    // …and we must be able to open its encrypted response.
    const response = wallet.encrypt({ signature: "sig" });
    await expect(
      decryptResponseData(
        { nonce: response.nonce, data: response.data },
        sharedSecret,
      ),
    ).resolves.toEqual({ signature: "sig" });
  });

  it("rejects a tampered response instead of returning garbage", async () => {
    const dapp = await generateDappKeypair();
    const wallet = makeWallet(dapp.publicKey);
    const response = wallet.encrypt({ signature: "sig" });
    const tampered = bs58.decode(response.data);
    tampered[0] ^= 0xff;
    await expect(
      decryptResponseData(
        { nonce: response.nonce, data: bs58.encode(tampered) },
        bs58.encode(wallet.sharedSecret),
      ),
    ).rejects.toThrow(/could not be decrypted/);
  });
});
