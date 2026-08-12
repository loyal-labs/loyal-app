import { accounts } from "@loyal-labs/loyal-smart-accounts";
import { Connection, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { SQUADS_PROGRAM_ID } from "./constants";

export type DiscoveredSmartAccount = {
  settings: PublicKey;
  threshold: number;
  timeLock: number;
  transactionIndex: bigint;
  signerAddresses: string[];
  signerPermissionMasks: Record<string, number>;
  eligible: boolean;
  eligibilityReason: string;
};

export function decodeOwnedSettingsAccount(args: {
  data: Buffer;
  owner: PublicKey;
  pubkey: PublicKey;
}): DiscoveredSmartAccount | null {
  if (!args.owner.equals(SQUADS_PROGRAM_ID)) return null;
  const discriminator = Buffer.from(accounts.settingsDiscriminator);
  if (
    args.data.length < discriminator.length ||
    !args.data.subarray(0, discriminator.length).equals(discriminator)
  ) {
    return null;
  }

  try {
    const [settings] = accounts.Settings.deserialize(args.data);
    return {
      settings: args.pubkey,
      threshold: settings.threshold,
      timeLock: settings.timeLock,
      transactionIndex: BigInt(settings.transactionIndex.toString()),
      signerAddresses: settings.signers.map((signer) => signer.key.toBase58()),
      signerPermissionMasks: Object.fromEntries(
        settings.signers.map((signer) => [
          signer.key.toBase58(),
          signer.permissions.mask,
        ])
      ),
      eligible: false,
      eligibilityReason: "Signer eligibility has not been evaluated.",
    };
  } catch {
    return null;
  }
}

export function matchSmartAccountSigner(
  value: DiscoveredSmartAccount,
  signer: PublicKey
): DiscoveredSmartAccount | null {
  const address = signer.toBase58();
  if (!value.signerAddresses.includes(address)) return null;
  const permissionMask = value.signerPermissionMasks[address] ?? 0;
  const eligible =
    value.threshold === 1 &&
    value.timeLock === 0 &&
    (permissionMask & 0b111) === 0b111;
  return {
    ...value,
    eligible,
    eligibilityReason: eligible
      ? "Eligible: threshold 1, no timelock, all root permissions."
      : "Signer match only: this demo requires threshold 1, no timelock, and all root permissions.",
  };
}

export async function findSmartAccountsForSigner(
  connection: Connection,
  signer: PublicKey
): Promise<DiscoveredSmartAccount[]> {
  const rows = await connection.getProgramAccounts(SQUADS_PROGRAM_ID, {
    commitment: "finalized",
    filters: [
      {
        memcmp: {
          offset: 0,
          bytes: bs58.encode(Uint8Array.from(accounts.settingsDiscriminator)),
        },
      },
    ],
  });

  return rows
    .map(({ account, pubkey }) =>
      decodeOwnedSettingsAccount({
        data: account.data,
        owner: account.owner,
        pubkey,
      })
    )
    .filter((value): value is DiscoveredSmartAccount => value !== null)
    .map((value) => matchSmartAccountSigner(value, signer))
    .filter((value): value is DiscoveredSmartAccount => value !== null)
    .sort((a, b) => a.settings.toBase58().localeCompare(b.settings.toBase58()));
}
