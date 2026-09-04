use solana_sdk::instruction::{AccountMeta, Instruction};
use solana_system_interface::program as system_program;

use crate::errors::LoyalSmartAccountsError;
use crate::generated::constants::PROGRAM_ID;
use crate::generated::instructions::{
    create_create_smart_account_instruction, CreateSmartAccountAccounts,
};
use crate::generated::types::CreateSmartAccountArgs;
use crate::pda::get_program_config_pda;

use super::requests::CreateSmartAccountRequest;

pub(crate) fn resolve_program_id(
    request_program_id: Option<solana_sdk::pubkey::Pubkey>,
    default_program_id: solana_sdk::pubkey::Pubkey,
) -> solana_sdk::pubkey::Pubkey {
    let program_id = request_program_id.unwrap_or(default_program_id);
    if program_id == solana_sdk::pubkey::Pubkey::default() {
        PROGRAM_ID
    } else {
        program_id
    }
}

pub fn create(
    request: &CreateSmartAccountRequest,
    default_program_id: solana_sdk::pubkey::Pubkey,
) -> Result<Instruction, LoyalSmartAccountsError> {
    let program_id = resolve_program_id(request.program_id, default_program_id);

    let mut anchor_remaining_accounts = vec![AccountMeta::new(
        request.settings.unwrap_or_default(),
        false,
    )];
    anchor_remaining_accounts.extend(request.remaining_accounts.iter().cloned());

    create_create_smart_account_instruction(
        CreateSmartAccountAccounts {
            program_config: get_program_config_pda(Some(program_id)).address,
            treasury: request.treasury,
            creator: request.creator,
            system_program: system_program::ID,
            program: program_id,
            anchor_remaining_accounts,
        },
        CreateSmartAccountArgs {
            settings_authority: request.settings_authority,
            threshold: request.threshold,
            signers: request.signers.clone(),
            time_lock: request.time_lock,
            rent_collector: request.rent_collector,
            memo: request.memo.clone(),
        },
        Some(program_id),
    )
    .map_err(|error| LoyalSmartAccountsError::Serialization(error.to_string()))
}
