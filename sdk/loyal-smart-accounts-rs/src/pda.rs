use solana_sdk::pubkey::Pubkey;

use crate::generated::constants::PROGRAM_ID;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Pda {
    pub address: Pubkey,
    pub bump: u8,
}

fn derive_pda(seeds: &[&[u8]], program_id: Pubkey) -> Pda {
    let (address, bump) = Pubkey::find_program_address(seeds, &program_id);
    Pda { address, bump }
}

pub fn get_program_config_pda(program_id: Option<Pubkey>) -> Pda {
    derive_pda(
        &[b"smart_account", b"program_config"],
        program_id.unwrap_or(PROGRAM_ID),
    )
}

pub fn get_settings_pda(account_index: u128, program_id: Option<Pubkey>) -> Pda {
    let account_index_bytes = account_index.to_le_bytes();
    derive_pda(
        &[b"smart_account", b"settings", &account_index_bytes],
        program_id.unwrap_or(PROGRAM_ID),
    )
}

pub fn get_smart_account_pda(
    settings_pda: Pubkey,
    account_index: u8,
    program_id: Option<Pubkey>,
) -> Pda {
    derive_pda(
        &[
            b"smart_account",
            settings_pda.as_ref(),
            b"smart_account",
            &[account_index],
        ],
        program_id.unwrap_or(PROGRAM_ID),
    )
}

pub fn get_transaction_pda(
    settings_pda: Pubkey,
    transaction_index: u64,
    program_id: Option<Pubkey>,
) -> Pda {
    let transaction_index_bytes = transaction_index.to_le_bytes();
    derive_pda(
        &[
            b"smart_account",
            settings_pda.as_ref(),
            b"transaction",
            &transaction_index_bytes,
        ],
        program_id.unwrap_or(PROGRAM_ID),
    )
}

pub fn get_proposal_pda(
    settings_pda: Pubkey,
    transaction_index: u64,
    program_id: Option<Pubkey>,
) -> Pda {
    let transaction_index_bytes = transaction_index.to_le_bytes();
    derive_pda(
        &[
            b"smart_account",
            settings_pda.as_ref(),
            b"transaction",
            &transaction_index_bytes,
            b"proposal",
        ],
        program_id.unwrap_or(PROGRAM_ID),
    )
}

pub fn get_batch_transaction_pda(
    settings_pda: Pubkey,
    batch_index: u64,
    transaction_index: u32,
    program_id: Option<Pubkey>,
) -> Pda {
    let batch_index_bytes = batch_index.to_le_bytes();
    let transaction_index_bytes = transaction_index.to_le_bytes();
    derive_pda(
        &[
            b"smart_account",
            settings_pda.as_ref(),
            b"transaction",
            &batch_index_bytes,
            b"batch_transaction",
            &transaction_index_bytes,
        ],
        program_id.unwrap_or(PROGRAM_ID),
    )
}

pub fn get_ephemeral_signer_pda(
    transaction_pda: Pubkey,
    ephemeral_signer_index: u8,
    program_id: Option<Pubkey>,
) -> Pda {
    derive_pda(
        &[
            b"smart_account",
            transaction_pda.as_ref(),
            b"ephemeral_signer",
            &[ephemeral_signer_index],
        ],
        program_id.unwrap_or(PROGRAM_ID),
    )
}

pub fn get_spending_limit_pda(
    settings_pda: Pubkey,
    seed: Pubkey,
    program_id: Option<Pubkey>,
) -> Pda {
    derive_pda(
        &[
            b"smart_account",
            settings_pda.as_ref(),
            b"spending_limit",
            seed.as_ref(),
        ],
        program_id.unwrap_or(PROGRAM_ID),
    )
}

pub fn get_transaction_buffer_pda(
    consensus_pda: Pubkey,
    creator: Pubkey,
    buffer_index: u8,
    program_id: Option<Pubkey>,
) -> Pda {
    derive_pda(
        &[
            b"smart_account",
            consensus_pda.as_ref(),
            b"transaction_buffer",
            creator.as_ref(),
            &[buffer_index],
        ],
        program_id.unwrap_or(PROGRAM_ID),
    )
}

pub fn get_policy_pda(settings_pda: Pubkey, policy_seed: u64, program_id: Option<Pubkey>) -> Pda {
    let policy_seed_bytes = policy_seed.to_le_bytes();
    derive_pda(
        &[
            b"smart_account",
            b"policy",
            settings_pda.as_ref(),
            &policy_seed_bytes,
        ],
        program_id.unwrap_or(PROGRAM_ID),
    )
}
