use anyhow::{bail, Result};
use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
};
use solana_sha256_hasher::hash as sha256_hash;
use spl_associated_token_account_client::{
    address::get_associated_token_address_with_program_id, program as associated_token_program,
};

use crate::constants::{
    DELEGATION_PROGRAM_ID_STR, IX_CREATE_PERMISSION, IX_DELEGATE, IX_DELEGATE_USERNAME_DEPOSIT,
    IX_INITIALIZE_DEPOSIT, IX_INITIALIZE_USERNAME_DEPOSIT, IX_MODIFY_BALANCE,
    IX_TRANSFER_TO_USERNAME_DEPOSIT, IX_UNDELEGATE, IX_UNDELEGATE_USERNAME_DEPOSIT,
    MAGIC_CONTEXT_ID_STR, MAGIC_PROGRAM_ID_STR, PERMISSION_PROGRAM_ID_STR, PROGRAM_ID_STR,
};

pub(crate) fn build_initialize_deposit_ix(
    payer: Pubkey,
    user: Pubkey,
    mint: Pubkey,
    deposit: Pubkey,
) -> Instruction {
    let data = IX_INITIALIZE_DEPOSIT.to_vec();

    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(user, false),
            AccountMeta::new(deposit, false),
            AccountMeta::new_readonly(mint, false),
            AccountMeta::new_readonly(spl_token::id(), false),
            AccountMeta::new_readonly(system_program_id(), false),
        ],
        data,
    }
}

pub(crate) fn build_initialize_username_deposit_ix(
    payer: Pubkey,
    mint: Pubkey,
    username: &str,
    deposit: Pubkey,
) -> Instruction {
    let mut data = IX_INITIALIZE_USERNAME_DEPOSIT.to_vec();
    data.extend_from_slice(&username_hash_bytes(username));

    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(deposit, false),
            AccountMeta::new_readonly(mint, false),
            AccountMeta::new_readonly(spl_token::id(), false),
            AccountMeta::new_readonly(system_program_id(), false),
        ],
        data,
    }
}

pub(crate) fn build_modify_balance_ix(
    payer: Pubkey,
    user: Pubkey,
    mint: Pubkey,
    deposit: Pubkey,
    user_token_account: Pubkey,
    amount: u64,
    increase: bool,
) -> Instruction {
    let vault = find_vault_pda(&mint);
    let vault_token_account =
        get_associated_token_address_with_program_id(&vault, &mint, &spl_token::id());

    let mut data = IX_MODIFY_BALANCE.to_vec();
    data.extend_from_slice(&amount.to_le_bytes());
    data.push(if increase { 1 } else { 0 });

    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(user, true),
            AccountMeta::new(vault, false),
            AccountMeta::new(deposit, false),
            AccountMeta::new(user_token_account, false),
            AccountMeta::new(vault_token_account, false),
            AccountMeta::new_readonly(mint, false),
            AccountMeta::new_readonly(spl_token::id(), false),
            AccountMeta::new_readonly(associated_token_program::id(), false),
            AccountMeta::new_readonly(system_program_id(), false),
        ],
        data,
    }
}

pub(crate) fn build_create_permission_ix(
    payer: Pubkey,
    user: Pubkey,
    deposit: Pubkey,
    permission: Pubkey,
) -> Instruction {
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(user, true),
            AccountMeta::new_readonly(deposit, false),
            AccountMeta::new(permission, false),
            AccountMeta::new_readonly(permission_program_id(), false),
            AccountMeta::new_readonly(system_program_id(), false),
        ],
        data: IX_CREATE_PERMISSION.to_vec(),
    }
}

pub(crate) fn build_delegate_deposit_ix(
    payer: Pubkey,
    user: Pubkey,
    mint: Pubkey,
    deposit: Pubkey,
    validator: Pubkey,
) -> Instruction {
    let buffer = find_buffer_pda(&deposit);
    let delegation_record = find_delegation_record_pda(&deposit);
    let delegation_metadata = find_delegation_metadata_pda(&deposit);

    let mut data = IX_DELEGATE.to_vec();
    data.extend_from_slice(user.as_ref());
    data.extend_from_slice(mint.as_ref());

    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(validator, false),
            AccountMeta::new(buffer, false),
            AccountMeta::new(delegation_record, false),
            AccountMeta::new(delegation_metadata, false),
            AccountMeta::new(deposit, false),
            AccountMeta::new_readonly(program_id(), false),
            AccountMeta::new_readonly(delegation_program_id(), false),
            AccountMeta::new_readonly(system_program_id(), false),
        ],
        data,
    }
}

pub(crate) fn build_delegate_username_deposit_ix(
    payer: Pubkey,
    username: &str,
    mint: Pubkey,
    deposit: Pubkey,
    validator: Pubkey,
) -> Instruction {
    let buffer = find_buffer_pda(&deposit);
    let delegation_record = find_delegation_record_pda(&deposit);
    let delegation_metadata = find_delegation_metadata_pda(&deposit);

    let mut data = IX_DELEGATE_USERNAME_DEPOSIT.to_vec();
    data.extend_from_slice(&username_hash_bytes(username));
    data.extend_from_slice(mint.as_ref());

    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(validator, false),
            AccountMeta::new(buffer, false),
            AccountMeta::new(delegation_record, false),
            AccountMeta::new(delegation_metadata, false),
            AccountMeta::new(deposit, false),
            AccountMeta::new_readonly(program_id(), false),
            AccountMeta::new_readonly(delegation_program_id(), false),
            AccountMeta::new_readonly(system_program_id(), false),
        ],
        data,
    }
}

pub(crate) fn build_undelegate_deposit_ix(
    payer: Pubkey,
    user: Pubkey,
    deposit: Pubkey,
) -> Instruction {
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new_readonly(user, false),
            AccountMeta::new(payer, true),
            // Anchor optional account sentinel for `session_token: None`.
            AccountMeta::new_readonly(program_id(), false),
            AccountMeta::new(deposit, false),
            AccountMeta::new_readonly(magic_program_id(), false),
            AccountMeta::new(magic_context_id(), false),
        ],
        data: IX_UNDELEGATE.to_vec(),
    }
}

pub(crate) fn build_undelegate_username_deposit_ix(
    payer: Pubkey,
    session: Pubkey,
    username: &str,
    mint: Pubkey,
    deposit: Pubkey,
) -> Instruction {
    let mut data = IX_UNDELEGATE_USERNAME_DEPOSIT.to_vec();
    data.extend_from_slice(&username_hash_bytes(username));
    data.extend_from_slice(mint.as_ref());

    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(session, false),
            AccountMeta::new(deposit, false),
            AccountMeta::new_readonly(magic_program_id(), false),
            AccountMeta::new(magic_context_id(), false),
        ],
        data,
    }
}

pub(crate) fn build_transfer_to_username_deposit_ix(
    user: Pubkey,
    payer: Pubkey,
    mint: Pubkey,
    source_deposit: Pubkey,
    destination_deposit: Pubkey,
    amount: u64,
) -> Instruction {
    let mut data = IX_TRANSFER_TO_USERNAME_DEPOSIT.to_vec();
    data.extend_from_slice(&amount.to_le_bytes());

    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new_readonly(user, false),
            AccountMeta::new(payer, true),
            // Anchor optional account sentinel for `session_token: None`.
            AccountMeta::new_readonly(program_id(), false),
            AccountMeta::new(source_deposit, false),
            AccountMeta::new(destination_deposit, false),
            AccountMeta::new_readonly(mint, false),
            AccountMeta::new_readonly(system_program_id(), false),
        ],
        data,
    }
}

pub(crate) fn username_hash_bytes(username: &str) -> [u8; 32] {
    sha256_hash(username.as_bytes()).to_bytes()
}

pub(crate) fn validate_username(username: &str) -> Result<()> {
    if !(5..=32).contains(&username.len()) {
        bail!("username must be between 5 and 32 characters");
    }
    if !username
        .as_bytes()
        .iter()
        .all(|b| b.is_ascii_alphanumeric() || *b == b'_')
    {
        bail!("username can only contain [a-zA-Z0-9_]");
    }
    Ok(())
}

pub(crate) fn find_deposit_pda(user: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[b"deposit_v2", user.as_ref(), mint.as_ref()],
        &program_id(),
    )
    .0
}

pub(crate) fn find_username_deposit_pda(username: &str, mint: &Pubkey) -> Pubkey {
    let username_hash = username_hash_bytes(username);
    Pubkey::find_program_address(
        &[b"username_deposit_v2", &username_hash, mint.as_ref()],
        &program_id(),
    )
    .0
}

pub(crate) fn find_vault_pda(mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"vault", mint.as_ref()], &program_id()).0
}

pub(crate) fn find_permission_pda(account: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[b"permission:", account.as_ref()],
        &permission_program_id(),
    )
    .0
}

pub(crate) fn find_delegation_record_pda(account: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"delegation", account.as_ref()], &delegation_program_id()).0
}

pub(crate) fn find_delegation_metadata_pda(account: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[b"delegation-metadata", account.as_ref()],
        &delegation_program_id(),
    )
    .0
}

pub(crate) fn find_buffer_pda(account: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"buffer", account.as_ref()], &program_id()).0
}

pub(crate) fn program_id() -> Pubkey {
    Pubkey::from_str(PROGRAM_ID_STR).expect("valid program id")
}

pub(crate) fn delegation_program_id() -> Pubkey {
    Pubkey::from_str(DELEGATION_PROGRAM_ID_STR).expect("valid delegation program id")
}

pub(crate) fn permission_program_id() -> Pubkey {
    Pubkey::from_str(PERMISSION_PROGRAM_ID_STR).expect("valid permission program id")
}

pub(crate) fn magic_program_id() -> Pubkey {
    Pubkey::from_str(MAGIC_PROGRAM_ID_STR).expect("valid magic program id")
}

pub(crate) fn magic_context_id() -> Pubkey {
    Pubkey::from_str(MAGIC_CONTEXT_ID_STR).expect("valid magic context id")
}

pub(crate) fn system_program_id() -> Pubkey {
    solana_system_interface::program::id()
}

use std::str::FromStr;
