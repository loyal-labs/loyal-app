use anyhow::{bail, Context, Result};
use serde::Serialize;
use solana_sdk::{pubkey::Pubkey, signer::Signer};
use std::{process::Command, str::FromStr};

use crate::{
    cli::{AuthArgs, OutputFormat, ProposeArgs, ProposeCommand, TransferCommand},
    config::{connect_url, save_connection, ResolvedConfig, SavedConnection},
    identity::{ensure_identity, inspect_identity, load_identity, IdentityState, ReadyIdentity},
    squads::{
        propose_raw_transaction, propose_sol_transfer, propose_token_transfer,
        wait_for_policy_connection, AgentConnection, ProposalOutput,
    },
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct IdentityOutput {
    status: &'static str,
    keypair_path: String,
    exists: bool,
    pubkey: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthOutput {
    keypair_path: String,
    pubkey: String,
    connect_url: String,
    connection: AgentConnection,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProposeOutput {
    proposal: ProposalOutput,
}

pub(crate) fn cmd_auth(
    config: &ResolvedConfig,
    output: OutputFormat,
    args: &AuthArgs,
) -> Result<()> {
    let identity = ensure_identity(&config.keypair_path, args.force)?;
    let url = connect_url(&config.web_url, &identity.pubkey);

    match output {
        OutputFormat::Display => {
            println!("Loyal agent identity");
            println!("Keypair Path: {}", identity.keypair_path);
            println!("Public Key: {}", identity.pubkey);
            println!("Connect URL: {url}");
            if !args.no_open {
                if let Err(error) = open_url(&url) {
                    eprintln!("Warning: failed to open browser: {error}");
                }
            }
        }
        OutputFormat::Json | OutputFormat::JsonCompact => {}
    }

    let signer = Pubkey::from_str(&identity.pubkey)?;
    let connection =
        wait_for_policy_connection(config, &signer, args, output == OutputFormat::Display)?;
    save_connection(
        config,
        &SavedConnection {
            settings_pda: connection.settings_pda.clone(),
            policy_pda: connection.policy_pda.clone(),
            account_index: connection.account_index,
        },
    )?;

    let payload = AuthOutput {
        keypair_path: identity.keypair_path,
        pubkey: identity.pubkey,
        connect_url: url,
        connection,
    };

    match output {
        OutputFormat::Display => {
            println!();
            println!("Connected.");
            println!("Settings PDA: {}", payload.connection.settings_pda);
            println!("Policy PDA: {}", payload.connection.policy_pda);
            println!("Program ID: {}", payload.connection.program_id);
            println!("RPC URL: {}", payload.connection.rpc_url);
            println!("Config File: {}", config.config_path.display());
        }
        OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&payload)?),
        OutputFormat::JsonCompact => println!("{}", serde_json::to_string(&payload)?),
    }

    Ok(())
}

pub(crate) fn cmd_pubkey(config: &ResolvedConfig, output: OutputFormat) -> Result<()> {
    let identity = load_identity(&config.keypair_path)?;
    let payload = identity_output(ReadyIdentity {
        keypair_path: identity.keypair_path,
        pubkey: identity.keypair.pubkey().to_string(),
    });

    match output {
        OutputFormat::Display => println!("{}", payload.pubkey.as_deref().unwrap_or_default()),
        OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&payload)?),
        OutputFormat::JsonCompact => println!("{}", serde_json::to_string(&payload)?),
    }

    Ok(())
}

pub(crate) fn cmd_show(config: &ResolvedConfig, output: OutputFormat) -> Result<()> {
    let payload = identity_state_output(inspect_identity(&config.keypair_path));

    match output {
        OutputFormat::Display => {
            println!("Loyal agent identity");
            println!("Config File: {}", config.config_path.display());
            println!("Frontend URL: {}", config.web_url);
            println!("Keypair Path: {}", payload.keypair_path);
            println!("Status: {}", payload.status);
            println!("Exists: {}", yes_no(payload.exists));
            if let Some(pubkey) = payload.pubkey.as_deref() {
                println!("Public Key: {}", pubkey);
            }
            if let Some(settings_pda) = config.settings_pda.as_deref() {
                println!("Settings PDA: {settings_pda}");
            }
            if let Some(policy_pda) = config.policy_pda.as_deref() {
                println!("Policy PDA: {policy_pda}");
            }
            println!("Program ID: {}", config.program_id);
            println!("RPC URL: {}", config.rpc_url);
            if let Some(ws_url) = config.ws_url.as_deref() {
                println!("WebSocket URL: {ws_url}");
            }
            if let Some(account_index) = config.account_index {
                println!("Account Index: {account_index}");
            }
            if let Some(error) = payload.error.as_deref() {
                println!("Error: {}", error);
            }
        }
        OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&payload)?),
        OutputFormat::JsonCompact => println!("{}", serde_json::to_string(&payload)?),
    }

    Ok(())
}

pub(crate) fn cmd_propose(
    config: &ResolvedConfig,
    output: OutputFormat,
    args: &ProposeArgs,
) -> Result<()> {
    let identity = load_identity(&config.keypair_path)?;
    let proposal = match &args.command {
        ProposeCommand::Raw(raw_args) => propose_raw_transaction(config, &identity, raw_args)?,
        ProposeCommand::Transfer(transfer_args) => match &transfer_args.command {
            TransferCommand::Sol(sol_args) => propose_sol_transfer(config, &identity, sol_args)?,
            TransferCommand::Token(token_args) => {
                propose_token_transfer(config, &identity, token_args)?
            }
        },
    };

    let payload = ProposeOutput { proposal };

    match output {
        OutputFormat::Display => {
            println!("Signature: {}", payload.proposal.signature);
            println!("Proposal: {}", payload.proposal.proposal_pda);
            println!("Transaction: {}", payload.proposal.transaction_pda);
            println!("Settings PDA: {}", payload.proposal.settings_pda);
            println!("Policy PDA: {}", payload.proposal.policy_pda);
            println!("Transaction Index: {}", payload.proposal.transaction_index);
        }
        OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&payload)?),
        OutputFormat::JsonCompact => println!("{}", serde_json::to_string(&payload)?),
    }

    Ok(())
}

fn open_url(url: &str) -> Result<()> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(url);
        command
    };

    #[cfg(target_os = "linux")]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(url);
        command
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("cmd");
        command.args(["/C", "start", "", url]);
        command
    };

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        let _ = url;
        bail!("automatic browser opening is unsupported on this platform");
    }

    #[cfg(any(target_os = "macos", target_os = "linux", target_os = "windows"))]
    {
        let status = command.status().context("failed to spawn browser opener")?;
        if !status.success() {
            bail!("browser opener exited with {status}");
        }
        Ok(())
    }
}

fn identity_output(identity: ReadyIdentity) -> IdentityOutput {
    IdentityOutput {
        status: "ready",
        keypair_path: identity.keypair_path,
        exists: true,
        pubkey: Some(identity.pubkey),
        error: None,
    }
}

fn identity_state_output(identity: IdentityState) -> IdentityOutput {
    match identity {
        IdentityState::Ready(identity) => identity_output(identity),
        IdentityState::Missing { keypair_path } => IdentityOutput {
            status: "missing",
            keypair_path,
            exists: false,
            pubkey: None,
            error: None,
        },
        IdentityState::Unreadable {
            keypair_path,
            error,
        } => IdentityOutput {
            status: "unreadable",
            keypair_path,
            exists: true,
            pubkey: None,
            error: Some(error),
        },
    }
}

fn yes_no(value: bool) -> &'static str {
    if value {
        "yes"
    } else {
        "no"
    }
}
