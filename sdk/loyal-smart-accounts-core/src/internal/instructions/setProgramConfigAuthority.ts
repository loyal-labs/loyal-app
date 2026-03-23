import { PublicKey } from "@solana/web3.js";
import {
  createSetProgramConfigAuthorityInstruction,
  PROGRAM_ID,
} from "../generated";
import { getProgramConfigPda } from "../pda";

export function setProgramConfigAuthority({
  authority,
  newAuthority,
  programId = PROGRAM_ID,
}: {
  authority: PublicKey;
  newAuthority: PublicKey;
  programId?: PublicKey;
}) {
  const [programConfig] = getProgramConfigPda({ programId });

  return createSetProgramConfigAuthorityInstruction(
    {
      programConfig,
      authority,
    },
    {
      args: {
        newAuthority,
      },
    },
    programId
  );
}
