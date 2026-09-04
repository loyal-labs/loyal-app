use solana_sdk::instruction::Instruction;

pub type SpendingLimitInstructionBuilder = fn() -> Instruction;
