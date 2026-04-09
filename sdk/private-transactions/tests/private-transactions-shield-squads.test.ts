import { beforeAll, describe, expect, it } from "bun:test";
import { GridClient, type SessionSecrets } from "@sqds/grid";
import {
  getAuthToken,
  verifyTeeRpcIntegrity,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import { createInterface } from "node:readline/promises";
import path from "node:path";
import { sign } from "tweetnacl";
import {
  DELEGATION_PROGRAM_ID,
  ER_VALIDATOR,
  LoyalPrivateTransactionsClient,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  PROGRAM_ID,
  findDepositPda,
} from "../index";

const DEFAULT_PER_RPC_ENDPOINT = "https://tee.magicblock.app";
const DEFAULT_PER_WS_ENDPOINT = "wss://tee.magicblock.app";
const DEFAULT_SOLANA_RPC_ENDPOINT = "https://api.devnet.solana.com";
const DEFAULT_SQUADS_BASE_URL = "https://grid.squads.xyz";
const AUTH_CACHE_PATH = path.join(
  import.meta.dir,
  ".squads-grid-auth-cache.json"
);
const DEFAULT_MIN_SIGNER_BALANCE_LAMPORTS = Math.floor(0.02 * LAMPORTS_PER_SOL);
const DEFAULT_FUNDING_WAIT_TIMEOUT_MS = 5 * 60 * 1000;
const FUNDING_POLL_INTERVAL_MS = 2000;

type SquadsEnvironment = "sandbox" | "production";
type SquadsAuthProvider = "privy" | "turnkey";
type GridSessionSecret = SessionSecrets[number];

type GridAuthResult = {
  accountAddress: string;
  authentication: unknown[];
  sessionSecrets: SessionSecrets;
};

type GridAuthCache = {
  email: string;
  environment: SquadsEnvironment;
  authProvider: SquadsAuthProvider;
  baseUrl: string;
  accountAddress: string;
  authentication: unknown[];
  sessionSecrets: SessionSecrets;
  updatedAtMs: number;
};

type StartedGridOtpAuth = {
  authMode: "create" | "existing";
  sessionSecrets: SessionSecrets;
  user: {
    email: string;
    provider?: SquadsAuthProvider;
    otpId?: string;
  };
};

const deriveWsEndpoint = (rpcUrl: string): string =>
  rpcUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:");

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
};

const formatSol = (lamports: number): string =>
  (lamports / LAMPORTS_PER_SOL).toFixed(6);

const isEmailAlreadyExistsError = (error: unknown): boolean => {
  const message = getErrorMessage(error).toLowerCase();
  return message.includes("email") && message.includes("already exists");
};

const promptForOtp = async (): Promise<string> => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("SQUADS_OTP is required in non-interactive environments");
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const otp = (await rl.question("Enter Squads OTP: ")).trim();
    if (!otp) {
      throw new Error("OTP code is required");
    }
    return otp;
  } finally {
    rl.close();
  }
};

const waitForSignerFunding = async (input: {
  connection: Connection;
  signer: PublicKey;
  minimumLamports: number;
  timeoutMs: number;
}): Promise<void> => {
  const { connection, signer, minimumLamports, timeoutMs } = input;
  const signerAddress = signer.toBase58();
  const initialBalance = await connection.getBalance(signer, "confirmed");

  if (initialBalance >= minimumLamports) return;

  const shortfall = minimumLamports - initialBalance;
  const fundingMessage =
    `Squads signer wallet needs funding before running shield lifecycle.\n` +
    `Address: ${signerAddress}\n` +
    `Current balance: ${formatSol(initialBalance)} SOL (${initialBalance} lamports)\n` +
    `Required minimum: ${formatSol(minimumLamports)} SOL (${minimumLamports} lamports)\n` +
    `Shortfall: ${formatSol(shortfall)} SOL (${shortfall} lamports)`;

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      `${fundingMessage}\nNon-interactive mode: fund the address and rerun the test.`
    );
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    console.log(fundingMessage);
    await rl.question("Fund the signer wallet, then press Enter to continue...");
  } finally {
    rl.close();
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const balance = await connection.getBalance(signer, "confirmed");
    if (balance >= minimumLamports) {
      console.log(
        `Signer funded: ${formatSol(balance)} SOL (${signerAddress}). Continuing test.`
      );
      return;
    }
    await Bun.sleep(FUNDING_POLL_INTERVAL_MS);
  }

  const finalBalance = await connection.getBalance(signer, "confirmed");
  throw new Error(
    `Timed out waiting for signer funding (${signerAddress}). ` +
      `Current ${formatSol(finalBalance)} SOL, required ${formatSol(minimumLamports)} SOL.`
  );
};

const extractSolanaSessionSigner = (
  sessionSecrets: SessionSecrets
): Keypair => {
  const solanaSecret = sessionSecrets.find(
    (secret) => secret.provider === "solana"
  );
  if (!solanaSecret) {
    throw new Error(
      "Grid session does not include provider=solana signer; cannot infer PER auth token"
    );
  }

  const secretKeyBytes = Buffer.from(solanaSecret.privateKey, "hex");
  if (secretKeyBytes.length !== 64) {
    throw new Error(
      `Grid solana secret key has invalid length ${secretKeyBytes.length}, expected 64`
    );
  }

  const keypair = Keypair.fromSecretKey(Uint8Array.from(secretKeyBytes));
  if (keypair.publicKey.toBase58() !== solanaSecret.publicKey) {
    throw new Error(
      "Grid solana session secret publicKey mismatch; refusing to continue"
    );
  }

  return keypair;
};

const inferPerAuthToken = async (
  perRpcEndpoint: string,
  signer: Keypair
): Promise<{ token: string; expiresAt: number }> => {
  const isVerified = await verifyTeeRpcIntegrity(perRpcEndpoint);
  if (!isVerified) {
    throw new Error(`TEE integrity verification failed for ${perRpcEndpoint}`);
  }

  return getAuthToken(perRpcEndpoint, signer.publicKey, async (message) =>
    sign.detached(message, signer.secretKey)
  );
};

const loadGridAuthCache = async (): Promise<GridAuthCache | null> => {
  const file = Bun.file(AUTH_CACHE_PATH);
  if (!(await file.exists())) return null;

  try {
    const parsed = (await file.json()) as GridAuthCache;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !parsed.accountAddress ||
      !Array.isArray(parsed.authentication) ||
      !Array.isArray(parsed.sessionSecrets)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const saveGridAuthCache = async (cache: GridAuthCache): Promise<void> => {
  await Bun.write(AUTH_CACHE_PATH, JSON.stringify(cache, null, 2));
};

const startGridOtpAuth = async (input: {
  grid: GridClient;
  email: string;
  authProvider: SquadsAuthProvider;
}): Promise<StartedGridOtpAuth> => {
  const { grid, email, authProvider } = input;
  const sessionSecrets = await grid.generateSessionSecrets();

  try {
    await grid.createAccount({ email });
    return {
      authMode: "create",
      sessionSecrets,
      user: { email },
    };
  } catch (error: unknown) {
    if (!isEmailAlreadyExistsError(error)) {
      throw error;
    }
  }

  const initAuth = await grid.initAuth({
    email,
    provider: authProvider,
  });

  return {
    authMode: "existing",
    sessionSecrets,
    user: {
      email,
      provider: authProvider,
      ...("otpId" in initAuth.data ? { otpId: initAuth.data.otpId } : {}),
    },
  };
};

const completeGridOtpAuth = async (input: {
  grid: GridClient;
  startedAuth: StartedGridOtpAuth;
  otpCode: string;
}): Promise<GridAuthResult> => {
  const { grid, startedAuth, otpCode } = input;

  if (startedAuth.authMode === "create") {
    const created = await grid.completeAuthAndCreateAccount({
      otpCode,
      user: startedAuth.user,
      sessionSecrets: startedAuth.sessionSecrets,
    });
    return {
      accountAddress: created.data.address,
      authentication: created.data.authentication,
      sessionSecrets: startedAuth.sessionSecrets,
    };
  }

  const existing = await grid.completeAuth({
    otpCode,
    user: startedAuth.user,
    sessionSecrets: startedAuth.sessionSecrets,
  });

  return {
    accountAddress: existing.data.address,
    authentication: existing.data.authentication,
    sessionSecrets: startedAuth.sessionSecrets,
  };
};

const requiredEnv = {
  apiKey: process.env.SQUADS_GRID_API_KEY,
  email: process.env.SQUADS_EMAIL,
} as const;

const hasRequiredEnv = Object.values(requiredEnv).every(
  (value) => typeof value === "string" && value.length > 0
);

describe.skipIf(!hasRequiredEnv)(
  "private-transactions shield SDK (Squads Grid)",
  () => {
    const squadsEnvironment = (process.env.SQUADS_ENV ??
      "sandbox") as SquadsEnvironment;
    const squadsAuthProvider = (process.env.SQUADS_AUTH_PROVIDER ??
      "privy") as SquadsAuthProvider;
    const squadsBaseUrl =
      process.env.SQUADS_BASE_URL ?? DEFAULT_SQUADS_BASE_URL;

    const baseRpcEndpoint =
      process.env.PROVIDER_ENDPOINT ??
      process.env.ANCHOR_PROVIDER_URL ??
      DEFAULT_SOLANA_RPC_ENDPOINT;
    const baseWsEndpoint =
      process.env.WS_ENDPOINT ?? deriveWsEndpoint(baseRpcEndpoint);

    const perRpcEndpoint =
      process.env.EPHEMERAL_PROVIDER_ENDPOINT ?? DEFAULT_PER_RPC_ENDPOINT;
    const perWsEndpoint =
      process.env.EPHEMERAL_WS_ENDPOINT ?? DEFAULT_PER_WS_ENDPOINT;

    const tokenMint = process.env.SQUADS_TEST_MINT
      ? new PublicKey(process.env.SQUADS_TEST_MINT)
      : NATIVE_MINT;
    const disableAuthCache = process.env.SQUADS_DISABLE_AUTH_CACHE === "true";
    const minSignerBalanceLamports = Number.parseInt(
      process.env.SQUADS_MIN_SIGNER_BALANCE_LAMPORTS ??
        `${DEFAULT_MIN_SIGNER_BALANCE_LAMPORTS}`,
      10
    );
    const fundingWaitTimeoutMs = Number.parseInt(
      process.env.SQUADS_FUNDING_WAIT_TIMEOUT_MS ??
        `${DEFAULT_FUNDING_WAIT_TIMEOUT_MS}`,
      10
    );

    const grid = new GridClient({
      apiKey: requiredEnv.apiKey!,
      environment: squadsEnvironment,
      baseUrl: squadsBaseUrl,
    });

    const baseConnection = new Connection(baseRpcEndpoint, {
      wsEndpoint: baseWsEndpoint,
      commitment: "confirmed",
    });

    let accountAddress = "";
    let walletSigner: Keypair;
    let client: LoyalPrivateTransactionsClient;
    let usedCachedAuth = false;

    const bootstrapFromAuth = async (auth: GridAuthResult): Promise<void> => {
      accountAddress = auth.accountAddress;

      const perSigner = extractSolanaSessionSigner(auth.sessionSecrets);
      walletSigner = perSigner;
      await waitForSignerFunding({
        connection: baseConnection,
        signer: walletSigner.publicKey,
        minimumLamports: minSignerBalanceLamports,
        timeoutMs: fundingWaitTimeoutMs,
      });

      const perAuthToken = process.env.SQUADS_PER_AUTH_TOKEN
        ? {
            token: process.env.SQUADS_PER_AUTH_TOKEN,
            expiresAt: Date.now() / 1000 + 60,
          }
        : await inferPerAuthToken(perRpcEndpoint, perSigner);

      client = await LoyalPrivateTransactionsClient.fromConfig({
        signer: walletSigner,
        baseRpcEndpoint,
        baseWsEndpoint,
        ephemeralRpcEndpoint: perRpcEndpoint,
        ephemeralWsEndpoint: perWsEndpoint,
        authToken: perAuthToken,
      });
    };

    const validateCachedSession = async (
      cachedAuth: GridAuthCache
    ): Promise<void> => {
      const cachedSigner = extractSolanaSessionSigner(
        cachedAuth.sessionSecrets
      );
      await inferPerAuthToken(perRpcEndpoint, cachedSigner);
    };

    beforeAll(async () => {
      if (!disableAuthCache) {
        const cached = await loadGridAuthCache();
        const cacheMatchesConfig =
          cached &&
          cached.email === requiredEnv.email &&
          cached.environment === squadsEnvironment &&
          cached.authProvider === squadsAuthProvider &&
          cached.baseUrl === squadsBaseUrl;

        if (cacheMatchesConfig) {
          let cacheIsValid = true;
          try {
            await validateCachedSession(cached);
          } catch (error) {
            cacheIsValid = false;
            console.log(
              `Cached Squads auth invalid, re-authenticating (${getErrorMessage(
                error
              )})`
            );
          }

          if (cacheIsValid) {
            await bootstrapFromAuth({
              accountAddress: cached.accountAddress,
              authentication: cached.authentication,
              sessionSecrets: cached.sessionSecrets,
            });
            usedCachedAuth = true;
            console.log("Using cached Squads auth session");
            return;
          }
        }
      }

      const startedAuth = await startGridOtpAuth({
        grid,
        email: requiredEnv.email!,
        authProvider: squadsAuthProvider,
      });

      console.log(
        `OTP dispatched via Squads (${startedAuth.authMode}). Waiting for OTP input...`
      );
      const otpCode = process.env.SQUADS_OTP ?? (await promptForOtp());
      const auth = await completeGridOtpAuth({
        grid,
        startedAuth,
        otpCode,
      });

      await bootstrapFromAuth(auth);

      if (!disableAuthCache) {
        await saveGridAuthCache({
          email: requiredEnv.email!,
          environment: squadsEnvironment,
          authProvider: squadsAuthProvider,
          baseUrl: squadsBaseUrl,
          accountAddress: auth.accountAddress,
          authentication: auth.authentication,
          sessionSecrets: auth.sessionSecrets,
          updatedAtMs: Date.now(),
        });
        console.log(`Saved Squads auth cache to ${AUTH_CACHE_PATH}`);
      }
    });

    it("authenticates Squads account and configures a signer for base+PER", () => {
      expect(accountAddress.length).toBeGreaterThan(0);
      expect(walletSigner.publicKey.toBase58().length).toBeGreaterThan(0);
      expect(client.publicKey.toBase58()).toBe(
        walletSigner.publicKey.toBase58()
      );
      expect(typeof usedCachedAuth).toBe("boolean");
    });

    it("runs shield delegation lifecycle with Squads signer on base and PER", async () => {
      const user = walletSigner.publicKey;
      const [depositPda] = findDepositPda(user, tokenMint);

      const existingDeposit = await client.getBaseDeposit(user, tokenMint);
      if (!existingDeposit) {
        const initSig = await client.initializeDeposit({
          user,
          tokenMint,
          payer: user,
        });
        expect(initSig.length).toBeGreaterThan(0);
      }

      await client.createPermission({
        user,
        tokenMint,
        payer: user,
      });

      const baseBefore = await baseConnection.getAccountInfo(depositPda);
      const delegatedBefore = baseBefore?.owner.equals(DELEGATION_PROGRAM_ID);
      if (delegatedBefore) {
        await client.undelegateDeposit({
          user,
          tokenMint,
          payer: user,
          magicProgram: MAGIC_PROGRAM_ID,
          magicContext: MAGIC_CONTEXT_ID,
        });
      }

      const delegateSig = await client.delegateDeposit({
        user,
        tokenMint,
        payer: user,
        validator: ER_VALIDATOR,
      });
      expect(delegateSig.length).toBeGreaterThan(0);

      const baseDelegated = await baseConnection.getAccountInfo(depositPda);
      expect(baseDelegated?.owner.equals(DELEGATION_PROGRAM_ID)).toBe(true);

      const undelegateSig = await client.undelegateDeposit({
        user,
        tokenMint,
        payer: user,
        magicProgram: MAGIC_PROGRAM_ID,
        magicContext: MAGIC_CONTEXT_ID,
      });
      expect(undelegateSig.length).toBeGreaterThan(0);

      const baseUndelegated = await baseConnection.getAccountInfo(depositPda);
      expect(baseUndelegated?.owner.equals(PROGRAM_ID)).toBe(true);
    });
  }
);
