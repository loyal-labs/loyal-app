use anchor_lang::prelude::*;

use anchor_lang::solana_program::sysvar::instructions::{
    load_current_index_checked, load_instruction_at_checked,
};
use hex_literal::hex;
use solana_hash::HASH_BYTES;
use solana_sha256_hasher::hash as sha256_hash;

declare_id!("9yiphKYd4b69tR1ZPP8rNwtMeUwWgjYXaXdEzyNziNhz");

// ---- Constants ----
const MAX_VALIDATION_LEN: usize = 768;
const MIN_USERNAME_LEN: usize = 5;
const MAX_USERNAME_LEN: usize = 32;
const USERNAME_PATTERN: &str = "\"username\":\"";
const AUTH_DATE_PREFIX: &str = "\nauth_date=";

const ED25519_PROGRAM_ID: Pubkey = pubkey!("Ed25519SigVerify111111111111111111111111111");
const ED25519_HEADER_LEN: usize = 2; // [sig_count: u8, padding: u8]
const ED25519_OFFSETS_LEN: usize = 14; // 7 * u16 (LE)
const SIG_LEN: usize = 64;
const PUBKEY_LEN: usize = 32;
const TELEGRAM_PUBKEY_PROD: [u8; 32] =
    hex!("e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d");

const SESSION_SEED: &[u8] = b"tg_session_v2";

// ---- Program ----
#[program]
pub mod telegram_verification {
    use super::*;

    pub fn store(ctx: Context<StoreTelegramInitData>, validation_bytes: Vec<u8>) -> Result<()> {
        require!(
            validation_bytes.len() <= MAX_VALIDATION_LEN,
            ErrorCode::InvalidValidationBytesLength
        );

        let session = &mut ctx.accounts.session;

        let username = extract_username(&validation_bytes)?;
        require!(
            (MIN_USERNAME_LEN..=MAX_USERNAME_LEN).contains(&username.len()),
            ErrorCode::InvalidTelegramUsername
        );

        let auth_at = extract_auth_date(&validation_bytes)?;
        require!(auth_at > 0, ErrorCode::InvalidTelegramAuthDate);

        session.user_wallet = ctx.accounts.user.key();
        session.username_hash = sha256_hash(username.as_bytes()).to_bytes();
        session.auth_at = auth_at;
        session.validation_bytes = validation_bytes;
        session.verified = false;
        session.verified_at = None;

        Ok(())
    }

    pub fn verify_telegram_init_data(ctx: Context<VerifyTelegramInitData>) -> Result<()> {
        let expected = &ctx.accounts.session.validation_bytes;

        verify_previous_ed25519_ix(&ctx.accounts.instructions, expected)?;
        let session = &mut ctx.accounts.session;
        session.verified = true;
        session.verified_at = Some(Clock::get()?.unix_timestamp as u64);
        Ok(())
    }
}

// ---- Accounts ----
#[derive(Accounts)]
pub struct StoreTelegramInitData<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub user: Signer<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + TelegramSession::INIT_SPACE,
        seeds = [SESSION_SEED, user.key().as_ref()],
        bump
    )]
    pub session: Account<'info, TelegramSession>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct VerifyTelegramInitData<'info> {
    #[account(mut)]
    pub session: Account<'info, TelegramSession>,

    /// CHECK: we only read from instructions sysvar
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: AccountInfo<'info>,
}

// ---- State ----

#[account]
#[derive(InitSpace)]
pub struct TelegramSession {
    pub user_wallet: Pubkey,

    pub username_hash: [u8; HASH_BYTES],

    #[max_len(MAX_VALIDATION_LEN)]
    pub validation_bytes: Vec<u8>,

    pub verified: bool,
    pub auth_at: u64,
    pub verified_at: Option<u64>,
}

// ---- Helpers ----
fn verify_previous_ed25519_ix(instructions_ai: &AccountInfo, expected_msg: &[u8]) -> Result<()> {
    // 1) Load previous ix
    let cur = load_current_index_checked(instructions_ai)
        .map_err(|_| error!(ErrorCode::NotVerified))? as usize;
    require!(cur > 0, ErrorCode::NotVerified);
    let ix = load_instruction_at_checked(cur - 1, instructions_ai)
        .map_err(|_| error!(ErrorCode::NotVerified))?;

    // 2) Ensure Ed25519 program id
    require_keys_eq!(ix.program_id, ED25519_PROGRAM_ID, ErrorCode::InvalidEd25519);

    // 3) basic bounds check
    // Ed25519 ix data = [header(2)] [offsets(14)] [payload...]
    let data = ix.data.as_slice();
    require!(data.len() >= ED25519_HEADER_LEN, ErrorCode::InvalidEd25519);

    // Exactly one signature
    let sig_count = data[0] as usize;
    require!(sig_count == 1, ErrorCode::InvalidEd25519);

    // Read 7 * u16 (LE) offsets for the single signature
    let need = ED25519_OFFSETS_LEN;
    let offs = data
        .get(ED25519_HEADER_LEN..ED25519_HEADER_LEN + need)
        .ok_or_else(|| error!(ErrorCode::InvalidEd25519))?;

    let read_u16 = |i: usize| -> u16 { (offs[i] as u16) | ((offs[i + 1] as u16) << 8) };

    let signature_offset = read_u16(0) as usize;
    let signature_instruction_index = read_u16(2);
    let public_key_offset = read_u16(4) as usize;
    let public_key_instruction_index = read_u16(6);
    let message_data_offset = read_u16(8) as usize;
    let message_data_size = read_u16(10) as usize;
    let message_instruction_index = read_u16(12);

    // All instruction indices must be 0xFFFF (relative to this instruction)
    require!(
        signature_instruction_index == u16::MAX
            && public_key_instruction_index == u16::MAX
            && message_instruction_index == u16::MAX,
        ErrorCode::InvalidEd25519
    );

    // Compute absolute slices and bounds-check
    let sig_abs = signature_offset;
    let pk_abs = public_key_offset;
    let msg_abs = message_data_offset;

    require!(
        sig_abs >= ED25519_HEADER_LEN + ED25519_OFFSETS_LEN,
        ErrorCode::InvalidEd25519
    );
    require!(
        pk_abs >= ED25519_HEADER_LEN + ED25519_OFFSETS_LEN,
        ErrorCode::InvalidEd25519
    );
    require!(
        msg_abs >= ED25519_HEADER_LEN + ED25519_OFFSETS_LEN,
        ErrorCode::InvalidEd25519
    );

    require!(sig_abs + SIG_LEN <= data.len(), ErrorCode::InvalidEd25519);
    require!(pk_abs + PUBKEY_LEN <= data.len(), ErrorCode::InvalidEd25519);
    require!(
        msg_abs + message_data_size <= data.len(),
        ErrorCode::InvalidEd25519
    );

    let pk_bytes = &data[pk_abs..pk_abs + PUBKEY_LEN];
    let msg_bytes = &data[msg_abs..msg_abs + message_data_size];

    // 4) Use hardcoded telegram pk
    let is_telegram_pk = pk_bytes == &TELEGRAM_PUBKEY_PROD;

    // 5) Exact-match telegram pk and message
    require!(is_telegram_pk, ErrorCode::NotVerified);
    require!(msg_bytes == expected_msg, ErrorCode::NotVerified);

    Ok(())
}

/// Extracts username and converts to lowercase
fn extract_username(bytes: &[u8]) -> Result<String> {
    // We expect ASCII only.
    let s = core::str::from_utf8(bytes).map_err(|_| error!(ErrorCode::InvalidTelegramMessage))?;

    // Scope to the `user=` payload to avoid matching other `username` keys.
    let user_start = if let Some(idx) = s.find("\nuser=") {
        idx + "\nuser=".len()
    } else if s.starts_with("user=") {
        "user=".len()
    } else {
        return Err(error!(ErrorCode::InvalidTelegramMessage));
    };

    let user_rest = &s[user_start..];
    let user_end_rel = user_rest.find('\n').unwrap_or(user_rest.len());
    let user_payload = &user_rest[..user_end_rel];

    // Look for `"username":"` within the user payload
    let start = user_payload
        .find(USERNAME_PATTERN)
        .ok_or_else(|| error!(ErrorCode::InvalidTelegramMessage))?
        + USERNAME_PATTERN.len();

    let rest = &user_payload[start..];
    let end_rel = rest
        .find('"')
        .ok_or_else(|| error!(ErrorCode::InvalidTelegramMessage))?;

    let username = &rest[..end_rel];

    require!(
        (MIN_USERNAME_LEN..=MAX_USERNAME_LEN).contains(&username.len()),
        ErrorCode::InvalidTelegramUsername
    );
    require!(
        username.bytes().all(|b| (b'A'..=b'Z').contains(&b)
            || (b'a'..=b'z').contains(&b)
            || (b'0'..=b'9').contains(&b)
            || b == b'_'),
        ErrorCode::InvalidTelegramUsername
    );

    Ok(username.to_lowercase())
}

fn extract_auth_date(bytes: &[u8]) -> Result<u64> {
    let s = core::str::from_utf8(bytes).map_err(|_| error!(ErrorCode::InvalidTelegramMessage))?;

    let start = if let Some(idx) = s.find(AUTH_DATE_PREFIX) {
        idx + AUTH_DATE_PREFIX.len()
    } else if s.starts_with(AUTH_DATE_PREFIX) {
        AUTH_DATE_PREFIX.len()
    } else {
        return Err(error!(ErrorCode::InvalidTelegramMessage));
    };

    let rest = &s[start..];
    let end_rel = rest.find('\n').unwrap_or(rest.len());
    let num_str = &rest[..end_rel];

    require!(
        num_str.chars().all(|c| c.is_ascii_digit()),
        ErrorCode::InvalidTelegramMessage
    );

    let ts: u64 = num_str
        .parse()
        .map_err(|_| error!(ErrorCode::InvalidTelegramMessage))?;

    require!(ts > 0, ErrorCode::InvalidTelegramMessage);

    Ok(ts as u64)
}

// ---- Error Codes ----
#[error_code]
pub enum ErrorCode {
    #[msg("Invalid validation string length")]
    InvalidValidationBytesLength,
    #[msg("Not Verified")]
    NotVerified,
    #[msg("Invalid Ed25519")]
    InvalidEd25519,
    #[msg("Invalid Telegram PK")]
    InvalidTelegramPK,
    #[msg("Invalid Telegram message")]
    InvalidTelegramMessage,
    #[msg("Invalid Telegram signature")]
    InvalidTelegramSignature,
    #[msg("Invalid Telegram public key")]
    InvalidTelegramPublicKey,
    #[msg("Invalid Telegram username")]
    InvalidTelegramUsername,
    #[msg("Invalid Telegram auth date")]
    InvalidTelegramAuthDate,
}
