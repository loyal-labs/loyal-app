/** Read-only deployed account contract verification; never signs or sends. */
import { VAULT_IDENTITY } from "../src/features/vault/domain/identity";
import {
  buildCoherentVaultCore,
  decodeAdaptorConfig,
  decodeReportTicket,
  deriveIdleAuthority,
  deriveVaultBatchAddresses,
} from "../src/features/vault/server/coherent-batch";
import { BoundedRpc } from "../src/features/vault/server/rpc";
import { rpcUrlFromEnv } from "../src/features/vault/server/config";

if (process.argv.slice(2).join(" ") !== "--live") {
  throw new Error("Explicit --live is required for read-only mainnet verification");
}
const rpc = new BoundedRpc(rpcUrlFromEnv());
const genesis = await rpc.getGenesisHash();
if (!genesis.ok || genesis.value !== VAULT_IDENTITY.expectedGenesisHash) {
  throw new Error("Mainnet genesis could not be verified");
}
const batch = await deriveVaultBatchAddresses();
const observed = await rpc.getMultipleAccounts(batch.map(entry => entry.address));
if (!observed.ok || observed.contextSlot === null) throw new Error("Finalized batch unavailable");
const options = { idleAuthority: await deriveIdleAuthority() };
const core = buildCoherentVaultCore(batch, observed.value, observed.contextSlot, options);
if (!core.ok) throw new Error(core.reason);
if (!core.core.reportTicket) throw new Error("Current report ticket could not be validated");
const strategy = VAULT_IDENTITY.adaptorConfigStrategy;
const receipt = core.core.strategyAttributions.find(entry => entry.strategy === strategy);
if (receipt?.status !== "attributed" || !core.core.managerCustody || !core.core.adaptorReport?.bindingsMatchPinned) {
  throw new Error("Current pilot custody/configuration could not be attributed");
}
const configIndex = batch.findIndex(entry => entry.key === `adaptorConfig:${strategy}`);
const config = observed.value[configIndex]!;
const ticket = observed.value[batch.findIndex(entry => entry.key === "reportTicket")]!;
if (decodeReportTicket({ ...ticket, executable: true }) || decodeReportTicket({ ...ticket, executable: undefined })) {
  throw new Error("Unproven non-executable report ticket accepted");
}
for (const offset of [0, 8, 9, 11, 16]) {
  const data = new Uint8Array(ticket.data); data[offset] ^= 1;
  if (decodeReportTicket({ ...ticket, data })) throw new Error(`Ticket mutation accepted at ${offset}`);
}
const incoherent = new Uint8Array(ticket.data); incoherent[10] = 0; incoherent[56] = 1;
if (decodeReportTicket({ ...ticket, data: incoherent })) throw new Error("Unarmed active ticket accepted");
for (const offset of [400, 408, 416, 440]) {
  const data = new Uint8Array(config.data);
  data[offset] ^= 1;
  const decoded = decodeAdaptorConfig({ ...config, data }, strategy);
  if (decoded.ok && decoded.bindingsMatchPinned) throw new Error(`Config mutation accepted at ${offset}`);
}
const receiptIndex = batch.findIndex(entry => entry.key === `strategyReceipt:${strategy}`);
for (const offset of [120, 123, 136]) {
  const accounts = observed.value.map(account => account ? { ...account, data: new Uint8Array(account.data) } : null);
  accounts[receiptIndex]!.data[offset] ^= 1;
  const mutated = buildCoherentVaultCore(batch, accounts, observed.contextSlot, options);
  if (mutated.ok && mutated.core.managerCustody) throw new Error(`Receipt mutation attributed at ${offset}`);
}
console.log(JSON.stringify({
  proofLevel: "FINALIZED_ACCOUNT_READER_NOT_DEPOSIT_READINESS",
  slot: observed.contextSlot,
  strategy,
  receipt,
  managerCustody: core.core.managerCustody,
  reportTicket: core.core.reportTicket,
  mutationChecks: "PASS",
}, (_, value) => typeof value === "bigint" ? value.toString() : value));
