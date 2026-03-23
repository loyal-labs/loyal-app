import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import {
  createSetProgramConfigSmartAccountCreationFeeInstruction,
  PROGRAM_ID,
} from "../generated";
import { getProgramConfigPda } from "../pda";

export function setProgramConfigSmartAccountCreationFee({
  authority,
  smartAccountCreationFee,
  programId = PROGRAM_ID,
}: {
  authority: PublicKey;
  smartAccountCreationFee: BN | bigint | number | string;
  programId?: PublicKey;
}) {
  const [programConfig] = getProgramConfigPda({ programId });

  return createSetProgramConfigSmartAccountCreationFeeInstruction(
    {
      programConfig,
      authority,
    },
    {
      args: {
        newSmartAccountCreationFee: new BN(smartAccountCreationFee.toString()),
      },
    },
    programId
  );
}
