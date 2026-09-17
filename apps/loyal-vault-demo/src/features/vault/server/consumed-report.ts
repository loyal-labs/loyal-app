import { createHash } from "node:crypto";
import bs58 from "bs58";
import { neon } from "@neondatabase/serverless";
import { decodeReportWire } from "../domain/report-wire";
import { auditWire } from "../domain/transactions";
import { VAULT_IDENTITY as V } from "../domain/identity";
import type { NavFreshnessView } from "../domain/types";
import type { VaultCore } from "./coherent-batch";
import { TransactionReadRpc, type FinalizedTransaction } from "./transaction-rpc";

import { BoundedRpc } from "./rpc";
import { RPC_BOUNDS, rpcUrlFromEnv } from "./config";

export type ReportMatchCore = Pick<VaultCore, "slot" | "chainTimeSec" | "assetTotalValue" | "idleCustodyRaw" | "reportTicket" | "strategyAttributions"> & {
 vault: Pick<VaultCore["vault"], "lastUpdatedTs">;
 adaptorReport: Pick<NonNullable<VaultCore["adaptorReport"]>, "bindingsMatchPinned" | "maxReportAgeSlots" | "maxReportNavRaw" | "configAddress" | "adaptorProgram"> | null;
};

// The journal locates a transaction; candidate observation.report* is not evidence.
// The route-pinned pilot_report_locators view exposes only signature,
// message_sha256 and confirmed_slot (operation_id/updated_at are ordering
// keys); no signed wire, signer material, lease owner or recovery text is
// selected. Finalized-RPC wire/trace verification below is unchanged.
export const CONSUMED_REPORT_SQL = `SELECT transaction_signature AS signature,
 message_sha256 AS message_hash, confirmed_slot::text AS confirmed_slot
 FROM loyal_yield.pilot_report_locators
 WHERE confirmed_slot IS NOT NULL AND transaction_signature IS NOT NULL
 ORDER BY confirmed_slot DESC, updated_at DESC, operation_id DESC LIMIT 1`;
export type ReportLocator = Readonly<{ signature: string; message_hash: string; confirmed_slot: string }>;

export function unknownConsumedReport(core: ReportMatchCore, detail: string): NavFreshnessView {
 return {status:"unknown",detail,vaultLastUpdatedTs:core.vault.lastUpdatedTs.toString(),observedSlot:core.slot};
}

/** A finalized report is historical accounting evidence, not worker or deposit readiness. */
export function matchConsumedReport(core: ReportMatchCore, locator: ReportLocator, tx: FinalizedTransaction): NavFreshnessView {
 const unknown=(detail: string)=>unknownConsumedReport(core,detail);
 const report=decodeReportWire(tx.transactionBase64),audit=auditWire(tx.transactionBase64);
 if (!report || !audit.ok || !report.signed || report.primarySignature!==locator.signature || tx.err!==null || tx.usesAddressLookupTables ||
  !Number.isSafeInteger(tx.slot) || tx.slot<=0 || locator.confirmed_slot!==String(tx.slot) ||
  createHash("sha256").update(Buffer.from(report.messageBase64,"base64")).digest("hex")!==locator.message_hash) return unknown("The finalized transaction does not match the recorded report.");
 const trace=tx.innerInstructions;
 if (!trace) return unknown("The finalized report execution trace is unavailable.");
 const same=(a:readonly string[],b:readonly string[])=>a.length===b.length&&a.every((v,i)=>v===b[i]);
 const decoded=trace.map(row=>({outer:row.outerIndex,program:audit.accountKeys[row.programIdIndex],accounts:row.accounts.map(index=>audit.accountKeys[index]??""),data:Buffer.from(bs58.decode(row.dataBase58))}));
 const indexOf=(expected:typeof report.inner[number],after:number)=>decoded.findIndex((row,i)=>i>after&&row.outer===0&&row.program===expected.program&&same(row.accounts,expected.accounts)&&row.data.toString("base64")===expected.dataBase64);
 const arm=indexOf(report.inner[0]!,-1),capital=indexOf(report.inner[1]!,arm);
 // Deployed adaptor v2 takes nine accounts (processor at 6cd3a81).
 const capitalWire=Buffer.from(report.inner[1]!.dataBase64,"base64");
 const consumeData=Buffer.concat([capitalWire.subarray(21,29),capitalWire.subarray(8,16),capitalWire.subarray(29)]);
 const consumeAccounts=[7,3,8,11,12,14,15,16,17].map(index=>report.inner[1]!.accounts[index]!);
 const consume=decoded.findIndex((row,i)=>i>capital&&row.outer===0&&row.program===report.inner[0]!.program&&same(row.accounts,consumeAccounts)&&row.data.equals(consumeData));
 if (arm<0||capital<=arm||consume<=capital) return unknown("The finalized report was not observed through the pinned arm and consume calls.");
 const config=core.adaptorReport,ticket=core.reportTicket;
 const receipt=core.strategyAttributions.find(row=>row.strategy===V.adaptorConfigStrategy&&row.status==="attributed");
 if (!config?.bindingsMatchPinned || !ticket || ticket.armed || ticket.lastConsumedSequence!==report.sequence || receipt?.status!=="attributed" || receipt.positionValueRaw.toString()!==report.navRaw) return unknown("The current ticket or strategy receipt does not match this consumed report.");
 const observed=BigInt(report.observedSlot),landed=BigInt(tx.slot),current=BigInt(core.slot),limit=BigInt(config.maxReportAgeSlots);
 if (limit<=0n||limit>32n||observed>landed||landed>current||landed-observed>limit||BigInt(report.navRaw)>BigInt(config.maxReportNavRaw)) return unknown("The report falls outside its observed and consumed slot bounds.");
 if (core.assetTotalValue!==core.idleCustodyRaw+receipt.positionValueRaw+receipt.custodyTrackedRaw) return unknown("The vault book does not match idle custody and its strategy receipt.");
 // The 32-slot adaptor bound applies when a report is consumed. After
 // finality, ongoing freshness follows the worker's 60-second NAV cadence.
 // Bind that clock to this exact report's receipt, never a later vault edit.
 if (tx.blockTimeSec===null || tx.blockTimeSec<=0n || receipt.lastUpdatedTs!==tx.blockTimeSec || core.chainTimeSec<tx.blockTimeSec) return unknown("The report timestamp does not match its strategy receipt and current chain clock.");
 const navAge=core.chainTimeSec-tx.blockTimeSec,maxNavAge=60n;
 const fresh=navAge<maxNavAge,age=current-observed;
 return {status:fresh?"fresh":"stale",detail:fresh?"A finalized report matches the current ticket and strategy receipt. Current strategy reconciliation and service readiness are separate checks.":"The matching consumed report is older than the permitted NAV observation window.",
  reportSignature:locator.signature,reportConfirmedSlot:tx.slot,
  vaultLastUpdatedTs:core.vault.lastUpdatedTs.toString(),observedSlot:core.slot,adaptorProgram:config.adaptorProgram,configAddress:config.configAddress,
  lastSequence:report.sequence,lastObservedSlot:report.observedSlot,lastNavRaw:report.navRaw,maxReportNavRaw:config.maxReportNavRaw,maxReportAgeSlots:config.maxReportAgeSlots,ageSlots:age.toString(),navAgeSeconds:navAge.toString(),maxNavAgeSeconds:maxNavAge.toString(),bindingsMatchPinned:true};
}

export async function readConsumedReport(core: ReportMatchCore, observationStartedAt = performance.now()): Promise<NavFreshnessView> {
 if (!core.reportTicket || core.reportTicket.armed || core.reportTicket.lastConsumedSequence==="0") return unknownConsumedReport(core,"No disarmed consumed-report ticket is available at this slot.");
 const url=process.env.LOYAL_VAULT_DEMO_OBSERVATION_DATABASE_URL;
 if (!url) return unknownConsumedReport(core,"Consumed-report journal access is not configured.");
 const deadline=Math.min(performance.now()+3000,observationStartedAt+RPC_BOUNDS.maxStalenessMs);
 const remaining=()=>{const ms=Math.floor(deadline-performance.now());if(ms<=0)throw new Error("Report deadline exceeded");return ms;};
 try {
  const sql=neon(url);
  const [rows]=await sql.transaction([sql.query(CONSUMED_REPORT_SQL)],{readOnly:true,isolationLevel:"RepeatableRead",fetchOptions:{signal:AbortSignal.timeout(remaining())}});
  const row=rows[0];
  if (rows.length!==1||typeof row?.signature!=="string"||bs58.decode(row.signature).length!==64||typeof row.message_hash!=="string"||!/^[a-f0-9]{64}$/.test(row.message_hash)||typeof row.confirmed_slot!=="string"||!/^[1-9][0-9]*$/.test(row.confirmed_slot)) return unknownConsumedReport(core,"A valid report transaction locator is unavailable.");
  const rpcUrl=rpcUrlFromEnv();
  const cluster=await new BoundedRpc(rpcUrl,remaining(),1).getGenesisHash();if(!cluster.ok)return unknownConsumedReport(core,"The report RPC cluster could not be verified.");
  const tx=await new TransactionReadRpc(rpcUrl,remaining(),1).getFinalizedTransaction(row.signature);
  if(!tx.ok||!tx.value)return unknownConsumedReport(core,"The report transaction is not available at finalized commitment.");
  remaining(); // An expired account snapshot must never become fresh after a slow lookup.
  return matchConsumedReport(core,row as ReportLocator,tx.value);
 } catch { return unknownConsumedReport(core,"Consumed-report evidence could not be verified."); }
}
