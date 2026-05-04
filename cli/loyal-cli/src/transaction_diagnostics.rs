use anyhow::{anyhow, Context, Result};
use solana_client::{client_error::ClientError, rpc_client::RpcClient};
use solana_rpc_client_api::config::RpcSimulateTransactionConfig;
use solana_sdk::{
    pubkey::Pubkey,
    signature::Signature,
    transaction::{Transaction, TransactionError},
};
use std::collections::HashSet;

pub(crate) fn send_transaction_with_diagnostics(
    client: &RpcClient,
    transaction: &Transaction,
    context: &'static str,
) -> Result<Signature> {
    match client.send_transaction(transaction) {
        Ok(signature) => Ok(signature),
        Err(error) => {
            let diagnostics = build_transaction_diagnostics(client, transaction, &error);
            Err(anyhow!(diagnostics)).with_context(|| context)
        }
    }
}

fn build_transaction_diagnostics(
    client: &RpcClient,
    transaction: &Transaction,
    send_error: &ClientError,
) -> String {
    let simulation = simulate_transaction(client, transaction);
    let accounts = inspect_transaction_accounts(client, transaction);
    let root_cause = infer_root_cause(send_error, simulation.err.as_ref(), &accounts);

    let mut lines = vec![
        "transaction diagnostics".to_string(),
        format!("  current Solana error: {send_error}"),
        format!("  root cause: {root_cause}"),
    ];

    lines.extend(simulation.format_lines());
    lines.extend(format_account_lines(&accounts));
    lines.extend(format_instruction_lines(transaction));

    lines.join("\n")
}

#[derive(Debug)]
struct SimulationDiagnostics {
    err: Option<TransactionError>,
    logs: Option<Vec<String>>,
    units_consumed: Option<u64>,
    rpc_error: Option<String>,
}

impl SimulationDiagnostics {
    fn format_lines(&self) -> Vec<String> {
        let mut lines = Vec::new();
        lines.push("  simulation:".to_string());

        if let Some(error) = &self.rpc_error {
            lines.push(format!("    rpc error: {error}"));
            return lines;
        }

        match &self.err {
            Some(error) => lines.push(format!("    result: failed ({error:?})")),
            None => lines.push("    result: ok".to_string()),
        }

        if let Some(units) = self.units_consumed {
            lines.push(format!("    units consumed: {units}"));
        }

        match &self.logs {
            Some(logs) if !logs.is_empty() => {
                lines.push("    logs:".to_string());
                for log in logs.iter().take(20) {
                    lines.push(format!("      {log}"));
                }
                if logs.len() > 20 {
                    lines.push(format!("      ... {} more log lines", logs.len() - 20));
                }
            }
            _ => lines.push("    logs: none".to_string()),
        }

        lines
    }
}

fn simulate_transaction(client: &RpcClient, transaction: &Transaction) -> SimulationDiagnostics {
    let config = RpcSimulateTransactionConfig {
        sig_verify: false,
        commitment: Some(client.commitment()),
        ..Default::default()
    };

    match client.simulate_transaction_with_config(transaction, config) {
        Ok(response) => SimulationDiagnostics {
            err: response.value.err,
            logs: response.value.logs,
            units_consumed: response.value.units_consumed,
            rpc_error: None,
        },
        Err(error) => SimulationDiagnostics {
            err: None,
            logs: None,
            units_consumed: None,
            rpc_error: Some(error.to_string()),
        },
    }
}

#[derive(Debug)]
struct AccountDiagnostics {
    index: usize,
    address: Pubkey,
    roles: Vec<&'static str>,
    status: AccountStatus,
}

impl AccountDiagnostics {
    fn has_role(&self, role: &'static str) -> bool {
        self.roles.contains(&role)
    }
}

#[derive(Debug)]
enum AccountStatus {
    Found {
        lamports: u64,
        rent_exempt_minimum: Option<u64>,
        owner: Pubkey,
        executable: bool,
        data_len: usize,
    },
    Missing,
    RpcError(String),
}

fn inspect_transaction_accounts(
    client: &RpcClient,
    transaction: &Transaction,
) -> Vec<AccountDiagnostics> {
    let message = &transaction.message;
    let mut seen = HashSet::new();
    let mut accounts = Vec::new();

    for (index, address) in message.account_keys.iter().enumerate() {
        let roles = account_roles(transaction, index);
        if !should_inspect(&roles) || !seen.insert(*address) {
            continue;
        }

        accounts.push(AccountDiagnostics {
            index,
            address: *address,
            roles,
            status: fetch_account_status(client, address),
        });
    }

    accounts
}

fn should_inspect(roles: &[&'static str]) -> bool {
    roles.iter().any(|role| {
        matches!(
            *role,
            "fee-payer" | "signer" | "writable" | "instruction-program"
        )
    })
}

fn account_roles(transaction: &Transaction, index: usize) -> Vec<&'static str> {
    let message = &transaction.message;
    let mut roles = Vec::new();
    let required_signatures = message.header.num_required_signatures as usize;

    if index == 0 {
        roles.push("fee-payer");
    }
    if index < required_signatures {
        roles.push("signer");
    }
    if is_writable(transaction, index) {
        roles.push("writable");
    } else {
        roles.push("readonly");
    }

    let account = message.account_keys[index];
    if message.instructions.iter().any(|instruction| {
        message
            .account_keys
            .get(instruction.program_id_index as usize)
            .is_some_and(|program_id| *program_id == account)
    }) {
        roles.push("instruction-program");
    }

    roles
}

fn is_writable(transaction: &Transaction, index: usize) -> bool {
    let header = &transaction.message.header;
    let account_count = transaction.message.account_keys.len();
    let required_signatures = header.num_required_signatures as usize;
    let readonly_signed = header.num_readonly_signed_accounts as usize;
    let readonly_unsigned = header.num_readonly_unsigned_accounts as usize;
    let writable_signed_end = required_signatures.saturating_sub(readonly_signed);
    let writable_unsigned_end = account_count.saturating_sub(readonly_unsigned);

    index < writable_signed_end || (index >= required_signatures && index < writable_unsigned_end)
}

fn fetch_account_status(client: &RpcClient, address: &Pubkey) -> AccountStatus {
    match client.get_account_with_commitment(address, client.commitment()) {
        Ok(response) => match response.value {
            Some(account) => AccountStatus::Found {
                lamports: account.lamports,
                rent_exempt_minimum: client
                    .get_minimum_balance_for_rent_exemption(account.data.len())
                    .ok(),
                owner: account.owner,
                executable: account.executable,
                data_len: account.data.len(),
            },
            None => AccountStatus::Missing,
        },
        Err(error) => AccountStatus::RpcError(error.to_string()),
    }
}

fn infer_root_cause(
    send_error: &ClientError,
    simulation_error: Option<&TransactionError>,
    accounts: &[AccountDiagnostics],
) -> String {
    let send_error = send_error.to_string();
    let simulation_error_text = simulation_error
        .map(|error| format!("{error:?}"))
        .unwrap_or_default();
    let combined = format!("{send_error} {simulation_error_text}").to_lowercase();

    if contains_any(
        &combined,
        &[
            "programaccountnotfound",
            "attempt to load a program that does not exist",
        ],
    ) {
        if let Some(program) = accounts.iter().find(|account| {
            account.has_role("instruction-program")
                && matches!(account.status, AccountStatus::Missing)
        }) {
            return format!(
                "instruction program {} is not deployed on the selected Solana cluster.",
                program.address
            );
        }
        return "one of the instruction programs is not deployed on the selected Solana cluster."
            .to_string();
    }

    if let Some(account_index) = insufficient_rent_account_index(simulation_error, &combined) {
        if let Some(account) = accounts
            .iter()
            .find(|account| account.index == account_index)
        {
            let role_label = if account.has_role("fee-payer") {
                "fee payer"
            } else if account.has_role("signer") {
                "signer"
            } else if account.has_role("writable") {
                "writable account"
            } else {
                "account"
            };

            match &account.status {
                AccountStatus::Found {
                    lamports,
                    rent_exempt_minimum,
                    ..
                } => {
                    let rent_clause = rent_exempt_minimum.map_or_else(String::new, |minimum| {
                        format!(
                            " It must retain at least {} lamports ({:.9} SOL) after this transaction.",
                            minimum,
                            lamports_to_sol(minimum)
                        )
                    });
                    let action = if account.has_role("fee-payer") {
                        "Fund this Loyal CLI identity and retry."
                    } else {
                        "Fund this account or reduce the transaction's SOL debits and retry."
                    };

                    return format!(
                        "account index {account_index} ({role_label} {}) would fall below its rent-exempt reserve after this transaction. Current balance is {} lamports ({:.9} SOL).{rent_clause} {action}",
                        account.address,
                        lamports,
                        lamports_to_sol(*lamports),
                    );
                }
                AccountStatus::Missing => {
                    return format!(
                        "account index {account_index} ({role_label} {}) is missing and cannot satisfy rent requirements.",
                        account.address
                    );
                }
                AccountStatus::RpcError(error) => {
                    return format!(
                        "account index {account_index} would fall below rent-exempt reserve, but the CLI could not fetch {}: {error}",
                        account.address
                    );
                }
            }
        }

        return format!(
            "account index {account_index} would fall below its rent-exempt reserve after this transaction."
        );
    }

    if contains_any(
        &combined,
        &[
            "accountnotfound",
            "found no record of a prior credit",
            "account not found",
        ],
    ) {
        if let Some(fee_payer) = accounts
            .iter()
            .find(|account| account.has_role("fee-payer"))
        {
            match &fee_payer.status {
                AccountStatus::Missing => {
                    return format!(
                        "fee payer {} has no account on the selected Solana cluster, so preflight cannot debit transaction fees. Fund this Loyal CLI identity or switch --rpc-url/LOYAL_RPC_URL to the cluster where it is funded.",
                        fee_payer.address
                    );
                }
                AccountStatus::Found { lamports: 0, .. } => {
                    return format!(
                        "fee payer {} has 0 lamports on the selected Solana cluster, so it cannot pay transaction fees.",
                        fee_payer.address
                    );
                }
                AccountStatus::RpcError(error) => {
                    return format!(
                        "Solana reported a missing debit account, and the fee payer {} could not be checked: {error}",
                        fee_payer.address
                    );
                }
                AccountStatus::Found { .. } => {}
            }
        }

        if let Some(missing_writable) = accounts.iter().find(|account| {
            account.has_role("writable") && matches!(account.status, AccountStatus::Missing)
        }) {
            return format!(
                "writable account {} is missing on the selected Solana cluster; if this account is not created by the transaction, create/fund it or use the correct RPC cluster.",
                missing_writable.address
            );
        }

        return "Solana could not debit one of the transaction accounts because that account has no prior credit on this cluster; inspect the account balances below.".to_string();
    }

    if contains_any(
        &combined,
        &["insufficientfundsforfee", "insufficient funds for fee"],
    ) {
        if let Some(fee_payer) = accounts
            .iter()
            .find(|account| account.has_role("fee-payer"))
        {
            return format!(
                "fee payer {} does not have enough SOL to pay transaction fees.",
                fee_payer.address
            );
        }
        return "the transaction fee payer does not have enough SOL to pay fees.".to_string();
    }

    if contains_any(&combined, &["blockhashnotfound", "blockhash not found"]) {
        return "the recent blockhash expired or is not recognized by the selected RPC node; rebuild and resend the transaction.".to_string();
    }

    if contains_any(&combined, &["instructionerror"]) {
        return "an on-chain instruction rejected the transaction; use the simulation error and logs below to identify the failing instruction.".to_string();
    }

    "the RPC node rejected the transaction; use the simulation result, logs, and account balances below to narrow the failing account or instruction.".to_string()
}

fn contains_any(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| haystack.contains(needle))
}

fn insufficient_rent_account_index(
    simulation_error: Option<&TransactionError>,
    combined_error: &str,
) -> Option<usize> {
    match simulation_error {
        Some(TransactionError::InsufficientFundsForRent { account_index }) => {
            Some(*account_index as usize)
        }
        Some(TransactionError::InvalidRentPayingAccount) => Some(0),
        _ => extract_account_index(combined_error),
    }
}

fn extract_account_index(error: &str) -> Option<usize> {
    let marker = "account (";
    let start = error.find(marker)? + marker.len();
    let end = error[start..].find(')')? + start;
    error[start..end].parse().ok()
}

fn format_account_lines(accounts: &[AccountDiagnostics]) -> Vec<String> {
    let mut lines = vec!["  account checks:".to_string()];

    if accounts.is_empty() {
        lines.push("    none".to_string());
        return lines;
    }

    for account in accounts {
        let roles = account.roles.join(", ");
        match &account.status {
            AccountStatus::Found {
                lamports,
                rent_exempt_minimum,
                owner,
                executable,
                data_len,
            } => {
                let rent_suffix = rent_exempt_minimum.map_or_else(String::new, |minimum| {
                    format!(
                        ", rent-exempt min {} lamports ({:.9} SOL)",
                        minimum,
                        lamports_to_sol(minimum)
                    )
                });
                lines.push(format!(
                    "    {}: {} [{}]: {} lamports ({:.9} SOL), owner {}, executable {}, data bytes {}{}",
                    account.index,
                    account.address,
                    roles,
                    lamports,
                    lamports_to_sol(*lamports),
                    owner,
                    executable,
                    data_len,
                    rent_suffix
                ));
            }
            AccountStatus::Missing => lines.push(format!(
                "    {}: {} [{}]: missing account",
                account.index, account.address, roles
            )),
            AccountStatus::RpcError(error) => lines.push(format!(
                "    {}: {} [{}]: failed to fetch account: {}",
                account.index, account.address, roles, error
            )),
        }
    }

    lines
}

fn format_instruction_lines(transaction: &Transaction) -> Vec<String> {
    let mut lines = vec!["  instructions:".to_string()];
    let message = &transaction.message;

    if message.instructions.is_empty() {
        lines.push("    none".to_string());
        return lines;
    }

    for (index, instruction) in message.instructions.iter().enumerate() {
        let program_id = message
            .account_keys
            .get(instruction.program_id_index as usize)
            .map_or_else(
                || format!("<invalid account index {}>", instruction.program_id_index),
                Pubkey::to_string,
            );
        lines.push(format!(
            "    {index}: program {}, accounts {}, data bytes {}",
            program_id,
            instruction.accounts.len(),
            instruction.data.len()
        ));
    }

    lines
}

fn lamports_to_sol(lamports: u64) -> f64 {
    lamports as f64 / 1_000_000_000_f64
}

#[cfg(test)]
mod tests {
    use super::{infer_root_cause, AccountDiagnostics, AccountStatus};
    use solana_client::client_error::ClientError;
    use solana_sdk::pubkey::Pubkey;

    fn client_error(message: &str) -> ClientError {
        ClientError::from(std::io::Error::new(
            std::io::ErrorKind::Other,
            message.to_string(),
        ))
    }

    #[test]
    fn explains_missing_fee_payer_for_prior_credit_error() {
        let payer = Pubkey::new_unique();
        let accounts = vec![AccountDiagnostics {
            index: 0,
            address: payer,
            roles: vec!["fee-payer", "signer", "writable"],
            status: AccountStatus::Missing,
        }];

        let root_cause = infer_root_cause(
            &client_error(
                "Transaction simulation failed: Attempt to debit an account but found no record of a prior credit.",
            ),
            None,
            &accounts,
        );

        assert!(root_cause.contains(&payer.to_string()));
        assert!(root_cause.contains("fee payer"));
        assert!(root_cause.contains("Fund this Loyal CLI identity"));
    }

    #[test]
    fn explains_missing_program_for_program_account_error() {
        let program_id = Pubkey::new_unique();
        let accounts = vec![AccountDiagnostics {
            index: 2,
            address: program_id,
            roles: vec!["readonly", "instruction-program"],
            status: AccountStatus::Missing,
        }];

        let root_cause = infer_root_cause(
            &client_error("Transaction simulation failed: ProgramAccountNotFound"),
            None,
            &accounts,
        );

        assert!(root_cause.contains(&program_id.to_string()));
        assert!(root_cause.contains("not deployed"));
    }

    #[test]
    fn explains_fee_payer_rent_reserve_failure() {
        let payer = Pubkey::new_unique();
        let accounts = vec![AccountDiagnostics {
            index: 0,
            address: payer,
            roles: vec!["fee-payer", "signer", "writable"],
            status: AccountStatus::Found {
                lamports: 5_074_280,
                rent_exempt_minimum: Some(890_880),
                owner: Pubkey::new_unique(),
                executable: false,
                data_len: 0,
            },
        }];

        let root_cause = infer_root_cause(
            &client_error("Transaction results in an account (0) with insufficient funds for rent"),
            Some(
                &solana_sdk::transaction::TransactionError::InsufficientFundsForRent {
                    account_index: 0,
                },
            ),
            &accounts,
        );

        assert!(root_cause.contains("account index 0"));
        assert!(root_cause.contains(&payer.to_string()));
        assert!(root_cause.contains("rent-exempt reserve"));
        assert!(root_cause.contains("Fund this Loyal CLI identity"));
    }
}
