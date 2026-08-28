import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import {
  deriveRecurringDelegation,
  deriveSubscriptionAuthority,
  getKaminoUsdcEarnTargetForCluster,
  LoyalCluster,
} from "@loyal-labs/actions";
import { accounts, pda } from "@loyal-labs/loyal-smart-accounts";
import { Policy, policyDiscriminator, toBigInt } from "@loyal-labs/loyal-smart-accounts-core";
import { createSmartAccountVaultsClient } from "@loyal-labs/smart-account-vaults";
import { Connection, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import {
  getPublicRpcUrl,
  MAINNET_GENESIS_HASH,
} from "../src/lib/constants";
import { readDemoMoneyState } from "../src/lib/money-state";
import { parseSponsorKey } from "../src/lib/sponsor-validation";

type Result = { id: string; status: "PASS" | "FAIL" | "BLOCKED"; evidence: string };
const root = new URL("..", import.meta.url).pathname;
const source = join(root, "src");
const results: Result[] = [];

function record(id: string, condition: boolean, pass: string, fail: string) {
  results.push({ id, status: condition ? "PASS" : "FAIL", evidence: condition ? pass : fail });
}

async function files(directory: string): Promise<string[]> {
  try {
    const output: string[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === ".next" || entry.name === "node_modules") continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) output.push(...(await files(path)));
      else output.push(path);
    }
    return output;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function runCheck(id: string, command: string, args: string[]) {
  const run = spawnSync(command, args, { cwd: root, encoding: "utf8", env: process.env });
  const detail = `${run.stdout ?? ""}\n${run.stderr ?? ""}`.trim();
  record(id, run.status === 0, `${command} ${args.join(" ")} passed`, detail || `${command} ${args.join(" ")} exited ${run.status}`);
}

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function requiredArgs(names: string[]): string[] {
  return names.filter((name) => !arg(name)).map((name) => `--${name}`);
}

function tokenDelta(
  transaction: NonNullable<Awaited<ReturnType<Connection["getParsedTransaction"]>>>,
  owner: PublicKey,
  mint: PublicKey
): bigint {
  const sum = (balances: typeof transaction.meta.preTokenBalances) =>
    (balances ?? [])
      .filter((balance) => balance.owner === owner.toBase58() && balance.mint === mint.toBase58())
      .reduce((total, balance) => total + BigInt(balance.uiTokenAmount.amount), 0n);
  return sum(transaction.meta!.postTokenBalances) - sum(transaction.meta!.preTokenBalances);
}

function policySignerIs(policy: Policy, signer: PublicKey): boolean {
  return policy.threshold === 1 && policy.timeLock === 0 && policy.signers.length === 1 && policy.signers[0]?.key.equals(signer) === true;
}

async function verifyStatic() {
  const sourceFiles = (await files(source)).filter((path) => /\.(ts|tsx)$/.test(path));
  const sourceEntries = await Promise.all(sourceFiles.map(async (path) => [path, await readFile(path, "utf8")] as const));
  const executableSource = sourceEntries.map(([, text]) => text).join("\n");
  const page = await readFile(join(source, "app/page.tsx"), "utf8");
  const providers = await readFile(join(source, "app/providers.tsx"), "utf8");
  const constants = await readFile(join(source, "lib/constants.ts"), "utf8");
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { dependencies: Record<string, string>; scripts: Record<string, string> };

  const apiRoutes = sourceFiles.filter((path) => path.includes("/app/api/") && basename(path) === "route.ts");
  const relativeRoutes = apiRoutes.map((path) => relative(root, path));
  record("surface.one_backend_route", relativeRoutes.length === 1 && relativeRoutes[0] === "src/app/api/sponsor/route.ts", "one authenticated backend route owns setup and fixed money moves", `found API routes: ${relativeRoutes.join(", ")}`);

  const forbiddenPatterns = [/localStorage/, /sweepIntent/, /\/api\/sweep/, /webhook/i, /scheduler/i, /queue/i];
  const forbiddenHits = forbiddenPatterns.filter((pattern) => pattern.test(executableSource)).map((pattern) => pattern.toString());
  record("surface.no_unbounded_machinery", forbiddenHits.length === 0, "no browser persistence, generic sweep, worker, or replay machinery is present", `forbidden executable patterns remain: ${forbiddenHits.join(", ")}`);

  const secretEnvPattern = /process\.env\.(SMART_ACCOUNT_SPONSOR_PK|EARN_POLICY_SPONSOR_PK)\b/;
  const secretEnvOutsideServer = sourceEntries
    .filter(([path]) => !path.includes("/lib/server/"))
    .filter(([, text]) => secretEnvPattern.test(text))
    .map(([path]) => relative(root, path));
  const sponsorModule = sourceEntries.find(([path]) => path.endsWith("lib/server/sponsor.ts"));
  const sponsorIsServerOnly = sponsorModule?.[1].includes('import "server-only"') === true;
  record("surface.server_secret_boundary", secretEnvOutsideServer.length === 0 && sponsorIsServerOnly, "sponsor and policy private keys are only read inside the server-only sponsor module", `secret env reads outside src/lib/server: ${secretEnvOutsideServer.join(", ") || "none"}; sponsor.ts server-only import present: ${sponsorIsServerOnly}`);

  const requiredDependencies = ["@privy-io/node", "jose", "tweetnacl"].filter((name) => !(name in packageJson.dependencies));
  record("surface.server_dependencies", requiredDependencies.length === 0, "the authenticated server dependencies are installed", `missing dependencies: ${requiredDependencies.join(", ")}`);

  const verifierFiles = (await files(join(root, "scripts"))).filter((path) => /verify.*\.ts$/.test(basename(path)));
  const verifierScripts = Object.keys(packageJson.scripts).filter((name) => name.startsWith("verify"));
  record("contract.one_verifier", verifierFiles.length === 1 && basename(verifierFiles[0] ?? "") === "verify-demo.ts" && verifierScripts.length === 1 && verifierScripts[0] === "verify:demo", "verify:demo is the sole acceptance entrypoint", `verifier files=${verifierFiles.map((path) => basename(path)).join(",")}; scripts=${verifierScripts.join(",")}`);

  const requiredActions = ["Continue with email", "Withdraw USDC", "Create smart account", "Create policies", "Run payday sweep", "Fund a purchase", "Move 2 USDC to smart account", "Move 2 USDC to Kamino", "Move 1 USDC back to smart account", "Send 1 USDC to wallet"];
  const primaryActions = page.match(/data-primary-action/g) ?? [];
  record("ui.separate_steps_and_moves", primaryActions.length === requiredActions.length && requiredActions.every((label) => page.includes(label)), "connect, wallet withdrawal, account, policies, the two chained scenarios, and each fixed move are separate explained actions", `found ${primaryActions.length} primary markers; required labels=${requiredActions.join(" | ")}`);

  const scenarioChaining = page.includes("PAYDAY_STEPS") && page.includes("PURCHASE_STEPS") && page.includes('"wallet_to_smart_account"') && page.includes('"smart_account_to_kamino"') && page.includes('"kamino_to_smart_account"') && page.includes('"smart_account_to_wallet"') && page.includes("runScenario");
  record("ui.scenario_chaining", scenarioChaining, "the payday and purchase scenarios chain exactly the four fixed backend moves and nothing else", "scenario buttons do not decompose into the four fixed backend moves");

  const walletWithdrawal =
    !page.includes("useFundWallet") &&
    !page.includes("Add 3 USDC") &&
    page.includes("useSignAndSendTransaction") &&
    page.includes("createAssociatedTokenAccountIdempotentInstruction") &&
    page.includes("createTransferCheckedInstruction") &&
    page.includes("CANONICAL_USDC_MINT") &&
    page.includes("waitForFinalized") &&
    page.includes("Withdrawal amount exceeds the Privy wallet balance");
  record("ui.user_wallet_withdrawal", walletWithdrawal, "there is no funding button; the connected user can sign a bounded canonical-USDC withdrawal to another Solana wallet", "the obsolete funding action remains or the user-controlled canonical-USDC withdrawal is incomplete");

  const dualPrivyAccounts = providers.includes('walletChainType: "ethereum-and-solana"') && providers.includes('ethereum: { createOnLogin: "all-users" }') && providers.includes('solana: { createOnLogin: "all-users" }') && page.includes("user?.linkedAccounts.find") && page.includes('account.chainType === "ethereum"');
  record("ui.privy_accounts_visible", dualPrivyAccounts, "Privy creates and displays the embedded Solana and EVM accounts", "dual-chain Privy account creation or display is incomplete");

  const orbAddressControls =
    executableSource.includes('https://orbmarkets.io/${type}/${value}') &&
    executableSource.includes("navigator.clipboard.writeText(value)") &&
    executableSource.includes("View address on Orb Markets") &&
    executableSource.includes("Copy ${value}") &&
    !executableSource.includes("explorer.solana.com") &&
    !executableSource.includes("etherscan.io/address");
  record("ui.orb_address_controls", orbAddressControls, "every displayed account address uses the shared Orb Markets link and copy control; transaction evidence uses Orb too", "address links or copy controls are inconsistent, or a legacy explorer link remains");

  const balanceState = ["In wallet", "In smart account", "In Kamino"].every((label) => executableSource.includes(label)) && page.includes("walletUsdcRaw") && page.includes("smartAccountUsdcRaw") && page.includes("kaminoPositionRaw") && /getParsedTokenAccountsByOwner|refreshBalances|loadBalances/.test(page);
  record("ui.three_chain_balances", balanceState, "the UI derives wallet, smart-account, and Kamino balances from finalized chain state", "one or more chain-derived money states or their labels are missing");

  const websocketBalances = page.includes("onAccountChange") && !executableSource.includes("setInterval") && constants.includes("https://guendolen-nvqjc4-fast-mainnet.helius-rpc.com") && constants.includes("wss://guendolen-nvqjc4-fast-mainnet.helius-rpc.com") && !constants.includes("NEXT_PUBLIC_SOLANA_RPC_URL") && !constants.includes("NEXT_PUBLIC_SOLANA_WS_URL");
  record("ui.keyless_websocket_balances", websocketBalances, "the demo uses the frozen keyless RPC and listens for finalized account changes without polling", "the RPC can still expose a mounted API key or balances are still timer-polled");

  const accountDiscovery = executableSource.includes("prepareSmartAccountCreation") && executableSource.includes("getProgramAccounts") && executableSource.includes("CANONICAL_SETTINGS_SIGNER_OFFSETS") && executableSource.includes("[92, 124]") && !executableSource.includes("CANONICAL_SETTINGS_DATA_SIZE") && /findExistingSmartAccount|discoverSmartAccount|existingSettings/.test(executableSource) && /finalized/.test(executableSource);
  record("account.find_before_create", accountDiscovery, "the connected Privy wallet performs a bounded, wallet-filtered finalized Settings lookup before creating one", "account creation still lacks bounded finalized existing-account discovery");

  const policySetup = executableSource.includes("prepareEarnUsdcAutodepositSetup") && executableSource.includes("prepareSetSpendingLimitPolicy") && executableSource.includes("recurringDelegation") && executableSource.includes("SMART_ACCOUNT_SPONSOR_PUBKEY") && executableSource.includes("assertEarnUsdcAutodepositCanonicalArtifacts") && /findExistingPolicies|discoverPolicies|existingPolicies/.test(executableSource);
  record("policies.find_or_create_exact_bundle", policySetup, "policy setup discovers existing artifacts and provisions recurring autodeposit, Main-only Earn, and USDC exit limit", "policy setup does not yet prove idempotent discovery, recurring delegation, or the USDC spending-limit policy");

  const movementKinds = ["wallet_to_smart_account", "smart_account_to_kamino", "kamino_to_smart_account", "smart_account_to_wallet"];
  const fixedBackendMoves = movementKinds.every((kind) => executableSource.includes(kind)) && executableSource.includes("prepareEarnUsdcAutodepositPull") && executableSource.includes("policySigner") && executableSource.includes("transaction.sign([args.sponsor, args.policySigner])") && executableSource.includes("waitForFinalized") && executableSource.includes("reconcileMove") && !page.includes("prepareEarnUsdcDeposit");
  record("moves.backend_fixed_state_machine", fixedBackendMoves, "the backend owns four explicit, delegated, finalized movement transitions", "money moves are still combined in the client or lack explicit backend state transitions");

  const sponsorBoundary = executableSource.includes("authenticatePrivyWallet") && executableSource.includes("createWalletChallenge") && executableSource.includes("verifyWalletChallenge") && executableSource.includes("verifyAccessToken") && executableSource.includes("nacl.sign.detached.verify") && executableSource.includes("httpOnly: true") && executableSource.includes("sameSite: \"strict\"") && executableSource.includes("enforceSameOrigin") && executableSource.includes("enforceRateLimit") && executableSource.includes("SMART_ACCOUNT_SPONSOR_PK") && executableSource.includes("SMART_ACCOUNT_SPONSOR_PUBKEY") && executableSource.includes("sigVerify: true");
  record("moves.sponsor_and_identity_boundary", sponsorBoundary, "a Privy access token plus one-time Solana wallet challenge binds an HttpOnly session to the wallet before sponsorship", "wallet-session binding, sponsor-key consistency, or signature simulation checks are incomplete");

  const mainnetBoundary = constants.includes("LoyalCluster.MainnetBeta") && constants.includes(MAINNET_GENESIS_HASH) && constants.includes("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v") && constants.includes("EARN_VAULT_INDEX = 1");
  record("flow.mainnet_and_main_market", mainnetBoundary && executableSource.includes("getKaminoUsdcEarnTargetForCluster") && /Main.?Market|KAMINO_MAIN_MARKET/.test(executableSource), "mainnet USDC, vault 1, and Kamino Main Market are frozen", "the canonical mainnet, vault, or Main Market boundary drifted");

  const verifierSource = await readFile(join(root, "scripts/verify-demo.ts"), "utf8");
  const submissionPrimitive = /(?:connection|transaction)\.(sendRawTransaction|sendTransaction|signAndSendTransaction)\s*\(/.test(verifierSource);
  record("contract.verifier_read_only", !submissionPrimitive, "the verifier only reads finalized chain state and never submits a transaction", "the verifier contains a transaction submission or signing primitive");

  if (!results.some((result) => result.status === "FAIL")) {
    runCheck("static.lint", "bun", ["run", "lint"]);
    runCheck("static.typecheck", "bun", ["run", "typecheck"]);
    runCheck("static.tests", "bun", ["run", "test"]);
  }
}

async function verifyLive() {
  const requiredConfiguration = ["SMART_ACCOUNT_SPONSOR_PK", "SMART_ACCOUNT_SPONSOR_PUBKEY", "EARN_POLICY_SPONSOR_PK"];
  const missingConfiguration = requiredConfiguration.filter((name) => !process.env[name]);
  if (missingConfiguration.length > 0) {
    results.push({ id: "runtime.configuration", status: "BLOCKED", evidence: `mount the 1Password environment and rerun through op; missing ${missingConfiguration.join(", ")}` });
    return;
  }

  const evidenceArgs = requiredArgs(["wallet", "settings", "autodeposit-policy", "earn-route-policy", "earn-setup-policy", "spending-limit-policy", "wallet-to-smart-signature", "smart-to-kamino-signature", "kamino-to-smart-signature", "smart-to-wallet-signature"]);
  const connection = new Connection(getPublicRpcUrl(), "finalized");
  const genesis = await connection.getGenesisHash();
  record("live.mainnet", genesis === MAINNET_GENESIS_HASH, "RPC is Solana mainnet-beta", `unexpected genesis hash ${genesis}`);
  if (genesis !== MAINNET_GENESIS_HASH) return;

  let sponsor;
  let policySigner;
  try {
    sponsor = parseSponsorKey(process.env.SMART_ACCOUNT_SPONSOR_PK);
    policySigner = parseSponsorKey(process.env.EARN_POLICY_SPONSOR_PK, "EARN_POLICY_SPONSOR_PK");
    const configuredSponsor = new PublicKey(process.env.SMART_ACCOUNT_SPONSOR_PUBKEY!);
    record("runtime.policy_signer_key_consistency", policySigner.publicKey.equals(configuredSponsor), "delegated policy private key derives the configured SMART_ACCOUNT_SPONSOR_PUBKEY", "EARN_POLICY_SPONSOR_PK and SMART_ACCOUNT_SPONSOR_PUBKEY do not match");
  } catch (error) {
    record("runtime.policy_signer_key_consistency", false, "fee sponsor and delegated policy keys are valid", error instanceof Error ? error.message : "sponsor key configuration is invalid");
    return;
  }
  const sponsorBalance = await connection.getBalance(sponsor.publicKey, "finalized");
  record("runtime.sponsor_funded", sponsorBalance >= 200_000_000, `delegated sponsor has ${sponsorBalance} lamports`, `delegated sponsor has only ${sponsorBalance} lamports; fund at least 200000000`);
  if (evidenceArgs.length > 0) {
    results.push({ id: "live.evidence", status: "BLOCKED", evidence: `complete the four-step walkthrough, then rerun with ${evidenceArgs.join(" ")}` });
    return;
  }

  const wallet = new PublicKey(arg("wallet")!);
  const settingsAddress = new PublicKey(arg("settings")!);
  const policyAddresses = [new PublicKey(arg("autodeposit-policy")!), new PublicKey(arg("earn-route-policy")!), new PublicKey(arg("earn-setup-policy")!), new PublicKey(arg("spending-limit-policy")!)];
  const settings = await accounts.Settings.fromAccountAddress(connection, settingsAddress, "finalized");
  const rootIsWallet = settings.threshold === 1 && settings.timeLock === 0 && settings.signers.length === 1 && settings.signers[0]!.key.equals(wallet) && (settings.signers[0]!.permissions.mask & 0b111) === 0b111;
  record("live.root_authority", rootIsWallet, "Privy wallet is the sole all-permissions Settings signer", "Settings root authority does not match the Privy wallet contract");

  const policyRows = await connection.getProgramAccounts(new PublicKey("SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG"), { commitment: "finalized", filters: [{ memcmp: { offset: 0, bytes: bs58.encode(Uint8Array.from(policyDiscriminator)) } }, { memcmp: { offset: 8, bytes: settingsAddress.toBase58() } }] });
  const policies = policyRows.map(({ account, pubkey }) => ({ address: pubkey, policy: Policy.fromAccountInfo(account)[0] }));
  const addressSet = new Set(policyAddresses.map((address) => address.toBase58()));
  const exactPhysicalSet = policies.length === 4 && addressSet.size === 4 && policies.every(({ address }) => addressSet.has(address.toBase58()));
  record("live.exact_four_physical_policies", exactPhysicalSet, "exactly the four named physical policies exist for this Settings account", `expected four named policies, found ${policies.length}`);

  const policyByAddress = new Map(policies.map((row) => [row.address.toBase58(), row.policy]));
  const [autodeposit, route, setup, spendingLimit] = policyAddresses.map((address) => policyByAddress.get(address.toBase58()));
  const programKinds = [autodeposit, route, setup].every((policy) => policy?.policyState.__kind === "ProgramInteraction");
  const sponsorPolicySigners = policies.every(({ policy }) => policySignerIs(policy, policySigner.publicKey));
  const target = getKaminoUsdcEarnTargetForCluster(LoyalCluster.MainnetBeta);
  const vault = pda.getSmartAccountPda({ settingsPda: settingsAddress, accountIndex: 1 })[0];
  const vaultClient = createSmartAccountVaultsClient({
    connection,
    programId: new PublicKey("SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG"),
  });
  let autodepositCanonical = false;
  let autodepositCanonicalError = "policy missing";
  if (autodeposit) {
    try {
      const nonce = 0n;
      const subscriptionAuthority = deriveSubscriptionAuthority(
        wallet,
        target.liquidityMint
      );
      const recurringDelegation = deriveRecurringDelegation(
        subscriptionAuthority,
        wallet,
        vault,
        nonce
      );
      await vaultClient.assertEarnUsdcAutodepositCanonicalArtifacts({
        amountRaw: 2_000_000n,
        cluster: LoyalCluster.MainnetBeta,
        nonce,
        policy: policyAddresses[0]!,
        policySeed: toBigInt(autodeposit.seed),
        policySigner: policySigner.publicKey,
        recurringDelegation,
        settingsPda: settingsAddress,
        walletAddress: wallet,
      });
      autodepositCanonical = true;
      autodepositCanonicalError = "";
    } catch (error) {
      autodepositCanonicalError =
        error instanceof Error ? error.message : "unknown autodeposit error";
    }
  }
  let routeAndSetupCanonical = false;
  let routeAndSetupCanonicalError = "route or setup missing";
  if (route && setup) {
    try {
      const resolved =
        await vaultClient.prepareEarnUsdcYieldRoutingPolicyState({
          cluster: LoyalCluster.MainnetBeta,
          feePayer: sponsor.publicKey,
          policyScope: "kamino_main_usdc",
          settingsPda: settingsAddress,
          signer: policySigner.publicKey,
          walletAddress: wallet,
        });
      routeAndSetupCanonical =
        resolved.policy.account.equals(policyAddresses[1]!) &&
        resolved.setupPolicy.account.equals(policyAddresses[2]!) &&
        resolved.policySetupPrepared === null &&
        resolved.policyFinalizePrepared === null;
      routeAndSetupCanonicalError = routeAndSetupCanonical
        ? ""
        : "resolver returned different addresses or a repair operation";
    } catch (error) {
      routeAndSetupCanonicalError =
        error instanceof Error ? error.message : "unknown route/setup error";
    }
  }
  const spendingLimitShape = (() => {
    if (!spendingLimit || spendingLimit.policyState.__kind !== "SpendingLimit") return false;
    const [value] = spendingLimit.policyState.fields;
    return value.sourceAccountIndex === 1 && value.destinations.length === 1 && value.destinations[0]!.equals(wallet) && value.spendingLimit.mint.equals(target.liquidityMint) && toBigInt(value.spendingLimit.quantityConstraints.maxPerPeriod) === 10_000_000n && value.spendingLimit.timeConstraints.period.__kind === "Daily";
  })();
  const policyShapeChecks = {
    exactPhysicalSet,
    programKinds,
    sponsorPolicySigners,
    routeAndSetupCanonical,
    autodepositCanonical,
    spendingLimitShape,
  };
  record("live.policy_shapes_and_authority", Object.values(policyShapeChecks).every(Boolean), "autodeposit, Main-only Earn, and USDC wallet-exit policies have exact delegated shapes", `policy shape checks failed: ${JSON.stringify({ ...policyShapeChecks, autodepositCanonicalError, routeAndSetupCanonicalError })}`);

  const signatures = [arg("wallet-to-smart-signature")!, arg("smart-to-kamino-signature")!, arg("kamino-to-smart-signature")!, arg("smart-to-wallet-signature")!];
  const transactions = await Promise.all(signatures.map((signature) => connection.getParsedTransaction(signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 })));
  const finalized = transactions.every((transaction) => transaction?.meta && !transaction.meta.err);
  record("live.four_finalized_moves", finalized, "all four backend movement signatures are finalized successfully", "one or more movement signatures are absent, failed, or not finalized");
  if (!finalized) return;
  const [walletToSmart, smartToKamino, kaminoToSmart, smartToWallet] = transactions as [NonNullable<typeof transactions[0]>, NonNullable<typeof transactions[1]>, NonNullable<typeof transactions[2]>, NonNullable<typeof transactions[3]>];
  const usdc = target.liquidityMint;
  const walletToSmartWalletDelta = tokenDelta(walletToSmart, wallet, usdc);
  const walletToSmartVaultDelta = tokenDelta(walletToSmart, vault, usdc);
  const smartToKaminoVaultDelta = tokenDelta(smartToKamino, vault, usdc);
  const kaminoToSmartVaultDelta = tokenDelta(kaminoToSmart, vault, usdc);
  const smartToWalletVaultDelta = tokenDelta(smartToWallet, vault, usdc);
  const smartToWalletWalletDelta = tokenDelta(smartToWallet, wallet, usdc);
  const smartToKaminoLogs = smartToKamino.meta?.logMessages ?? [];
  const kaminoToSmartLogs = kaminoToSmart.meta?.logMessages ?? [];
  const depositExecuted = smartToKaminoLogs.some((line) =>
    line.includes("Instruction: DepositReserveLiquidityAndObligationCollateralV2")
  );
  const withdrawalExecuted = kaminoToSmartLogs.some((line) =>
    line.includes("Instruction: WithdrawObligationCollateralAndRedeemReserveCollateralV2")
  );
  const kaminoWithdrawalWithinRounding =
    kaminoToSmartVaultDelta >= 1_000_000n &&
    kaminoToSmartVaultDelta <= 1_000_002n;
  record(
    "reconciliation.move_deltas",
    walletToSmartWalletDelta === -2_000_000n &&
      walletToSmartVaultDelta === 2_000_000n &&
      smartToKaminoVaultDelta === -2_000_000n &&
      depositExecuted &&
      kaminoWithdrawalWithinRounding &&
      withdrawalExecuted &&
      smartToWalletVaultDelta === -1_000_000n &&
      smartToWalletWalletDelta === 1_000_000n,
    "wallet→smart→Kamino→smart→wallet deltas and exact Kamino instructions match the fixed 2/2/1/1 USDC walkthrough",
    `deltas wallet→smart=${walletToSmartWalletDelta}/${walletToSmartVaultDelta}; smart→Kamino=${smartToKaminoVaultDelta}, deposit=${depositExecuted}; Kamino→smart=${kaminoToSmartVaultDelta}, withdrawal=${withdrawalExecuted}; smart→wallet=${smartToWalletVaultDelta}/${smartToWalletWalletDelta}`
  );

  const moneyState = await readDemoMoneyState({
    commitment: "finalized",
    connection,
    settings: settingsAddress,
    wallet,
  });
  record(
    "live.three_chain_balances",
    moneyState.walletUsdcRaw > 0n &&
      moneyState.smartAccountUsdcRaw >= 0n &&
      moneyState.kaminoUsdcRaw > 0n,
    `finalized balances: wallet=${moneyState.walletUsdcRaw}, smart account=${moneyState.smartAccountUsdcRaw}, Kamino=${moneyState.kaminoUsdcRaw}`,
    `expected a spendable wallet balance, non-negative smart-account balance, and positive Kamino position; got ${moneyState.walletUsdcRaw}/${moneyState.smartAccountUsdcRaw}/${moneyState.kaminoUsdcRaw}`
  );
}

await verifyStatic();
if (!results.some((result) => result.status === "FAIL")) await verifyLive();
for (const result of results) console.log(`${result.status.padEnd(7)} ${result.id} — ${result.evidence}`);
const verdict = results.some((result) => result.status === "FAIL") ? "FAIL" : results.some((result) => result.status === "BLOCKED") ? "BLOCKED" : "PASS";
console.log(`\nVERDICT: ${verdict}`);
process.exit(verdict === "PASS" ? 0 : verdict === "BLOCKED" ? 2 : 1);
