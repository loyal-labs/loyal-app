import { PublicKey } from "@solana/web3.js";
import {
  createSetProgramConfigTreasuryInstruction,
  PROGRAM_ID,
} from "../generated";
import { getProgramConfigPda } from "../pda";

export function setProgramConfigTreasury({
  authority,
  treasury,
  programId = PROGRAM_ID,
}: {
  authority: PublicKey;
  treasury: PublicKey;
  programId?: PublicKey;
}) {
  const [programConfig] = getProgramConfigPda({ programId });

  return createSetProgramConfigTreasuryInstruction(
    {
      programConfig,
      authority,
    },
    {
      args: {
        newTreasury: treasury,
      },
    },
    programId
  );
}
