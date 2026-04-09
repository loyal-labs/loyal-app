use anyhow::Result;
use serde::Serialize;

use crate::{
    cli::{InitArgs, OutputFormat, SignMessageArgs},
    identity::{
        identity_guidance, init_identity, inspect_identity, read_identity, sign_message,
        IdentityState, ReadyIdentity, SignedMessage,
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
struct SignedMessageOutput {
    keypair_path: String,
    pubkey: String,
    message: String,
    signature: String,
}

pub(crate) fn cmd_init(
    output: OutputFormat,
    cli_keypair: Option<&str>,
    args: &InitArgs,
) -> Result<()> {
    let identity = init_identity(cli_keypair, args.force)?;
    let payload = identity_output(identity);

    match output {
        OutputFormat::Display => {
            println!("Created dedicated Loyal signer identity.");
            println!("Keypair Path: {}", payload.keypair_path);
            println!(
                "Public Key: {}",
                payload.pubkey.as_deref().unwrap_or_default()
            );
            println!("Next Step: {}", identity_guidance());
        }
        OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&payload)?),
        OutputFormat::JsonCompact => println!("{}", serde_json::to_string(&payload)?),
    }

    Ok(())
}

pub(crate) fn cmd_pubkey(output: OutputFormat, cli_keypair: Option<&str>) -> Result<()> {
    let identity = read_identity(cli_keypair)?;
    let payload = identity_output(identity);

    match output {
        OutputFormat::Display => println!("{}", payload.pubkey.as_deref().unwrap_or_default()),
        OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&payload)?),
        OutputFormat::JsonCompact => println!("{}", serde_json::to_string(&payload)?),
    }

    Ok(())
}

pub(crate) fn cmd_show(output: OutputFormat, cli_keypair: Option<&str>) -> Result<()> {
    let payload = identity_state_output(inspect_identity(cli_keypair)?);

    match output {
        OutputFormat::Display => {
            println!("Dedicated Loyal signer identity");
            println!("Keypair Path: {}", payload.keypair_path);
            println!("Status: {}", payload.status);
            println!("Exists: {}", yes_no(payload.exists));
            if let Some(pubkey) = payload.pubkey.as_deref() {
                println!("Public Key: {}", pubkey);
            }
            if let Some(error) = payload.error.as_deref() {
                println!("Error: {}", error);
            }
            if payload.status == "missing" {
                println!("Hint: Run `loyal-smart-accounts init` to create one.");
            }
        }
        OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&payload)?),
        OutputFormat::JsonCompact => println!("{}", serde_json::to_string(&payload)?),
    }

    Ok(())
}

pub(crate) fn cmd_sign_message(
    output: OutputFormat,
    cli_keypair: Option<&str>,
    args: &SignMessageArgs,
) -> Result<()> {
    let payload = signed_message_output(sign_message(cli_keypair, &args.message)?);

    match output {
        OutputFormat::Display => println!("{}", payload.signature),
        OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&payload)?),
        OutputFormat::JsonCompact => println!("{}", serde_json::to_string(&payload)?),
    }

    Ok(())
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

fn signed_message_output(signed_message: SignedMessage) -> SignedMessageOutput {
    SignedMessageOutput {
        keypair_path: signed_message.keypair_path,
        pubkey: signed_message.pubkey,
        message: signed_message.message,
        signature: signed_message.signature,
    }
}

fn yes_no(value: bool) -> &'static str {
    if value {
        "yes"
    } else {
        "no"
    }
}
