use anyhow::{bail, Context, Result};
use log::debug;
use serde_json::json;
use solana_client::rpc_client::RpcClient;
use solana_commitment_config::CommitmentConfig;
use solana_rpc_client_api::config::RpcSimulateTransactionConfig;
use solana_sdk::{
    instruction::Instruction,
    pubkey::Pubkey,
    signature::{Keypair, Signature},
    signer::Signer,
    transaction::Transaction,
};
use solana_system_interface::instruction as system_instruction;
use spl_associated_token_account_client::{
    address::get_associated_token_address_with_program_id,
    instruction::create_associated_token_account_idempotent,
};
use spl_token::{instruction as token_instruction, native_mint::id as native_mint_id};
use std::{
    thread::sleep,
    time::{Duration, Instant},
};

use crate::{
    cli::OutputFormat,
    constants::{
        DEPOSIT_DISCRIMINATOR, IX_CREATE_PERMISSION, IX_DELEGATE, IX_DELEGATE_USERNAME_DEPOSIT,
        IX_INITIALIZE_DEPOSIT, IX_INITIALIZE_USERNAME_DEPOSIT, IX_MODIFY_BALANCE,
        IX_TRANSFER_TO_USERNAME_DEPOSIT, IX_UNDELEGATE, IX_UNDELEGATE_USERNAME_DEPOSIT,
        USERNAME_DEPOSIT_DISCRIMINATOR,
    },
    pda::{
        delegation_program_id, find_delegation_metadata_pda, find_delegation_record_pda, program_id,
    },
    types::{DepositAccountData, UsernameDepositAccountData},
};

pub(crate) fn wait_for_owner(
    client: &RpcClient,
    account: &Pubkey,
    expected_owner: &Pubkey,
    timeout: Duration,
    interval: Duration,
    commitment: CommitmentConfig,
) -> Result<()> {
    let start = Instant::now();
    debug!(
        "waiting for owner: account={}, expected_owner={}, timeout_secs={}, interval_secs={}",
        account,
        expected_owner,
        timeout.as_secs(),
        interval.as_secs()
    );
    while start.elapsed() < timeout {
        if let Some(info) = get_account_opt(client, account, commitment)? {
            debug!(
                "owner poll: account={}, current_owner={}, expected_owner={}",
                account, info.owner, expected_owner
            );
            if info.owner == *expected_owner {
                return Ok(());
            }
        }
        sleep(interval);
    }
    bail!(
        "timeout waiting for owner {} on account {}",
        expected_owner,
        account
    )
}

pub(crate) fn wait_for_account_exists(
    client: &RpcClient,
    account: &Pubkey,
    timeout: Duration,
    interval: Duration,
    commitment: CommitmentConfig,
) -> Result<()> {
    let start = Instant::now();
    debug!(
        "waiting for account existence: account={}, timeout_ms={}, interval_ms={}",
        account,
        timeout.as_millis(),
        interval.as_millis()
    );

    while start.elapsed() < timeout {
        if get_account_opt(client, account, commitment)?.is_some() {
            debug!("account is now visible: account={}", account);
            return Ok(());
        }
        sleep(interval);
    }

    bail!("timeout waiting for account {} to exist", account)
}

pub(crate) fn account_owner_is(
    client: &RpcClient,
    account: &Pubkey,
    expected_owner: &Pubkey,
    commitment: CommitmentConfig,
) -> Result<bool> {
    Ok(get_account_opt(client, account, commitment)?
        .map(|a| a.owner == *expected_owner)
        .unwrap_or(false))
}

pub(crate) fn get_account_opt(
    client: &RpcClient,
    address: &Pubkey,
    commitment: CommitmentConfig,
) -> Result<Option<solana_sdk::account::Account>> {
    debug!("rpc get_account_with_commitment: account={address}, commitment={commitment:?}");
    let response = client
        .get_account_with_commitment(address, commitment)
        .with_context(|| format!("failed to fetch account {address}"))?;
    debug!(
        "rpc get_account_with_commitment response: account={}, exists={}",
        address,
        response.value.is_some()
    );
    Ok(response.value)
}

pub(crate) fn get_account_opt_allow_not_found(
    client: &RpcClient,
    address: &Pubkey,
    commitment: CommitmentConfig,
) -> Result<Option<solana_sdk::account::Account>> {
    match get_account_opt(client, address, commitment) {
        Ok(account) => Ok(account),
        Err(err) if is_account_not_found_error(&err) => Ok(None),
        Err(err) => Err(err),
    }
}

pub(crate) fn fetch_deposit_amount(
    client: &RpcClient,
    address: &Pubkey,
    commitment: CommitmentConfig,
) -> Result<Option<u64>> {
    debug!("fetch_deposit_amount: account={address}");
    let Some(account) = get_account_opt(client, address, commitment)? else {
        return Ok(None);
    };
    if !is_deposit_state_owner(&account.owner) {
        debug!(
            "fetch_deposit_amount skip: account={}, unexpected_owner={}",
            address, account.owner
        );
        return Ok(None);
    }
    let parsed = decode_deposit_account(&account.data)?;
    debug!(
        "fetch_deposit_amount result: account={}, amount={}",
        address, parsed.amount
    );
    Ok(Some(parsed.amount))
}

pub(crate) fn fetch_deposit_amount_allow_not_found(
    client: &RpcClient,
    address: &Pubkey,
    commitment: CommitmentConfig,
) -> Result<Option<u64>> {
    debug!("fetch_deposit_amount_allow_not_found: account={address}");
    let Some(account) = get_account_opt_allow_not_found(client, address, commitment)? else {
        return Ok(None);
    };
    if !is_deposit_state_owner(&account.owner) {
        debug!(
            "fetch_deposit_amount_allow_not_found skip: account={}, unexpected_owner={}",
            address, account.owner
        );
        return Ok(None);
    }
    let parsed = decode_deposit_account(&account.data)?;
    debug!(
        "fetch_deposit_amount_allow_not_found result: account={}, amount={}",
        address, parsed.amount
    );
    Ok(Some(parsed.amount))
}

pub(crate) fn fetch_username_deposit_amount(
    client: &RpcClient,
    address: &Pubkey,
    commitment: CommitmentConfig,
) -> Result<Option<u64>> {
    debug!("fetch_username_deposit_amount: account={address}");
    let Some(account) = get_account_opt(client, address, commitment)? else {
        return Ok(None);
    };
    if !is_deposit_state_owner(&account.owner) {
        debug!(
            "fetch_username_deposit_amount skip: account={}, unexpected_owner={}",
            address, account.owner
        );
        return Ok(None);
    }
    let parsed = decode_username_deposit_account(&account.data)?;
    debug!(
        "fetch_username_deposit_amount result: account={}, amount={}",
        address, parsed.amount
    );
    Ok(Some(parsed.amount))
}

fn is_deposit_state_owner(owner: &Pubkey) -> bool {
    *owner == program_id() || *owner == delegation_program_id()
}

fn decode_deposit_account(data: &[u8]) -> Result<DepositAccountData> {
    if data.len() < 8 + 32 + 32 + 8 {
        bail!("deposit account data too short");
    }
    if data[..8] != DEPOSIT_DISCRIMINATOR {
        bail!("invalid deposit discriminator");
    }
    let amount_offset = 8 + 32 + 32;
    let amount = u64::from_le_bytes(
        data[amount_offset..amount_offset + 8]
            .try_into()
            .context("invalid deposit amount bytes")?,
    );
    Ok(DepositAccountData { amount })
}

fn decode_username_deposit_account(data: &[u8]) -> Result<UsernameDepositAccountData> {
    if data.len() < 8 + 4 + 32 + 8 {
        bail!("username deposit account data too short");
    }
    if data[..8] != USERNAME_DEPOSIT_DISCRIMINATOR {
        bail!("invalid username deposit discriminator");
    }

    let username_len =
        u32::from_le_bytes(data[8..12].try_into().context("invalid username length")?) as usize;
    let amount_offset = 12 + username_len + 32;
    if data.len() < amount_offset + 8 {
        bail!("username deposit account malformed");
    }

    let amount = u64::from_le_bytes(
        data[amount_offset..amount_offset + 8]
            .try_into()
            .context("invalid username deposit amount bytes")?,
    );

    Ok(UsernameDepositAccountData { amount })
}

pub(crate) fn fetch_username_deposit_amount_allow_not_found(
    client: &RpcClient,
    address: &Pubkey,
    commitment: CommitmentConfig,
) -> Result<Option<u64>> {
    debug!("fetch_username_deposit_amount_allow_not_found: account={address}");
    let Some(account) = get_account_opt_allow_not_found(client, address, commitment)? else {
        return Ok(None);
    };
    if !is_deposit_state_owner(&account.owner) {
        debug!(
            "fetch_username_deposit_amount_allow_not_found skip: account={}, unexpected_owner={}",
            address, account.owner
        );
        return Ok(None);
    }
    let parsed = decode_username_deposit_account(&account.data)?;
    debug!(
        "fetch_username_deposit_amount_allow_not_found result: account={}, amount={}",
        address, parsed.amount
    );
    Ok(Some(parsed.amount))
}

fn is_account_not_found_error(err: &anyhow::Error) -> bool {
    err.chain()
        .any(|cause| is_account_not_found_message(&cause.to_string()))
}

fn is_account_not_found_message(message: &str) -> bool {
    message.contains("AccountNotFound")
}

pub(crate) fn send_ix(
    client: &RpcClient,
    payer: &Keypair,
    instruction: Instruction,
) -> Result<Signature> {
    send_ix_with_opts(client, payer, instruction, false, false)
}

pub(crate) fn send_ix_with_opts(
    client: &RpcClient,
    payer: &Keypair,
    instruction: Instruction,
    simulate: bool,
    simulate_only: bool,
) -> Result<Signature> {
    debug!(
        "rpc send transaction: program_id={}, account_count={}, signer={}",
        instruction.program_id,
        instruction.accounts.len(),
        payer.pubkey()
    );
    let blockhash = client
        .get_latest_blockhash()
        .context("failed to fetch blockhash")?;
    let tx = Transaction::new_signed_with_payer(
        &[instruction.clone()],
        Some(&payer.pubkey()),
        &[payer],
        blockhash,
    );

    if simulate {
        eprintln!();
        eprintln!("=== Simulation ===");
        print_instruction_details(&instruction);
        let sim_config = RpcSimulateTransactionConfig {
            sig_verify: false,
            commitment: Some(CommitmentConfig::confirmed()),
            ..Default::default()
        };
        match client.simulate_transaction_with_config(&tx, sim_config) {
            Ok(response) => {
                if let Some(err) = &response.value.err {
                    eprintln!("Result: FAILED ({:?})", err);
                } else {
                    eprintln!(
                        "Result: OK (units: {})",
                        response.value.units_consumed.unwrap_or(0)
                    );
                }
                if let Some(logs) = &response.value.logs {
                    if !logs.is_empty() {
                        eprintln!("Logs:");
                        for log in logs {
                            eprintln!("  {log}");
                        }
                    }
                }
            }
            Err(e) => {
                eprintln!("Simulation RPC error: {e}");
            }
        }
        diagnose_writable_accounts(client, &instruction);
        eprintln!();

        if simulate_only {
            bail!("--simulate-only: transaction not sent");
        }
    }

    let result = client.send_and_confirm_transaction(&tx);
    match result {
        Ok(signature) => {
            debug!("rpc send transaction confirmed: signature={signature}");
            Ok(signature)
        }
        Err(e) => {
            let err_string = e.to_string();
            eprintln!();
            eprintln!("=== Transaction Failed ===");
            eprintln!("Error: {err_string}");
            eprintln!();
            if !simulate {
                print_instruction_details(&instruction);
            }
            diagnose_writable_accounts(client, &instruction);
            eprintln!();
            Err(e).context("failed to send transaction")
        }
    }
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn fmt_key(pubkey: &Pubkey) -> String {
    let label = label_known_account(pubkey);
    if label.is_empty() {
        pubkey.to_string()
    } else {
        format!("{} ({label})", pubkey)
    }
}

// ── Instruction introspection ─────────────────────────────────────

/// Account field names for each known instruction, in order.
/// Includes accounts injected by #[delegate] / #[commit] macros.
fn ix_info(disc: &[u8; 8]) -> Option<(&'static str, &'static [&'static str])> {
    match disc {
        d if *d == IX_UNDELEGATE => Some((
            "undelegate",
            &[
                "user",
                "payer",
                "session_token",
                "deposit",
                "magic_program",
                "magic_context",
            ],
        )),
        d if *d == IX_UNDELEGATE_USERNAME_DEPOSIT => Some((
            "undelegate_username_deposit",
            &[
                "payer",
                "session",
                "deposit",
                "magic_program",
                "magic_context",
            ],
        )),
        d if *d == IX_DELEGATE => Some((
            "delegate",
            &[
                "payer",
                "validator",
                "buffer",
                "delegation_record",
                "delegation_metadata",
                "deposit",
                "owner_program",
                "delegation_program",
                "system_program",
            ],
        )),
        d if *d == IX_DELEGATE_USERNAME_DEPOSIT => Some((
            "delegate_username_deposit",
            &[
                "payer",
                "validator",
                "buffer",
                "delegation_record",
                "delegation_metadata",
                "deposit",
                "owner_program",
                "delegation_program",
                "system_program",
            ],
        )),
        d if *d == IX_INITIALIZE_DEPOSIT => Some((
            "initialize_deposit",
            &[
                "payer",
                "user",
                "deposit",
                "token_mint",
                "token_program",
                "system_program",
            ],
        )),
        d if *d == IX_INITIALIZE_USERNAME_DEPOSIT => Some((
            "initialize_username_deposit",
            &[
                "payer",
                "deposit",
                "token_mint",
                "token_program",
                "system_program",
            ],
        )),
        d if *d == IX_MODIFY_BALANCE => Some((
            "modify_balance",
            &[
                "payer",
                "user",
                "vault",
                "deposit",
                "user_token_account",
                "vault_token_account",
                "token_mint",
                "token_program",
                "associated_token_program",
                "system_program",
            ],
        )),
        d if *d == IX_CREATE_PERMISSION => Some((
            "create_permission",
            &[
                "payer",
                "user",
                "deposit",
                "permission",
                "permission_program",
                "system_program",
            ],
        )),
        d if *d == IX_TRANSFER_TO_USERNAME_DEPOSIT => Some((
            "transfer_to_username_deposit",
            &[
                "payer",
                "user",
                "session_token",
                "source_deposit",
                "destination_deposit",
                "token_mint",
                "system_program",
            ],
        )),
        _ => None,
    }
}

/// Decode the data portion (after 8-byte discriminator) of a known ix.
fn decode_ix_args(disc: &[u8; 8], data: &[u8]) -> Option<String> {
    let args = &data[8..];
    match disc {
        // No extra data
        d if *d == IX_UNDELEGATE || *d == IX_INITIALIZE_DEPOSIT || *d == IX_CREATE_PERMISSION => {
            None
        }
        // amount: u64, increase: bool
        d if *d == IX_MODIFY_BALANCE && args.len() >= 9 => {
            let amount = u64::from_le_bytes(args[..8].try_into().ok()?);
            let increase = args[8] != 0;
            Some(format!("amount={amount} increase={increase}"))
        }
        // amount: u64
        d if *d == IX_TRANSFER_TO_USERNAME_DEPOSIT && args.len() >= 8 => {
            let amount = u64::from_le_bytes(args[..8].try_into().ok()?);
            Some(format!("amount={amount}"))
        }
        // user: Pubkey, token_mint: Pubkey
        d if *d == IX_DELEGATE && args.len() >= 64 => {
            let user = Pubkey::try_from(&args[..32]).ok()?;
            let mint = Pubkey::try_from(&args[32..64]).ok()?;
            Some(format!("user={user} mint={mint}"))
        }
        // username: String (borsh), token_mint: Pubkey
        d if *d == IX_DELEGATE_USERNAME_DEPOSIT
            || *d == IX_UNDELEGATE_USERNAME_DEPOSIT
            || *d == IX_INITIALIZE_USERNAME_DEPOSIT =>
        {
            if args.len() < 4 {
                return None;
            }
            let len = u32::from_le_bytes(args[..4].try_into().ok()?) as usize;
            if args.len() < 4 + len {
                return None;
            }
            let username = String::from_utf8_lossy(&args[4..4 + len]);
            let rest = &args[4 + len..];
            if rest.len() >= 32 {
                let mint = Pubkey::try_from(&rest[..32]).ok()?;
                Some(format!("username=\"{username}\" mint={mint}"))
            } else if *d == IX_INITIALIZE_USERNAME_DEPOSIT {
                Some(format!("username=\"{username}\""))
            } else {
                None
            }
        }
        _ => None,
    }
}

fn print_instruction_details(ix: &Instruction) {
    let prog_label = label_known_account(&ix.program_id);
    if prog_label.is_empty() {
        eprintln!("Program: {}", ix.program_id);
    } else {
        eprintln!("Program: {} ({prog_label})", ix.program_id);
    }

    // Decode instruction name and account field names
    let disc: Option<[u8; 8]> = ix.data.get(..8).and_then(|s| s.try_into().ok());
    let info = disc.as_ref().and_then(ix_info);

    if let Some((name, _)) = info {
        eprintln!("Instruction: {name}");
    }

    // Decode and print args
    if let Some(d) = &disc {
        if let Some(args_str) = decode_ix_args(d, &ix.data) {
            eprintln!("Args: {args_str}");
        }
    }

    let account_names = info.map(|(_, names)| names);
    eprintln!("Accounts:");
    for (i, meta) in ix.accounts.iter().enumerate() {
        let flags = match (meta.is_writable, meta.is_signer) {
            (true, true) => "W+S",
            (true, false) => "W",
            (false, true) => "S",
            (false, false) => "R",
        };
        let field = account_names.and_then(|n| n.get(i).copied()).unwrap_or("");
        let key_label = label_known_account(&meta.pubkey);
        let key_str = if key_label.is_empty() {
            meta.pubkey.to_string()
        } else {
            format!("{} ({key_label})", meta.pubkey)
        };
        if field.is_empty() {
            eprintln!("  [{i}] [{flags:>3}] {key_str}");
        } else {
            eprintln!("  [{i}] [{flags:>3}] {field}: {key_str}");
        }
    }
}

// ── Writable account diagnostics ──────────────────────────────────

fn diagnose_writable_accounts(client: &RpcClient, ix: &Instruction) {
    let writable: Vec<_> = ix.accounts.iter().filter(|m| m.is_writable).collect();
    if writable.is_empty() {
        return;
    }

    let mut problems: Vec<String> = Vec::new();

    eprintln!("Writable account diagnostics:");
    for meta in &writable {
        let key = &meta.pubkey;
        let label = label_known_account(key);
        let key_short = if label.is_empty() {
            key.to_string()
        } else {
            format!("{key} ({label})")
        };

        match client.get_account_with_commitment(key, CommitmentConfig::confirmed()) {
            Ok(response) => {
                if let Some(account) = response.value {
                    let owner_str = fmt_key(&account.owner);
                    eprintln!(
                        "  {key_short}\n    owner={owner_str} \
                         lamports={} data={}B",
                        account.lamports,
                        account.data.len(),
                    );
                    if account.executable {
                        let msg = format!("{key}: executable — cannot be writable");
                        eprintln!("    !! {msg}");
                        problems.push(msg);
                    }
                    if account.owner == delegation_program_id() {
                        eprintln!("    -> delegated (owner=DelegationProgram)");
                        fetch_delegation_record(client, key, &mut problems);
                        fetch_delegation_metadata(client, key);
                    }
                } else {
                    let msg = format!("{key}: does not exist on this RPC");
                    eprintln!("  {key_short}\n    !! {msg}");
                    problems.push(msg);
                }
            }
            Err(e) => {
                eprintln!("  {key_short}\n    !! fetch error: {e}");
            }
        }
    }

    if !problems.is_empty() {
        eprintln!();
        eprintln!("Root cause hints:");
        for (i, p) in problems.iter().enumerate() {
            eprintln!("  {}. {p}", i + 1);
        }
    }
}

// ── Delegation record / metadata decoders ─────────────────────────

fn fetch_delegation_record(
    client: &RpcClient,
    delegated_account: &Pubkey,
    problems: &mut Vec<String>,
) {
    let record_pda = find_delegation_record_pda(delegated_account);
    let Ok(resp) = client.get_account_with_commitment(&record_pda, CommitmentConfig::confirmed())
    else {
        eprintln!("    delegation_record: fetch error");
        return;
    };
    let Some(account) = resp.value else {
        eprintln!("    delegation_record: not found ({})", record_pda);
        problems.push(format!(
            "{delegated_account}: delegated but no delegation_record"
        ));
        return;
    };

    // Layout (bytemuck #[repr(C)]):
    //   [0..8]   discriminator (u64 LE = 100)
    //   [8..40]  authority   — PER validator
    //   [40..72] owner       — original program
    //   [72..80] delegation_slot
    //   [80..88] lamports
    //   [88..96] commit_frequency_ms
    let data = &account.data;
    if data.len() < 96 {
        eprintln!("    delegation_record: too short ({}B)", data.len());
        return;
    }
    let disc = u64::from_le_bytes(data[0..8].try_into().unwrap());
    if disc != 100 {
        eprintln!("    delegation_record: bad discriminator ({disc})");
        return;
    }

    let authority = Pubkey::try_from(&data[8..40]).unwrap();
    let owner = Pubkey::try_from(&data[40..72]).unwrap();
    let slot = u64::from_le_bytes(data[72..80].try_into().unwrap());
    let lamports = u64::from_le_bytes(data[80..88].try_into().unwrap());
    let freq = u64::from_le_bytes(data[88..96].try_into().unwrap());

    eprintln!("    delegation_record ({record_pda}):");
    eprintln!("      authority  : {}", fmt_key(&authority));
    eprintln!("      owner      : {}", fmt_key(&owner));
    eprintln!("      slot       : {slot}");
    eprintln!("      lamports   : {lamports}");
    eprintln!("      commit_ms  : {freq}");

    let auth_label = label_known_account(&authority);
    if auth_label.is_empty() {
        problems.push(format!("delegated to unknown validator {authority}"));
    } else {
        eprintln!("    -> delegated to: {auth_label}");
    }

    if owner != program_id() {
        problems.push(format!(
            "delegation owner {owner} != our program {}",
            program_id()
        ));
    }
}

fn fetch_delegation_metadata(client: &RpcClient, delegated_account: &Pubkey) {
    let meta_pda = find_delegation_metadata_pda(delegated_account);
    let Ok(resp) = client.get_account_with_commitment(&meta_pda, CommitmentConfig::confirmed())
    else {
        eprintln!("    delegation_metadata: fetch error");
        return;
    };
    let Some(account) = resp.value else {
        eprintln!("    delegation_metadata: not found ({})", meta_pda);
        return;
    };

    // Layout (Borsh):
    //   [0..8]  discriminator (u64 LE = 102)
    //   [8..16] last_update_nonce (u64 LE)
    //   [16]    is_undelegatable (bool)
    //   [17..]  seeds: Vec<Vec<u8>> (borsh)
    //   [..]    rent_payer (Pubkey, 32B)
    let data = &account.data;
    if data.len() < 17 {
        eprintln!("    delegation_metadata: too short ({}B)", data.len());
        return;
    }
    let disc = u64::from_le_bytes(data[0..8].try_into().unwrap());
    if disc != 102 {
        eprintln!("    delegation_metadata: bad discriminator ({disc})");
        return;
    }

    let nonce = u64::from_le_bytes(data[8..16].try_into().unwrap());
    let undelegatable = data[16] != 0;

    eprintln!("    delegation_metadata ({meta_pda}):");
    eprintln!("      nonce          : {nonce}");
    eprintln!("      undelegatable  : {undelegatable}");

    // Decode seeds: Vec<Vec<u8>>
    let mut off = 17usize;
    if data.len() >= off + 4 {
        let count = u32::from_le_bytes(data[off..off + 4].try_into().unwrap()) as usize;
        off += 4;
        let mut seeds_strs = Vec::new();
        for _ in 0..count {
            if data.len() < off + 4 {
                break;
            }
            let slen = u32::from_le_bytes(data[off..off + 4].try_into().unwrap()) as usize;
            off += 4;
            if data.len() < off + slen {
                break;
            }
            let seed = &data[off..off + slen];
            off += slen;
            // Display as UTF-8 if printable, otherwise hex
            if seed.iter().all(|b| b.is_ascii_graphic()) {
                seeds_strs.push(format!("\"{}\"", String::from_utf8_lossy(seed)));
            } else if seed.len() == 32 {
                if let Ok(pk) = Pubkey::try_from(seed) {
                    seeds_strs.push(fmt_key(&pk));
                } else {
                    seeds_strs.push(to_hex(seed));
                }
            } else {
                seeds_strs.push(to_hex(seed));
            }
        }
        eprintln!("      seeds          : [{}]", seeds_strs.join(", "));

        // rent_payer follows seeds
        if data.len() >= off + 32 {
            let payer = Pubkey::try_from(&data[off..off + 32]).unwrap();
            eprintln!("      rent_payer     : {}", fmt_key(&payer));
        }
    }
}

// ── Well-known account labels ─────────────────────────────────────

fn label_known_account(pubkey: &Pubkey) -> &'static str {
    let s = pubkey.to_string();
    match s.as_str() {
        "97FzQdWi26mFNR21AbQNg4KqofiCLqQydQfAvRQMcXhV" => "telegram-private-transfer",
        "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh" => "Delegation Program",
        "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1" => "Permission Program",
        "Magic11111111111111111111111111111111111111" => "Magic Program",
        "MagicContext1111111111111111111111111111111" => "Magic Context",
        "11111111111111111111111111111111" => "System Program",
        "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" => "Token Program",
        "So11111111111111111111111111111111111111112" => "wSOL Mint",
        "FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA" => "PER Validator (devnet)",
        "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo" => "PER Validator (mainnet)",
        _ => "",
    }
}

pub(crate) fn ensure_ata_exists(
    client: &RpcClient,
    payer: &Keypair,
    mint: &Pubkey,
    owner: &Pubkey,
) -> Result<()> {
    let ata = get_associated_token_address_with_program_id(owner, mint, &spl_token::id());
    debug!(
        "ensure_ata_exists: owner={}, mint={}, ata={}",
        owner, mint, ata
    );
    if get_account_opt(client, &ata, CommitmentConfig::confirmed())?.is_some() {
        return Ok(());
    }

    let ix =
        create_associated_token_account_idempotent(&payer.pubkey(), owner, mint, &spl_token::id());
    let _ = send_ix(client, payer, ix)?;
    Ok(())
}

pub(crate) fn wrap_sol_to_wsol(
    client: &RpcClient,
    payer: &Keypair,
    wsol_ata: &Pubkey,
    lamports: u64,
) -> Result<bool> {
    debug!("wrap_sol_to_wsol: ata={}, lamports={}", wsol_ata, lamports);
    let owner = payer.pubkey();
    let mut ixs = Vec::new();

    let exists = get_account_opt(client, wsol_ata, CommitmentConfig::confirmed())?.is_some();
    if !exists {
        ixs.push(create_associated_token_account_idempotent(
            &owner,
            &owner,
            &native_mint_id(),
            &spl_token::id(),
        ));
    }

    ixs.push(system_instruction::transfer(&owner, wsol_ata, lamports));
    ixs.push(token_instruction::sync_native(&spl_token::id(), wsol_ata)?);

    let blockhash = client
        .get_latest_blockhash()
        .context("failed to fetch blockhash")?;
    let tx = Transaction::new_signed_with_payer(&ixs, Some(&owner), &[payer], blockhash);
    client
        .send_and_confirm_transaction(&tx)
        .context("failed to wrap SOL into wSOL")?;

    Ok(!exists)
}

pub(crate) fn close_wsol_ata(client: &RpcClient, payer: &Keypair, wsol_ata: &Pubkey) -> Result<()> {
    debug!("close_wsol_ata: ata={}", wsol_ata);
    let ix = token_instruction::close_account(
        &spl_token::id(),
        wsol_ata,
        &payer.pubkey(),
        &payer.pubkey(),
        &[],
    )?;
    let _ = send_ix(client, payer, ix)?;
    Ok(())
}

pub(crate) fn print_signature(output: OutputFormat, signature: Signature) -> Result<()> {
    match output {
        OutputFormat::Display => {
            println!("Signature: {}", signature);
        }
        OutputFormat::Json => {
            println!(
                "{}",
                serde_json::to_string_pretty(&json!({ "signature": signature.to_string() }))?
            );
        }
        OutputFormat::JsonCompact => {
            println!(
                "{}",
                serde_json::to_string(&json!({ "signature": signature.to_string() }))?
            );
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::is_account_not_found_message;

    #[test]
    fn detects_account_not_found_messages() {
        assert!(is_account_not_found_message(
            "AccountNotFound: pubkey=2oBc...: error sending request for url (...)"
        ));
    }

    #[test]
    fn ignores_other_messages() {
        assert!(!is_account_not_found_message("401 unauthorized"));
    }
}
