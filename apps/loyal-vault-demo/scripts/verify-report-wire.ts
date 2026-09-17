import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { decodeReportWire } from "../src/features/vault/domain/report-wire";
const vector = JSON.parse(readFileSync(new URL("./fixtures/client-report-compiler-vector.json",import.meta.url),"utf8"));
const decoded=decodeReportWire(vector.wireBase64);
assert(decoded);
assert.equal(decoded.signed,false);
assert.equal(decoded.sequence,String(vector.request.Report.Sequence));
assert.equal(decoded.navRaw,String(vector.request.Report.NAVAfterRaw));
assert.equal(decoded.snapshotDigest,vector.request.Report.SnapshotDigest);
assert.equal(createHash("sha256").update(Buffer.from(decoded.messageBase64,"base64")).digest("hex"),vector.messageSHA256);
const wire=Buffer.from(vector.wireBase64,"base64");
// Every truncation must fail, not produce a partial report or a fabricated NAV.
for(let size=0;size<wire.length;size++)assert.equal(decodeReportWire(wire.subarray(0,size).toString("base64")),null);
assert.equal(decodeReportWire(vector.wireBase64+"="),null);
const armOffset=wire.indexOf(Buffer.from([164,175,246,41,178,140,35,3]));
const capitalOffset=wire.indexOf(Buffer.from([246,82,57,226,131,222,253,249]));
assert(armOffset>0 && capitalOffset>0);
for(const change of ["capital", "sequence", "nav", "digest", "mode"]){
 const changed=Buffer.from(wire);
 if(change==="capital"){changed.writeBigUInt64LE(1n,armOffset+9);changed.writeBigUInt64LE(1n,capitalOffset+8);}
 if(change==="sequence"){changed[capitalOffset+35]^=1;changed[armOffset+23]^=1;}
 if(change==="nav"){changed.writeBigUInt64LE(1_000_000_000_001n,capitalOffset+51);changed.writeBigUInt64LE(1_000_000_000_001n,armOffset+39);}
 if(change==="digest"){changed.fill(0,capitalOffset+59,capitalOffset+91);changed.fill(0,armOffset+47,armOffset+79);}
 if(change==="mode")changed[armOffset+8]=1;
 assert.equal(decodeReportWire(changed.toString("base64")),null,change);
}
console.log(JSON.stringify({proofLevel:"CURRENT_GO_COMPILER_PARITY_NOT_FINALIZED_NAV",truncationsRejected:wire.length,semanticMutationsRejected:5,report:decoded.sequence}));
