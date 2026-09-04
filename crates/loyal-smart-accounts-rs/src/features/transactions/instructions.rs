use solana_sdk::instruction::Instruction;

pub type TransactionInstructionBuilder = fn() -> Instruction;
