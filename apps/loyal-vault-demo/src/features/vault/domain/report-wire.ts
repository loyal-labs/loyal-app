import { Buffer } from "buffer";
import { VAULT_IDENTITY as V } from "./identity";
import { auditWire } from "./transactions";

const SQUADS = "SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG";
const DELEGATE = "62JLkPeE4oG65LRB3W3m52RVicmYq3xFHdv7TecCsPj5";
const POLICY = "AyymPJEAEN5YFySuEDVkdU9PTjBarj2y2UJxQ4rznjXr";
const ADAPTOR = V.expectedAdaptorProgramByStrategy[V.adaptorConfigStrategy]!;
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
const prefix = (data: Buffer, bytes: readonly number[]) => bytes.every((value, i) => data[i] === value);

export type ReportWire = Readonly<{
  sequence: string; observedSlot: string; navRaw: string; snapshotDigest: string;
  messageBase64: string; primarySignature: string; signed: boolean;
  inner: readonly { program: string; accounts: readonly string[]; dataBase64: string }[];
}>;

/** Decode only the pinned zero-capital REPORT_NAV shape. No finality or NAV freshness claim. */
export function decodeReportWire(wire: string): ReportWire | null {
  try {
    const audit = auditWire(wire);
    if (!audit.ok || audit.signatureCount !== 1 || audit.feePayer !== DELEGATE || !same(audit.requiredSigners, [DELEGATE]) || audit.instructions.length !== 1) return null;
    const outer = audit.instructions[0]!;
    if (outer.programAddress !== SQUADS || !same(outer.accountAddresses.slice(0, 3), [POLICY, SQUADS, DELEGATE])) return null;
    const data = Buffer.from(outer.dataBase64, "base64");
    if (data.length < 26 || !prefix(data, [90,81,187,81,39,70,128,78,0,1,1,1,1]) || data.readUInt32LE(13) !== 2 || !prefix(data.subarray(17), [0,1,1,0]) || data.readUInt32LE(21) !== data.length-25 || data[25] !== 2) return null;
    let offset = 26;
    const local = outer.accountAddresses.slice(3);
    const inner: { program: string; accounts: string[]; data: Buffer }[] = [];
    for (let n=0;n<2;n++) {
      if (offset+2>data.length) return null;
      const program = local[data[offset++]!]; const count = data[offset++]!;
      if (!program || offset+count+2>data.length) return null;
      const indexes = [...data.subarray(offset,offset+count)]; offset+=count;
      const accounts = indexes.map(index=>local[index]); if (accounts.some(value=>value===undefined)) return null;
      const length = data.readUInt16LE(offset); offset+=2;
      if (offset+length>data.length) return null;
      inner.push({program,accounts:accounts as string[],data:data.subarray(offset,offset+length)}); offset+=length;
    }
    if (offset!==data.length) return null;
    const [arm, capital]=inner;
    if (!arm || !capital || arm.program!==ADAPTOR || capital.program!==V.voltrProgram ||
      !same(arm.accounts,[V.adaptorConfigStrategy,V.reportTicket,V.smartAccountSettings,V.manager,SQUADS]) ||
      !same(capital.accounts,[V.manager,"4sycXz9Xwevedo6eiXR8QEhY8yrQrkNS4G1deY9tAD2Y",V.vault,V.adaptorConfigStrategy,
        "AsfkxMdVYjMnr2fdTBMUXhq81hgi2hbENXCy9WhUQF7u","5bw4VYzpZXsk9SUNyWwJkb4fEx1DS8eNMFB6Qb4MUfhE",
        "EoHz6FHTL34F6HjuJmb5EceaRqxRG1RMYwYWKtWkGBFb","5r74AE7yewacfRzoGAjXx5X3gM9LUoLU29eHzdjiLrJo",
        V.assetMint,V.lpMint,"6LATwaB4yRwGURCBDyFeJGqofaXxb6xXws9wBGbr3RBh","EPCVCLY5wfumf6yPvqu7zuEB4WnnXbnPsy7JrKoAWcqC",
        V.tokenProgram,ADAPTOR,V.smartAccountSettings,V.manager,"EBG2iYrcXttDy9FpWDeNVL8uaCLRCkevrpRyrAhvVYKe",V.reportTicket])) return null;
    const a=arm.data,c=capital.data;
    if (a.length!==79 || !prefix(a,[164,175,246,41,178,140,35,3,0]) || c.length!==91 ||
      !prefix(c,[246,82,57,226,131,222,253,249]) || c.readBigUInt64LE(8)!==0n || c[16]!==1 || c.readUInt32LE(17)!==8 ||
      !prefix(c.subarray(21),[242,35,198,137,82,225,242,182,1]) || c.readUInt32LE(30)!==57 ||
      !a.subarray(9).equals(Buffer.concat([c.subarray(8,16),c.subarray(29)])) || c[34]!==1) return null;
    const sequence=c.readBigUInt64LE(35),slot=c.readBigUInt64LE(43),nav=c.readBigUInt64LE(51),digest=c.subarray(59);
    if (sequence===0n || sequence!==slot || nav>1_000_000_000_000n || digest.every(v=>v===0)) return null;
    return {sequence:sequence.toString(),observedSlot:slot.toString(),navRaw:nav.toString(),snapshotDigest:digest.toString("hex"),messageBase64:audit.messageBase64,primarySignature:audit.primarySignatureBase58,signed:!audit.signaturesZeroed,inner:inner.map(row=>({program:row.program,accounts:row.accounts,dataBase64:row.data.toString("base64")}))};
  } catch { return null; }
}
