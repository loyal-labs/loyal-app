import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import {
  createInitializeProgramConfigInstruction,
  PROGRAM_ID,
} from "../generated";
import { getProgramConfigPda } from "../pda";

export function initializeProgramConfig({
  initializer,
  authority,
  smartAccountCreationFee,
  treasury,
  programId = PROGRAM_ID,
}: {
  initializer: PublicKey;
  authority: PublicKey;
  smartAccountCreationFee: BN | bigint | number | string;
  treasury: PublicKey;
  programId?: PublicKey;
}) {
  const [programConfig] = getProgramConfigPda({ programId });

  return createInitializeProgramConfigInstruction(
    {
      programConfig,
      initializer,
    },
    {
      args: {
        authority,
        smartAccountCreationFee: new BN(smartAccountCreationFee.toString()),
        treasury,
      },
    },
    programId
  );
}
