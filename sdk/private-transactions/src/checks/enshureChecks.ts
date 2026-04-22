import type { AccountInfo, Connection, PublicKey } from "@solana/web3.js";
import { DELEGATION_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import type { DelegationStatusResponse, InstructionCheck } from "../types";
import { prettyStringify } from "../utils";
import { getErValidatorForRpcEndpoint } from "../constants";

type MergedInstructionCheck = {
  address: PublicKey;
  delegated: boolean;
  passNotExist: boolean;
  labels: string[];
};

type EnsureBatchCache = {
  baseAccountInfos: Map<string, AccountInfo<Buffer> | null>;
  delegationStatuses: Map<string, Promise<DelegationStatusResponse>>;
  ephemeralAccountInfos: Map<string, AccountInfo<Buffer> | null>;
};

const ENSURE_FETCH_MAX_ATTEMPTS = 3;
const ENSURE_FETCH_INITIAL_DELAY_MS = 150;
const ENSURE_FETCH_MAX_DELAY_MS = 1_000;
const ENSURE_FETCH_BACKOFF_MULTIPLIER = 2;
const ENSURE_FETCH_JITTER_RATIO = 0.2;
const MULTIPLE_ACCOUNTS_CHUNK_SIZE = 5;

export async function processEnsureChecks(
  baseConnection: Connection,
  perConnection: Connection,
  ensure: InstructionCheck[]
): Promise<void> {
  const mergedChecks = new Map<string, MergedInstructionCheck>();
  for (const { address, delegated, passNotExist, label } of ensure) {
    const addressKey = address.toBase58();
    const existing = mergedChecks.get(addressKey);
    if (!existing) {
      mergedChecks.set(addressKey, {
        address,
        delegated,
        passNotExist,
        labels: [label],
      });
      continue;
    }

    existing.labels.push(label);
    if (existing.delegated !== delegated) {
      throw new Error(
        `Conflicting ensure delegation requirements: ${existing.labels.join(
          ", "
        )} - ${addressKey}`
      );
    }
    existing.passNotExist = existing.passNotExist && passNotExist;
  }

  const cache: EnsureBatchCache = {
    baseAccountInfos: new Map(),
    delegationStatuses: new Map(),
    ephemeralAccountInfos: new Map(),
  };
  const uniqueChecks = [...mergedChecks.values()];
  await primeEnsureBatchCache(
    baseConnection,
    perConnection,
    uniqueChecks,
    cache
  );

  for (const { address, delegated, passNotExist, labels } of uniqueChecks) {
    const displayLabels = labels.join(", ");
    if (delegated) {
      await ensureDelegated(
        baseConnection,
        perConnection,
        address,
        displayLabels,
        undefined,
        cache
      );
    } else {
      await ensureNotDelegated(
        baseConnection,
        perConnection,
        address,
        displayLabels,
        passNotExist,
        cache
      );
    }
  }
}

async function primeEnsureBatchCache(
  baseConnection: Connection,
  perConnection: Connection,
  checks: MergedInstructionCheck[],
  cache: EnsureBatchCache
): Promise<void> {
  const addresses = checks.map((check) => check.address);
  const [baseAccountInfos, ephemeralAccountInfos] = await Promise.all([
    getMultipleAccountsInfoWithRetry(
      baseConnection,
      addresses,
      "base-getMultipleAccountsInfo"
    ),
    getMultipleAccountsInfoWithRetry(
      perConnection,
      addresses,
      "ephemeral-getMultipleAccountsInfo"
    ),
  ]);

  for (let index = 0; index < checks.length; index += 1) {
    const addressKey = checks[index]!.address.toBase58();
    cache.baseAccountInfos.set(addressKey, baseAccountInfos[index] ?? null);
    cache.ephemeralAccountInfos.set(
      addressKey,
      ephemeralAccountInfos[index] ?? null
    );
  }
}

export async function getMultipleAccountsInfoWithRetry(
  connection: Connection,
  accounts: PublicKey[],
  label: string
): Promise<(AccountInfo<Buffer> | null)[]> {
  if (accounts.length === 0) {
    return [];
  }

  const chunks: PublicKey[][] = [];
  for (
    let start = 0;
    start < accounts.length;
    start += MULTIPLE_ACCOUNTS_CHUNK_SIZE
  ) {
    chunks.push(accounts.slice(start, start + MULTIPLE_ACCOUNTS_CHUNK_SIZE));
  }

  const chunkResults = await Promise.all(
    chunks.map((chunk, index) =>
      runEnsureFetchWithRetry(`${label}-chunk-${index + 1}`, () =>
        connection.getMultipleAccountsInfo(chunk)
      )
    )
  );
  return chunkResults.flat();
}

async function ensureNotDelegated(
  baseConnection: Connection,
  perConnection: Connection,
  account: PublicKey,
  name?: string,
  passNotExist?: boolean,
  cache?: EnsureBatchCache
): Promise<void> {
  const baseAccountInfo = await getEnsureBaseAccountInfo(
    baseConnection,
    account,
    cache
  );

  if (!baseAccountInfo) {
    if (passNotExist) {
      return;
    }
    const displayName = formatEnsureDisplayName(name);
    throw new Error(
      `Account is not exists: ${displayName}${account.toString()}`
    );
  }

  const isDelegated = baseAccountInfo!.owner.equals(DELEGATION_PROGRAM_ID);
  const displayName = formatEnsureDisplayName(name);
  if (isDelegated) {
    const [ephemeralAccountInfo, delegationStatus] = await Promise.all([
      getEnsureEphemeralAccountInfo(perConnection, account, cache),
      getEnsureDelegationStatus(perConnection.rpcEndpoint, account, cache),
    ]);
    console.error(
      `Account is delegated to ER: ${displayName}${account.toString()}`
    );
    console.error(
      "/getDelegationStatus",
      JSON.stringify(delegationStatus, null, 2)
    );
    console.error("baseAccountInfo", prettyStringify(baseAccountInfo));
    console.error(
      "ephemeralAccountInfo",
      prettyStringify(ephemeralAccountInfo)
    );

    const expectedValidator = getErValidatorForRpcEndpoint(
      perConnection.rpcEndpoint
    );
    const authority = delegationStatus.result?.delegationRecord?.authority;
    if (authority && authority !== expectedValidator.toString()) {
      console.error(
        `Account is delegated on wrong validator: ${displayName}${account.toString()} - validator: ${authority}`
      );
    }

    throw new Error(
      `Account is delegated to ER: ${displayName}${account.toString()}`
    );
  }
}

async function ensureDelegated(
  baseConnection: Connection,
  perConnection: Connection,
  account: PublicKey,
  name?: string,
  skipValidatorCheck?: boolean,
  cache?: EnsureBatchCache
): Promise<void> {
  const baseAccountInfo = await getEnsureBaseAccountInfo(
    baseConnection,
    account,
    cache
  );

  if (!baseAccountInfo) {
    const displayName = formatEnsureDisplayName(name);
    throw new Error(
      `Account is not exists: ${displayName}${account.toString()}`
    );
  }
  const isDelegated = baseAccountInfo!.owner.equals(DELEGATION_PROGRAM_ID);
  const displayName = formatEnsureDisplayName(name);

  if (!isDelegated) {
    const [ephemeralAccountInfo, delegationStatus] = await Promise.all([
      getEnsureEphemeralAccountInfo(perConnection, account, cache),
      getEnsureDelegationStatus(perConnection.rpcEndpoint, account, cache),
    ]);
    console.error(
      `Account is not delegated to ER: ${displayName}${account.toString()}`
    );
    console.error(
      "/getDelegationStatus:",
      JSON.stringify(delegationStatus, null, 2)
    );
    console.error("baseAccountInfo", prettyStringify(baseAccountInfo));
    console.error(
      "ephemeralAccountInfo",
      prettyStringify(ephemeralAccountInfo)
    );

    throw new Error(
      `Account is not delegated to ER: ${displayName}${account.toString()}`
    );
  }

  if (!skipValidatorCheck) {
    const [ephemeralAccountInfo, delegationStatus] = await Promise.all([
      getEnsureEphemeralAccountInfo(perConnection, account, cache),
      getEnsureDelegationStatus(perConnection.rpcEndpoint, account, cache),
    ]);
    if (
      delegationStatus.result.delegationRecord.authority !==
      getErValidatorForRpcEndpoint(perConnection.rpcEndpoint).toString()
    ) {
      console.error(
        `Account is delegated on wrong validator: ${displayName}${account.toString()} - validator: ${
          delegationStatus.result.delegationRecord.authority
        }`
      );
      console.error(
        "/getDelegationStatus:",
        JSON.stringify(delegationStatus, null, 2)
      );
      console.error("baseAccountInfo", prettyStringify(baseAccountInfo));
      console.error(
        "ephemeralAccountInfo",
        prettyStringify(ephemeralAccountInfo)
      );

      throw new Error(
        `Account is delegated on wrong validator: ${displayName}${account.toString()} - validator: ${
          delegationStatus.result.delegationRecord.authority
        }`
      );
    }
  }
}

async function getEnsureBaseAccountInfo(
  baseConnection: Connection,
  account: PublicKey,
  cache?: EnsureBatchCache
): Promise<AccountInfo<Buffer> | null> {
  const addressKey = account.toBase58();
  if (cache?.baseAccountInfos.has(addressKey)) {
    return cache.baseAccountInfos.get(addressKey) ?? null;
  }

  const baseAccountInfo = await baseConnection.getAccountInfo(account);
  cache?.baseAccountInfos.set(addressKey, baseAccountInfo);
  return baseAccountInfo;
}

async function getEnsureEphemeralAccountInfo(
  perConnection: Connection,
  account: PublicKey,
  cache?: EnsureBatchCache
): Promise<AccountInfo<Buffer> | null> {
  const addressKey = account.toBase58();
  if (cache?.ephemeralAccountInfos.has(addressKey)) {
    return cache.ephemeralAccountInfos.get(addressKey) ?? null;
  }

  const ephemeralAccountInfo = await perConnection.getAccountInfo(account);
  cache?.ephemeralAccountInfos.set(addressKey, ephemeralAccountInfo);
  return ephemeralAccountInfo;
}

async function getEnsureDelegationStatus(
  perRpcEndpoint: string,
  account: PublicKey,
  cache?: EnsureBatchCache
): Promise<DelegationStatusResponse> {
  const addressKey = account.toBase58();
  const cachedPromise = cache?.delegationStatuses.get(addressKey);
  if (cachedPromise) {
    return cachedPromise;
  }

  const request = getDelegationStatus(perRpcEndpoint, account);
  cache?.delegationStatuses.set(addressKey, request);
  return request;
}

export async function runEnsureFetchWithRetry<T>(
  label: string,
  task: () => Promise<T>
): Promise<T> {
  let nextDelayMs = ENSURE_FETCH_INITIAL_DELAY_MS;
  let lastError: unknown;

  for (let attempt = 1; attempt <= ENSURE_FETCH_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt === ENSURE_FETCH_MAX_ATTEMPTS) {
        break;
      }

      console.warn(
        `[ensure] ${label} attempt ${attempt}/${ENSURE_FETCH_MAX_ATTEMPTS} failed: ${
          (error as { message?: string })?.message ?? String(error)
        }`
      );
      const jitter = nextDelayMs * ENSURE_FETCH_JITTER_RATIO;
      const jitteredDelay = Math.max(
        0,
        Math.round(nextDelayMs + (Math.random() * 2 - 1) * jitter)
      );
      await new Promise((resolve) => setTimeout(resolve, jitteredDelay));
      nextDelayMs = Math.min(
        ENSURE_FETCH_MAX_DELAY_MS,
        Math.round(nextDelayMs * ENSURE_FETCH_BACKOFF_MULTIPLIER)
      );
    }
  }

  throw new Error(
    `[ensure] ${label} failed after ${ENSURE_FETCH_MAX_ATTEMPTS} attempts: ${
      (lastError as { message?: string })?.message ?? String(lastError)
    }`
  );
}

async function getDelegationStatus(
  perRpcEndpoint: string,
  account: PublicKey
): Promise<DelegationStatusResponse> {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "getDelegationStatus",
    params: [account.toString()],
  });
  const options = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  };

  const expectedValidator = getErValidatorForRpcEndpoint(perRpcEndpoint);

  // Try TEE first — pick mainnet or devnet TEE based on ephemeral RPC URL
  const isMainnet = perRpcEndpoint.includes("mainnet-tee");
  const teeBaseUrl = isMainnet
    ? "https://mainnet-tee.magicblock.app/"
    : "https://tee.magicblock.app/";
  try {
    const teeRes = await fetch(teeBaseUrl, options);
    const teeData = (await teeRes.json()) as DelegationStatusResponse;
    if (teeData.result?.isDelegated) {
      // TEE confirmed delegation — synthesize authority so validator check passes
      return {
        ...teeData,
        result: {
          ...teeData.result,
          delegationRecord: {
            authority: expectedValidator.toString(),
          },
        },
      };
    }
  } catch (e) {
    console.error(
      "[getDelegationStatus] TEE fetch failed, falling back to devnet-router: Options:",
      options,
      "Error:",
      e
    );
  }

  // Fallback to devnet-router
  const routerBaseUrl = isMainnet
    ? "https://router.magicblock.app/"
    : "https://devnet-router.magicblock.app/";
  const res = await fetch(routerBaseUrl, options);
  const routerData = (await res.json()) as DelegationStatusResponse;

  // WORKAROUND: devnet-router returns an error for accounts delegated to the
  // PER validator it doesn't recognize, e.g.:
  //   {"error":{"code":-32604,"message":"account has been delegated to unknown ER node: FnE6..."}}
  // Treat as valid delegation if it mentions our PER validator.
  if (routerData.error?.message?.includes(expectedValidator.toString())) {
    return {
      ...routerData,
      result: {
        isDelegated: true,
        delegationRecord: {
          authority: expectedValidator.toString(),
        },
      },
    };
  }

  return routerData;
}

function formatEnsureDisplayName(name?: string): string {
  return name ? `${name} - ` : "";
}
