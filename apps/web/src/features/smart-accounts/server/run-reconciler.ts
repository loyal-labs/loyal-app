import { reconcileRecoverableSmartAccounts } from "./reconciler";

const limitArg = Number.parseInt(process.argv[2] ?? "", 10);
const limit = Number.isFinite(limitArg) && limitArg > 0 ? limitArg : undefined;

const result = await reconcileRecoverableSmartAccounts({ limit });
console.info("[smart-accounts] reconciliation summary", result);
