use loyal_smart_accounts_rs_core::transport::PreparedOperation;
use loyal_smart_accounts_rs_core::OperationName;
use solana_sdk::instruction::Instruction;
use solana_sdk::message::AddressLookupTableAccount;
use solana_sdk::pubkey::Pubkey;

pub fn prepared_operation(
    operation: OperationName,
    payer: Pubkey,
    program_id: Pubkey,
    requires_confirmation: bool,
    instruction: Instruction,
    address_lookup_table_accounts: Vec<AddressLookupTableAccount>,
) -> PreparedOperation {
    PreparedOperation {
        operation,
        payer,
        program_id,
        requires_confirmation,
        instructions: vec![instruction],
        address_lookup_table_accounts,
    }
}
