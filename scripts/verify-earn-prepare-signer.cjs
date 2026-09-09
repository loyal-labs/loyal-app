// Inert signer-boundary regression: execute actual hook callbacks, not source
// substring assertions. No RPC, secrets, wallet prompts or transactions.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const ts = require(path.join(root, "node_modules/typescript"));
const hookFile = "apps/web/src/hooks/use-smart-account-sidebar-data.ts";
const actionsFile =
  "apps/web/src/components/wallet-workspace/facelift/use-earn-actions.ts";
function callback(file, name, dependencies) {
  const ast = ts.createSourceFile(
    file,
    fs.readFileSync(path.join(root, file), "utf8"),
    ts.ScriptTarget.Latest,
    true
  );
  let expression;
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(ast) === name &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    ) {
      expression = node.initializer.arguments[0].getText(ast);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(expression, `Missing actual callback ${name}`);
  const code = ts.transpileModule(`const actual = (${expression}); actual;`, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  return vm.runInNewContext(code, dependencies, { filename: file });
}
class PublicKey {
  constructor(value) {
    this.value = value;
  }
  toBase58() {
    return this.value;
  }
}
const pk = (value) => new PublicKey(value);
async function main() {
  let prepares = 0;
  let signingAttempts = 0;
  let reconnects = 0;
  let signIns = 0;
  const policy = { account: "policy", seed: "7", setupPolicy: null };
  const client = {
    prepareEarnUsdcWithdraw: async (input) => {
      prepares++;
      return input;
    },
  };
  const base = {
    PublicKey,
    overview: { settingsPda: "settings", programId: "program" },
    user: { walletAddress: "authenticated", settingsPda: "settings" },
    earnState: {
      settingsPda: "settings",
      policySignerPublicKey: "policy-signer",
    },
    connection: {},
    solanaEnv: "devnet",
    confirmedClientEarnPolicy: { resolve: () => policy },
    resolveEarnLoyalCluster: () => "devnet",
    createSmartAccountVaultsClient: () => client,
  };
  for (const publicKey of [null, pk("other-wallet"), pk("authenticated")]) {
    const wallet = { publicKey };
    const context = callback(hookFile, "getEarnAutodepositPrepareContext", {
      ...base,
      wallet,
    });
    const prepare = callback(hookFile, "prepareEarnWithdraw", {
      ...base,
      getEarnAutodepositPrepareContext: context,
      resolveRequiredClientEarnPolicy: async () => policy,
    });
    const prepared = await prepare({ amountRaw: 1n, mode: "partial" });
    assert.equal(prepared.walletAddress.toBase58(), "authenticated");
    assert.equal(prepared.feePayer.toBase58(), "authenticated");
    assert.equal(context().signer.toBase58(), "authenticated");
    const canSign = publicKey?.toBase58() === "authenticated";
    const gate = callback(actionsFile, "ensureCanSignAccountAction", {
      authenticatedWalletAddress: "authenticated",
      canSignAccountActions: canSign,
      openSignIn: () => {
        signIns++;
      },
      setIsReconnectPromptOpen: (open) => {
        assert.equal(open, true);
        reconnects++;
      },
    });
    assert.equal(
      gate(),
      canSign,
      "preparation must reach the normal reconnect gate"
    );
    if (!canSign) {
      for (const name of [
        "executeEarnWithdraw",
        "executeEarnCleanup",
        "executeEarnAutodepositSetup",
        "executeEarnAutodepositClose",
      ]) {
        const execute = callback(hookFile, name, {
          ...base,
          wallet,
          createWalletAdapterBridge: () => {
            signingAttempts++;
            throw new Error("Unauthorized signing");
          },
        });
        const result = await execute({ amountRaw: 1n });
        assert.equal(
          result.success,
          false,
          `${name} must reject absent/mismatched signer`
        );
        assert.match(
          result.error,
          publicKey ? /does not match/ : /Connect the authenticated wallet/
        );
      }
    }
  }
  assert.equal(prepares, 3);
  assert.equal(reconnects, 2);
  assert.equal(signingAttempts, 0);
  assert.equal(signIns, 0);
  for (const override of [
    { user: null },
    { overview: { settingsPda: "other-settings", programId: "program" } },
    {
      earnState: {
        settingsPda: "other-settings",
        policySignerPublicKey: "policy-signer",
      },
    },
  ]) {
    const context = callback(hookFile, "getEarnAutodepositPrepareContext", {
      ...base,
      wallet: { publicKey: null },
      ...override,
    });
    assert.throws(context, /authenticated wallet|account changed/);
  }
  assert.equal(
    prepares,
    3,
    "invalid session/scope must not reach SDK preparation"
  );
  console.info(
    "PASS: restored-session preparation reaches reconnect; authenticated identity stays fixed; wrong-wallet execution and stale scopes reject before signing"
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
