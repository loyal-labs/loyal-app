/** Controlled RPC-result fixtures; fake signature bytes are never chain evidence. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import bs58 from "bs58";
import { decodeReportWire } from "../src/features/vault/domain/report-wire";
import { auditWire } from "../src/features/vault/domain/transactions";
import { VAULT_IDENTITY as V } from "../src/features/vault/domain/identity";
import { matchConsumedReport, readConsumedReport, type ReportMatchCore } from "../src/features/vault/server/consumed-report";
import type { FinalizedTransaction } from "../src/features/vault/server/transaction-rpc";
const vector=JSON.parse(readFileSync(new URL("./fixtures/client-report-compiler-vector.json",import.meta.url),"utf8"));
const bytes=Buffer.from(vector.wireBase64,"base64");bytes.fill(1,1,65);
const wire=bytes.toString("base64"),report=decodeReportWire(wire),audit=auditWire(wire);assert(report&&audit.ok);
const slot=Number(report.observedSlot);
const locator={signature:report.primarySignature,message_hash:vector.messageSHA256,confirmed_slot:String(slot+2)};
const trace=report.inner.map(row=>({outerIndex:0,programIdIndex:audit.accountKeys.indexOf(row.program),accounts:row.accounts.map(a=>audit.accountKeys.indexOf(a)),dataBase58:bs58.encode(Buffer.from(row.dataBase64,"base64"))}));
const capitalData=Buffer.from(report.inner[1]!.dataBase64,"base64");
const consumeData=Buffer.concat([capitalData.subarray(21,29),capitalData.subarray(8,16),capitalData.subarray(29)]);
trace.push({outerIndex:0,programIdIndex:trace[0]!.programIdIndex,accounts:[7,3,8,11,12,14,15,16,17].map(index=>audit.accountKeys.indexOf(report.inner[1]!.accounts[index]!)),dataBase58:bs58.encode(consumeData)});
const tx:FinalizedTransaction={slot:slot+2,blockTimeSec:1n,feeLamports:5000n,err:null,usesAddressLookupTables:false,transactionBase64:wire,preTokenBalances:[],postTokenBalances:[],preBalances:[],postBalances:[],innerInstructions:trace};
const core={slot:slot+3,chainTimeSec:2n,vault:{lastUpdatedTs:1n},assetTotalValue:1234590n,idleCustodyRaw:23n,
 adaptorReport:{bindingsMatchPinned:true,maxReportAgeSlots:"32",maxReportNavRaw:"1000000000000",configAddress:V.adaptorConfigStrategy,adaptorProgram:report.inner[0]!.program},
 reportTicket:{armed:false,lastConsumedSequence:report.sequence},strategyAttributions:[{status:"attributed",receiptAddress:"5bw4VYzpZXsk9SUNyWwJkb4fEx1DS8eNMFB6Qb4MUfhE",adaptorProgram:report.inner[0]!.program,lastUpdatedTs:1n,strategy:V.adaptorConfigStrategy,positionValueRaw:1234567n,custodyTrackedRaw:0n}]} satisfies ReportMatchCore;
let checks=0;
assert.equal(matchConsumedReport(core,locator,tx).status,"fresh");checks++;
// Finality can exceed the consume window while the matched NAV is current.
assert.equal(matchConsumedReport({...core,slot:slot+100,chainTimeSec:60n},locator,tx).status,"fresh");checks++;
assert.equal(matchConsumedReport({...core,slot:slot+100,chainTimeSec:61n},locator,tx).status,"stale");checks++;
assert.equal(matchConsumedReport({...core,slot:slot+100}, {...locator,confirmed_slot:String(slot+33)}, {...tx,slot:slot+33}).status,"unknown");checks++;
assert.equal(matchConsumedReport(core,locator,{...tx,blockTimeSec:null}).status,"unknown");checks++;
assert.equal(matchConsumedReport(core,locator,{...tx,blockTimeSec:2n}).status,"unknown");checks++;
assert.equal(matchConsumedReport({...core,chainTimeSec:0n},locator,tx).status,"unknown");checks++;
for(let index=0;index<consumeData.length;index++) {
 const changed=Buffer.from(consumeData);changed[index]^=1;
 assert.equal(matchConsumedReport(core,locator,{...tx,innerInstructions:[...trace.slice(0,2),{...trace[2]!,dataBase58:bs58.encode(changed)}]}).status,"unknown");checks++;
}
for(let index=0;index<9;index++) {
 const accounts=[...trace[2]!.accounts];accounts[index]=audit.accountKeys.indexOf(V.vault);
 assert.equal(matchConsumedReport(core,locator,{...tx,innerInstructions:[...trace.slice(0,2),{...trace[2]!,accounts}]}).status,"unknown");checks++;
}
for(const altered of [
 {...tx,err:"failed"},{...tx,usesAddressLookupTables:true},{...tx,transactionBase64:vector.wireBase64},
 {...tx,slot:slot-1},{...tx,innerInstructions:null},{...tx,innerInstructions:trace.slice(0,2)},
 {...tx,innerInstructions:[trace[1]!,trace[0]!,trace[2]!]},
]){assert.equal(matchConsumedReport(core,locator,altered).status,"unknown");checks++;}
for(const altered of [
 {...core,slot:slot+1},{...core,assetTotalValue:1n},
 {...core,reportTicket:{armed:true,lastConsumedSequence:report.sequence}},
 {...core,reportTicket:{armed:false,lastConsumedSequence:"0"}},
 {...core,strategyAttributions:[]},
 {...core,adaptorReport:{...core.adaptorReport!,bindingsMatchPinned:false}},
]){assert.equal(matchConsumedReport(altered,locator,tx).status,"unknown");checks++;}
for(const changed of [{...locator,signature:bs58.encode(Buffer.alloc(64,2))},{...locator,message_hash:"0".repeat(64)},{...locator,confirmed_slot:String(slot)}]){assert.equal(matchConsumedReport(core,changed,tx).status,"unknown");checks++;}
assert.equal((await readConsumedReport({...core,reportTicket:{armed:false,lastConsumedSequence:"0"}})).status,"unknown");checks++;
const previousUrl=process.env.LOYAL_VAULT_DEMO_OBSERVATION_DATABASE_URL;
process.env.LOYAL_VAULT_DEMO_OBSERVATION_DATABASE_URL="postgresql://fixture:fixture@localhost/fixture";
try {
 assert.equal((await readConsumedReport(core,performance.now()-16000)).status,"unknown");checks++;
} finally {
 if(previousUrl===undefined)delete process.env.LOYAL_VAULT_DEMO_OBSERVATION_DATABASE_URL;
 else process.env.LOYAL_VAULT_DEMO_OBSERVATION_DATABASE_URL=previousUrl;
}
console.log(JSON.stringify({proofLevel:"CONTROLLED_CONSUMED_REPORT_MATCH_NOT_LIVE_NAV",checks}));
