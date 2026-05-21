#![allow(unexpected_cfgs)]

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    sysvar::Sysvar,
};
use solana_system_interface::instruction as system_instruction;
use spl_token::solana_program::program_pack::Pack;

pub const CONFIG_SEED: &[u8] = b"config";
pub const HUB_AUTHORITY_SEED: &[u8] = b"hub-authority";
pub const CONFIG_MAGIC: &[u8; 8] = b"LHUBCFG1";
pub const MAX_ALLOWED_MINTS: usize = 8;
pub const HUB_CONFIG_SPACE: usize = 8 + 32 + 32 + 2 + 1 + 1 + (MAX_ALLOWED_MINTS * 32);

pub const INITIALIZE_CONFIG: u8 = 0;
pub const SWAP_EXACT_IN: u8 = 1;
pub const WITHDRAW_INVENTORY: u8 = 2;
pub const SET_PAUSED: u8 = 3;
pub const SET_CONFIG: u8 = 4;

entrypoint!(process_instruction);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HubConfig {
    pub admin: Pubkey,
    pub hub_authorizer: Pubkey,
    pub max_fee_bps: u16,
    pub paused: bool,
    pub allowed_mints: Vec<Pubkey>,
}

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let (&tag, rest) = data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;
    match tag {
        INITIALIZE_CONFIG => process_initialize_config(program_id, accounts, rest),
        SWAP_EXACT_IN => process_swap_exact_in(program_id, accounts, rest),
        WITHDRAW_INVENTORY => process_withdraw_inventory(program_id, accounts, rest),
        SET_PAUSED => process_set_paused(program_id, accounts, rest),
        SET_CONFIG => process_set_config(program_id, accounts, rest),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

fn process_initialize_config(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let config = parse_config_payload(data)?;
    validate_fee_bps(config.max_fee_bps)?;

    let account_info_iter = &mut accounts.iter();
    let payer = next_account_info(account_info_iter)?;
    let config_account = next_account_info(account_info_iter)?;
    let system_program = next_account_info(account_info_iter)?;

    require_signer(payer)?;
    require_key(system_program, &solana_program::system_program::ID)?;
    require_key(config_account, &derive_config(program_id).0)?;
    if config_account.owner != &solana_program::system_program::ID
        || !config_account.data_is_empty()
    {
        return Err(ProgramError::AccountAlreadyInitialized);
    }

    let lamports = Rent::get()?.minimum_balance(HUB_CONFIG_SPACE);
    let (_, bump) = derive_config(program_id);
    invoke_signed(
        &system_instruction::create_account(
            payer.key,
            config_account.key,
            lamports,
            HUB_CONFIG_SPACE as u64,
            program_id,
        ),
        &[
            payer.clone(),
            config_account.clone(),
            system_program.clone(),
        ],
        &[&[CONFIG_SEED, &[bump]]],
    )?;

    write_config(config_account, &config)
}

fn process_set_config(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let config = parse_config_payload(data)?;
    validate_fee_bps(config.max_fee_bps)?;

    let account_info_iter = &mut accounts.iter();
    let config_account = next_account_info(account_info_iter)?;
    let admin = next_account_info(account_info_iter)?;

    let existing = read_config_account(program_id, config_account)?;
    require_admin(admin, &existing)?;
    write_config(config_account, &config)
}

fn process_set_paused(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() != 1 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let account_info_iter = &mut accounts.iter();
    let config_account = next_account_info(account_info_iter)?;
    let admin = next_account_info(account_info_iter)?;

    let mut config = read_config_account(program_id, config_account)?;
    require_admin(admin, &config)?;
    config.paused = data[0] != 0;
    write_config(config_account, &config)
}

fn process_swap_exact_in(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let SwapExactInArgs {
        amount_in,
        amount_out,
        min_out,
        max_fee_bps,
    } = parse_swap_exact_in_args(data)?;
    if amount_in == 0 || amount_out == 0 {
        return Err(ProgramError::InvalidArgument);
    }
    if amount_out < min_out {
        return Err(ProgramError::InvalidArgument);
    }

    let account_info_iter = &mut accounts.iter();
    let config_account = next_account_info(account_info_iter)?;
    let user_vault = next_account_info(account_info_iter)?;
    let user_input = next_account_info(account_info_iter)?;
    let user_output = next_account_info(account_info_iter)?;
    let hub_input = next_account_info(account_info_iter)?;
    let hub_output = next_account_info(account_info_iter)?;
    let input_mint = next_account_info(account_info_iter)?;
    let output_mint = next_account_info(account_info_iter)?;
    let hub_authority = next_account_info(account_info_iter)?;
    let hub_authorizer = next_account_info(account_info_iter)?;
    let token_program = next_account_info(account_info_iter)?;

    let config = read_config_account(program_id, config_account)?;
    if config.paused || max_fee_bps > config.max_fee_bps {
        return Err(ProgramError::InvalidArgument);
    }
    require_signer(user_vault)?;
    require_signer(hub_authorizer)?;
    require_key(hub_authorizer, &config.hub_authorizer)?;
    require_key(token_program, &spl_token::id())?;
    require_key(hub_authority, &derive_hub_authority(program_id).0)?;
    require_allowed_mint(&config, input_mint.key)?;
    require_allowed_mint(&config, output_mint.key)?;

    let input_decimals = read_mint_decimals(input_mint)?;
    let output_decimals = read_mint_decimals(output_mint)?;
    require_fee_cap(
        amount_in,
        amount_out,
        input_decimals,
        output_decimals,
        max_fee_bps,
    )?;
    require_token_account(user_input, input_mint.key, user_vault.key)?;
    require_token_account(user_output, output_mint.key, user_vault.key)?;
    require_token_account(hub_input, input_mint.key, hub_authority.key)?;
    require_token_account(hub_output, output_mint.key, hub_authority.key)?;

    transfer_checked(
        user_input,
        input_mint,
        hub_input,
        user_vault,
        token_program,
        amount_in,
        input_decimals,
    )?;
    transfer_checked_signed(
        program_id,
        hub_output,
        output_mint,
        user_output,
        hub_authority,
        token_program,
        amount_out,
        output_decimals,
    )
}

fn process_withdraw_inventory(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if data.len() != 8 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let amount = read_u64(data)?;
    if amount == 0 {
        return Err(ProgramError::InvalidArgument);
    }

    let account_info_iter = &mut accounts.iter();
    let config_account = next_account_info(account_info_iter)?;
    let admin = next_account_info(account_info_iter)?;
    let hub_source = next_account_info(account_info_iter)?;
    let destination = next_account_info(account_info_iter)?;
    let mint = next_account_info(account_info_iter)?;
    let hub_authority = next_account_info(account_info_iter)?;
    let token_program = next_account_info(account_info_iter)?;

    let config = read_config_account(program_id, config_account)?;
    require_admin(admin, &config)?;
    require_key(token_program, &spl_token::id())?;
    require_key(hub_authority, &derive_hub_authority(program_id).0)?;
    require_allowed_mint(&config, mint.key)?;
    require_token_account(hub_source, mint.key, hub_authority.key)?;
    require_matching_token_mint(destination, mint.key)?;

    let decimals = read_mint_decimals(mint)?;
    transfer_checked_signed(
        program_id,
        hub_source,
        mint,
        destination,
        hub_authority,
        token_program,
        amount,
        decimals,
    )
}

fn parse_config_payload(data: &[u8]) -> Result<HubConfig, ProgramError> {
    if data.len() < 68 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let admin = Pubkey::new_from_array(read_pubkey(&data[0..32])?);
    let hub_authorizer = Pubkey::new_from_array(read_pubkey(&data[32..64])?);
    let max_fee_bps = read_u16(&data[64..66])?;
    let paused = data[66] != 0;
    let mint_count = *data.get(67).ok_or(ProgramError::InvalidInstructionData)? as usize;
    if mint_count == 0 || mint_count > MAX_ALLOWED_MINTS {
        return Err(ProgramError::InvalidInstructionData);
    }

    let expected_len = 68 + (mint_count * 32);
    if data.len() != expected_len {
        return Err(ProgramError::InvalidInstructionData);
    }

    let mut allowed_mints = Vec::with_capacity(mint_count);
    for index in 0..mint_count {
        let offset = 68 + (index * 32);
        let mint = Pubkey::new_from_array(read_pubkey(&data[offset..offset + 32])?);
        if allowed_mints.contains(&mint) {
            return Err(ProgramError::InvalidInstructionData);
        }
        allowed_mints.push(mint);
    }

    Ok(HubConfig {
        admin,
        hub_authorizer,
        max_fee_bps,
        paused,
        allowed_mints,
    })
}

struct SwapExactInArgs {
    amount_in: u64,
    amount_out: u64,
    min_out: u64,
    max_fee_bps: u16,
}

fn parse_swap_exact_in_args(data: &[u8]) -> Result<SwapExactInArgs, ProgramError> {
    if data.len() != 26 {
        return Err(ProgramError::InvalidInstructionData);
    }
    Ok(SwapExactInArgs {
        amount_in: read_u64(&data[0..8])?,
        amount_out: read_u64(&data[8..16])?,
        min_out: read_u64(&data[16..24])?,
        max_fee_bps: read_u16(&data[24..26])?,
    })
}

fn read_config_account(
    program_id: &Pubkey,
    config_account: &AccountInfo,
) -> Result<HubConfig, ProgramError> {
    require_key(config_account, &derive_config(program_id).0)?;
    if config_account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    let data = config_account.data.borrow();
    if data.len() != HUB_CONFIG_SPACE || &data[..8] != CONFIG_MAGIC {
        return Err(ProgramError::InvalidAccountData);
    }
    let admin = Pubkey::new_from_array(read_pubkey(&data[8..40])?);
    let hub_authorizer = Pubkey::new_from_array(read_pubkey(&data[40..72])?);
    let max_fee_bps = read_u16(&data[72..74])?;
    let paused = data[74] != 0;
    let mint_count = data[75] as usize;
    if mint_count == 0 || mint_count > MAX_ALLOWED_MINTS {
        return Err(ProgramError::InvalidAccountData);
    }

    let mut allowed_mints = Vec::with_capacity(mint_count);
    for index in 0..mint_count {
        let offset = 76 + (index * 32);
        allowed_mints.push(Pubkey::new_from_array(read_pubkey(
            &data[offset..offset + 32],
        )?));
    }

    Ok(HubConfig {
        admin,
        hub_authorizer,
        max_fee_bps,
        paused,
        allowed_mints,
    })
}

fn write_config(config_account: &AccountInfo, config: &HubConfig) -> ProgramResult {
    let mut data = config_account.data.borrow_mut();
    if data.len() != HUB_CONFIG_SPACE {
        return Err(ProgramError::InvalidAccountData);
    }
    data.fill(0);
    data[..8].copy_from_slice(CONFIG_MAGIC);
    data[8..40].copy_from_slice(config.admin.as_ref());
    data[40..72].copy_from_slice(config.hub_authorizer.as_ref());
    data[72..74].copy_from_slice(&config.max_fee_bps.to_le_bytes());
    data[74] = u8::from(config.paused);
    data[75] = config
        .allowed_mints
        .len()
        .try_into()
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    for (index, mint) in config.allowed_mints.iter().enumerate() {
        let offset = 76 + (index * 32);
        data[offset..offset + 32].copy_from_slice(mint.as_ref());
    }
    Ok(())
}

fn require_admin(admin: &AccountInfo, config: &HubConfig) -> ProgramResult {
    require_signer(admin)?;
    require_key(admin, &config.admin)
}

fn require_fee_cap(
    amount_in: u64,
    amount_out: u64,
    input_decimals: u8,
    output_decimals: u8,
    max_fee_bps: u16,
) -> ProgramResult {
    validate_fee_bps(max_fee_bps)?;
    let input_normalized = normalize_amount(amount_in, input_decimals)?;
    let output_normalized = normalize_amount(amount_out, output_decimals)?;
    let min_output = input_normalized
        .checked_mul(10_000u128 - max_fee_bps as u128)
        .ok_or(ProgramError::InvalidArgument)?
        / 10_000u128;
    if output_normalized < min_output {
        return Err(ProgramError::InvalidArgument);
    }
    Ok(())
}

fn normalize_amount(amount: u64, decimals: u8) -> Result<u128, ProgramError> {
    if decimals > 18 {
        return Err(ProgramError::InvalidArgument);
    }
    let scale = 10u128
        .checked_pow((18u8 - decimals) as u32)
        .ok_or(ProgramError::InvalidArgument)?;
    (amount as u128)
        .checked_mul(scale)
        .ok_or(ProgramError::InvalidArgument)
}

fn validate_fee_bps(fee_bps: u16) -> ProgramResult {
    if fee_bps > 10_000 {
        return Err(ProgramError::InvalidArgument);
    }
    Ok(())
}

fn require_allowed_mint(config: &HubConfig, mint: &Pubkey) -> ProgramResult {
    if !config.allowed_mints.contains(mint) {
        return Err(ProgramError::InvalidArgument);
    }
    Ok(())
}

fn require_token_account(account: &AccountInfo, mint: &Pubkey, owner: &Pubkey) -> ProgramResult {
    let token = spl_token::state::Account::unpack(&account.data.borrow())?;
    if account.owner != &spl_token::id() || token.mint != *mint || token.owner != *owner {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(())
}

fn require_matching_token_mint(account: &AccountInfo, mint: &Pubkey) -> ProgramResult {
    let token = spl_token::state::Account::unpack(&account.data.borrow())?;
    if account.owner != &spl_token::id() || token.mint != *mint {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(())
}

fn read_mint_decimals(mint: &AccountInfo) -> Result<u8, ProgramError> {
    if mint.owner != &spl_token::id() {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(spl_token::state::Mint::unpack(&mint.data.borrow())?.decimals)
}

fn transfer_checked<'info>(
    source: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    destination: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    amount: u64,
    decimals: u8,
) -> ProgramResult {
    let ix = spl_token::instruction::transfer_checked(
        token_program.key,
        source.key,
        mint.key,
        destination.key,
        authority.key,
        &[],
        amount,
        decimals,
    )?;
    invoke(
        &ix,
        &[
            source.clone(),
            mint.clone(),
            destination.clone(),
            authority.clone(),
            token_program.clone(),
        ],
    )
}

fn transfer_checked_signed<'info>(
    program_id: &Pubkey,
    source: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    destination: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    amount: u64,
    decimals: u8,
) -> ProgramResult {
    let ix = spl_token::instruction::transfer_checked(
        token_program.key,
        source.key,
        mint.key,
        destination.key,
        authority.key,
        &[],
        amount,
        decimals,
    )?;
    let account_infos = [
        source.clone(),
        mint.clone(),
        destination.clone(),
        authority.clone(),
        token_program.clone(),
    ];
    let (_, bump) = derive_hub_authority(program_id);
    invoke_signed(&ix, &account_infos, &[&[HUB_AUTHORITY_SEED, &[bump]]])
}

pub fn derive_config(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[CONFIG_SEED], program_id)
}

pub fn derive_hub_authority(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[HUB_AUTHORITY_SEED], program_id)
}

fn require_signer(account: &AccountInfo) -> ProgramResult {
    if !account.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    Ok(())
}

fn require_key(account: &AccountInfo, expected: &Pubkey) -> ProgramResult {
    if account.key != expected {
        return Err(ProgramError::InvalidArgument);
    }
    Ok(())
}

fn read_u16(data: &[u8]) -> Result<u16, ProgramError> {
    Ok(u16::from_le_bytes(
        data.try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    ))
}

fn read_u64(data: &[u8]) -> Result<u64, ProgramError> {
    Ok(u64::from_le_bytes(
        data.try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    ))
}

fn read_pubkey(data: &[u8]) -> Result<[u8; 32], ProgramError> {
    data.try_into()
        .map_err(|_| ProgramError::InvalidInstructionData)
}
