use solana_sdk::instruction::Instruction;

pub type ProgramConfigInstructionBuilder = fn() -> Instruction;
