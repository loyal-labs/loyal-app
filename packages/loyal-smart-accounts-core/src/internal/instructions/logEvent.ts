import { PublicKey } from "@solana/web3.js";
import { createLogEventInstruction, PROGRAM_ID } from "../generated";

export function logEvent({
  logAuthority,
  event,
  programId = PROGRAM_ID,
}: {
  logAuthority: PublicKey;
  event: Uint8Array;
  programId?: PublicKey;
}) {
  return createLogEventInstruction(
    {
      logAuthority,
    },
    {
      args: {
        event,
      },
    },
    programId
  );
}
