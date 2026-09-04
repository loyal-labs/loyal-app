use anyhow::{anyhow, bail, Context, Result};
use solana_client::rpc_client::RpcClient;
use solana_compute_budget_interface::ComputeBudgetInstruction;
use solana_sdk::{
    account::Account,
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
};
use solana_system_interface::instruction as system_instruction;
use spl_associated_token_account_client::{
    address::get_associated_token_address_with_program_id,
    instruction::create_associated_token_account_idempotent,
};
use spl_token::instruction as token_instruction;
use std::str::FromStr;

use crate::cli::{SolTransferArgs, TokenTransferArgs};

const LAMPORT_DECIMALS: u8 = 9;
const MEMO_PROGRAM_ID: &str = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const TOKEN_2022_PROGRAM_ID: &str = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

#[derive(Debug, Clone)]
pub(crate) struct SpendingLimitTransferPayload {
    pub(crate) mint: Pubkey,
    pub(crate) amount: u64,
    pub(crate) destination: Pubkey,
    pub(crate) decimals: u8,
}

pub(crate) fn build_sol_transfer(
    client: &RpcClient,
    vault_pda: &Pubkey,
    args: &SolTransferArgs,
) -> Result<Vec<Instruction>> {
    let recipient = parse_pubkey("recipient address", &args.recipient_address)?;
    validate_optional_vault_source("source account", args.from.as_deref(), vault_pda)?;
    if !args.allow_unfunded_recipient && get_account_optional(client, &recipient)?.is_none() {
        bail!("recipient account is not funded; pass --allow-unfunded-recipient to continue");
    }

    let lamports = parse_sol_amount(client, vault_pda, &args.amount)?;
    let mut instructions = compute_budget_instructions(None, args.with_compute_unit_price);
    instructions.push(system_instruction::transfer(
        vault_pda, &recipient, lamports,
    ));
    append_memo_instruction(&mut instructions, args.with_memo.as_deref())?;

    Ok(instructions)
}

pub(crate) fn build_sol_spending_limit_payload(
    client: &RpcClient,
    vault_pda: &Pubkey,
    args: &SolTransferArgs,
) -> Result<SpendingLimitTransferPayload> {
    let destination = parse_pubkey("recipient address", &args.recipient_address)?;
    validate_optional_vault_source("source account", args.from.as_deref(), vault_pda)?;
    if !args.allow_unfunded_recipient && get_account_optional(client, &destination)?.is_none() {
        bail!("recipient account is not funded; pass --allow-unfunded-recipient to continue");
    }

    Ok(SpendingLimitTransferPayload {
        mint: system_program_id(),
        amount: parse_sol_amount(client, vault_pda, &args.amount)?,
        destination,
        decimals: LAMPORT_DECIMALS,
    })
}

pub(crate) fn build_token_transfer(
    client: &RpcClient,
    vault_pda: &Pubkey,
    args: &TokenTransferArgs,
) -> Result<Vec<Instruction>> {
    let mint = parse_pubkey("token mint address", &args.token_mint_address)?;
    validate_optional_vault_source("token owner", args.owner.as_deref(), vault_pda)?;
    let token_program_id = resolve_token_program_id(args)?;
    let source_token_account = args
        .from
        .as_deref()
        .map(|value| parse_pubkey("source token account", value))
        .transpose()?
        .unwrap_or_else(|| {
            get_associated_token_address_with_program_id(vault_pda, &mint, &token_program_id)
        });
    let decimals = match args.mint_decimals {
        Some(decimals) => decimals,
        None => {
            client
                .get_token_supply(&mint)
                .with_context(|| format!("failed to fetch mint supply for {mint}"))?
                .decimals
        }
    };
    let amount = parse_token_amount(client, &source_token_account, &args.token_amount, decimals)?;
    let recipient = parse_pubkey("recipient address", &args.recipient_address)?;
    let (destination_token_account, mut instructions) = resolve_destination_token_account(
        client,
        vault_pda,
        &mint,
        &token_program_id,
        &recipient,
        args,
    )?;

    let mut transfer = token_instruction::transfer_checked(
        &token_program_id,
        &source_token_account,
        &mint,
        &destination_token_account,
        vault_pda,
        &[],
        amount,
        decimals,
    )
    .map_err(|error| anyhow!("failed to build token transfer instruction: {error}"))?;
    transfer
        .accounts
        .extend(parse_transfer_hook_accounts(&args.transfer_hook_account)?);
    let mut compute_budget =
        compute_budget_instructions(args.with_compute_unit_limit, args.with_compute_unit_price);
    compute_budget.append(&mut instructions);
    let mut instructions = compute_budget;
    instructions.push(transfer);
    append_memo_instruction(&mut instructions, args.with_memo.as_deref())?;

    Ok(instructions)
}

pub(crate) fn build_token_spending_limit_payload(
    client: &RpcClient,
    vault_pda: &Pubkey,
    args: &TokenTransferArgs,
) -> Result<SpendingLimitTransferPayload> {
    if args.fund_recipient {
        bail!(
            "--fund-recipient is not supported with SpendingLimit policies; create the recipient associated token account first or use a ProgramInteraction policy"
        );
    }

    let mint = parse_pubkey("token mint address", &args.token_mint_address)?;
    validate_optional_vault_source("token owner", args.owner.as_deref(), vault_pda)?;
    let token_program_id = resolve_token_program_id(args)?;
    let source_token_account = args
        .from
        .as_deref()
        .map(|value| parse_pubkey("source token account", value))
        .transpose()?
        .unwrap_or_else(|| {
            get_associated_token_address_with_program_id(vault_pda, &mint, &token_program_id)
        });
    let decimals = match args.mint_decimals {
        Some(decimals) => decimals,
        None => {
            client
                .get_token_supply(&mint)
                .with_context(|| format!("failed to fetch mint supply for {mint}"))?
                .decimals
        }
    };
    let destination = parse_pubkey("recipient address", &args.recipient_address)?;
    let destination_token_account =
        get_associated_token_address_with_program_id(&destination, &mint, &token_program_id);
    if get_account_optional(client, &destination_token_account)?.is_none() {
        bail!(
            "recipient associated token account does not exist; create it first or use a ProgramInteraction policy with --fund-recipient"
        );
    }

    Ok(SpendingLimitTransferPayload {
        mint,
        amount: parse_token_amount(client, &source_token_account, &args.token_amount, decimals)?,
        destination,
        decimals,
    })
}

fn compute_budget_instructions(
    compute_unit_limit: Option<u32>,
    compute_unit_price: Option<u64>,
) -> Vec<Instruction> {
    let mut instructions = Vec::new();
    if let Some(limit) = compute_unit_limit {
        instructions.push(ComputeBudgetInstruction::set_compute_unit_limit(limit));
    }
    if let Some(price) = compute_unit_price {
        instructions.push(ComputeBudgetInstruction::set_compute_unit_price(price));
    }
    instructions
}

fn validate_optional_vault_source(
    label: &str,
    value: Option<&str>,
    vault_pda: &Pubkey,
) -> Result<()> {
    let Some(value) = value else {
        return Ok(());
    };
    let source = parse_pubkey(label, value)?;
    if source != *vault_pda {
        bail!("{label} must match the policy vault {vault_pda}");
    }
    Ok(())
}

fn resolve_destination_token_account(
    client: &RpcClient,
    payer: &Pubkey,
    mint: &Pubkey,
    token_program_id: &Pubkey,
    recipient: &Pubkey,
    args: &TokenTransferArgs,
) -> Result<(Pubkey, Vec<Instruction>)> {
    if let Some(account) = get_account_optional(client, recipient)? {
        if account.owner == *token_program_id {
            return Ok((*recipient, Vec::new()));
        }

        if account.owner != system_program_id() && !args.allow_non_system_account_recipient {
            bail!(
                "recipient is not a system account; pass --allow-non-system-account-recipient to treat it as a wallet owner"
            );
        }
    } else if !args.allow_unfunded_recipient {
        bail!("recipient account is not funded; pass --allow-unfunded-recipient to continue");
    }

    let destination =
        get_associated_token_address_with_program_id(recipient, mint, token_program_id);
    if args.fund_recipient {
        return Ok((
            destination,
            vec![create_associated_token_account_idempotent(
                payer,
                recipient,
                mint,
                token_program_id,
            )],
        ));
    }

    if get_account_optional(client, &destination)?.is_none() {
        bail!("recipient associated token account does not exist; pass --fund-recipient to create it from the vault");
    }

    Ok((destination, Vec::new()))
}

fn parse_sol_amount(client: &RpcClient, vault_pda: &Pubkey, amount: &str) -> Result<u64> {
    if amount.eq_ignore_ascii_case("ALL") {
        let balance = client
            .get_balance(vault_pda)
            .with_context(|| format!("failed to fetch SOL balance for vault {vault_pda}"))?;
        if balance == 0 {
            bail!("vault SOL balance is zero");
        }
        return Ok(balance);
    }

    parse_decimal_amount(amount, LAMPORT_DECIMALS)
}

fn parse_token_amount(
    client: &RpcClient,
    source_token_account: &Pubkey,
    amount: &str,
    decimals: u8,
) -> Result<u64> {
    if amount.eq_ignore_ascii_case("ALL") {
        let balance = client
            .get_token_account_balance(source_token_account)
            .with_context(|| {
                format!("failed to fetch token balance for source account {source_token_account}")
            })?;
        return balance.amount.parse::<u64>().with_context(|| {
            format!(
                "failed to parse raw token balance {} for source account {}",
                balance.amount, source_token_account
            )
        });
    }

    parse_decimal_amount(amount, decimals)
}

fn parse_decimal_amount(amount: &str, decimals: u8) -> Result<u64> {
    let trimmed = amount.trim();
    if trimmed.is_empty() {
        bail!("amount cannot be empty");
    }
    if trimmed.starts_with('-') {
        bail!("amount cannot be negative");
    }

    let mut parts = trimmed.split('.');
    let whole = parts.next().unwrap_or_default();
    let fractional = parts.next();
    if parts.next().is_some() {
        bail!("invalid amount '{amount}'");
    }
    if whole.is_empty() && fractional.is_none_or(str::is_empty) {
        bail!("invalid amount '{amount}'");
    }
    if !whole.chars().all(|ch| ch.is_ascii_digit()) {
        bail!("invalid amount '{amount}'");
    }
    let fractional = fractional.unwrap_or_default();
    if !fractional.chars().all(|ch| ch.is_ascii_digit()) {
        bail!("invalid amount '{amount}'");
    }
    if fractional.len() > decimals as usize {
        bail!("amount '{amount}' has more than {decimals} decimal places");
    }

    let scale = 10u128
        .checked_pow(decimals as u32)
        .ok_or_else(|| anyhow!("token decimals {decimals} are too large"))?;
    let whole_raw = if whole.is_empty() {
        0
    } else {
        whole
            .parse::<u128>()
            .with_context(|| format!("invalid amount '{amount}'"))?
            .checked_mul(scale)
            .ok_or_else(|| anyhow!("amount '{amount}' is too large"))?
    };
    let fractional_raw = if fractional.is_empty() {
        0
    } else {
        let fractional_scale = 10u128
            .checked_pow((decimals as usize - fractional.len()) as u32)
            .ok_or_else(|| anyhow!("token decimals {decimals} are too large"))?;
        fractional
            .parse::<u128>()
            .with_context(|| format!("invalid amount '{amount}'"))?
            .checked_mul(fractional_scale)
            .ok_or_else(|| anyhow!("amount '{amount}' is too large"))?
    };
    let raw = whole_raw
        .checked_add(fractional_raw)
        .ok_or_else(|| anyhow!("amount '{amount}' is too large"))?;
    u64::try_from(raw).with_context(|| format!("amount '{amount}' is too large"))
}

fn append_memo_instruction(instructions: &mut Vec<Instruction>, memo: Option<&str>) -> Result<()> {
    let Some(memo) = memo else {
        return Ok(());
    };
    instructions.push(Instruction {
        program_id: parse_pubkey("memo program id", MEMO_PROGRAM_ID)?,
        accounts: Vec::new(),
        data: memo.as_bytes().to_vec(),
    });
    Ok(())
}

fn parse_transfer_hook_accounts(values: &[String]) -> Result<Vec<AccountMeta>> {
    values
        .iter()
        .map(|value| {
            let (pubkey, role) = value
                .split_once(':')
                .ok_or_else(|| anyhow!("invalid transfer hook account '{value}'"))?;
            let pubkey = parse_pubkey("transfer hook account", pubkey)?;
            match role {
                "readonly" => Ok(AccountMeta::new_readonly(pubkey, false)),
                "writable" => Ok(AccountMeta::new(pubkey, false)),
                "readonly-signer" => Ok(AccountMeta::new_readonly(pubkey, true)),
                "writable-signer" => Ok(AccountMeta::new(pubkey, true)),
                _ => bail!(
                    "invalid transfer hook role '{role}', expected readonly|writable|readonly-signer|writable-signer"
                ),
            }
        })
        .collect()
}

fn resolve_token_program_id(args: &TokenTransferArgs) -> Result<Pubkey> {
    if args.program_2022 {
        return parse_pubkey("token-2022 program id", TOKEN_2022_PROGRAM_ID);
    }

    args.token_program_id
        .as_deref()
        .map(|value| parse_pubkey("token program id", value))
        .transpose()
        .map(|value| value.unwrap_or_else(spl_token::id))
}

fn get_account_optional(client: &RpcClient, pubkey: &Pubkey) -> Result<Option<Account>> {
    client
        .get_account_with_commitment(pubkey, client.commitment())
        .with_context(|| format!("failed to fetch account {pubkey}"))
        .map(|response| response.value)
}

fn parse_pubkey(label: &str, value: &str) -> Result<Pubkey> {
    Pubkey::from_str(value).with_context(|| format!("invalid {label}: {value}"))
}

fn system_program_id() -> Pubkey {
    Pubkey::new_from_array([0; 32])
}

#[cfg(test)]
mod tests {
    use super::parse_decimal_amount;

    #[test]
    fn parses_decimal_amounts() {
        assert_eq!(parse_decimal_amount("1", 9).unwrap(), 1_000_000_000);
        assert_eq!(parse_decimal_amount("1.5", 9).unwrap(), 1_500_000_000);
        assert_eq!(parse_decimal_amount(".5", 6).unwrap(), 500_000);
        assert_eq!(parse_decimal_amount("0.000001", 6).unwrap(), 1);
    }

    #[test]
    fn rejects_over_precise_amounts() {
        assert!(parse_decimal_amount("0.0000001", 6).is_err());
    }
}
