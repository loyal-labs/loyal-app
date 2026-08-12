import type { Keypair } from "@solana/web3.js";
export declare function createKeypairMessageSigner(keypair: Keypair): (message: Uint8Array) => Promise<Uint8Array>;
