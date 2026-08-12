export const PDA_REGISTRY = {
  programConfig: {
    seeds: ["smart_account", "program_config"],
  },
  settings: {
    seeds: ["smart_account", "settings", "accountIndex:u128"],
  },
  smartAccount: {
    seeds: [
      "smart_account",
      "settingsPda:pubkey",
      "smart_account",
      "accountIndex:u8",
    ],
  },
  transaction: {
    seeds: [
      "smart_account",
      "settingsPda:pubkey",
      "transaction",
      "transactionIndex:u64",
    ],
  },
  proposal: {
    seeds: [
      "smart_account",
      "settingsPda:pubkey",
      "transaction",
      "transactionIndex:u64",
      "proposal",
    ],
  },
  batchTransaction: {
    seeds: [
      "smart_account",
      "settingsPda:pubkey",
      "transaction",
      "batchIndex:u64",
      "batch_transaction",
      "transactionIndex:u32",
    ],
  },
  ephemeralSigner: {
    seeds: [
      "smart_account",
      "transactionPda:pubkey",
      "ephemeral_signer",
      "ephemeralSignerIndex:u8",
    ],
  },
  spendingLimit: {
    seeds: [
      "smart_account",
      "settingsPda:pubkey",
      "spending_limit",
      "seed:pubkey",
    ],
  },
  transactionBuffer: {
    seeds: [
      "smart_account",
      "consensusPda:pubkey",
      "transaction_buffer",
      "creator:pubkey",
      "bufferIndex:u8",
    ],
  },
  policy: {
    seeds: ["smart_account", "policy", "settingsPda:pubkey", "policySeed:u64"],
  },
} as const;
