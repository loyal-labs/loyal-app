use anyhow::{anyhow, bail, Context, Result};
use log::{debug, warn};
use reqwest::blocking::Client as HttpClient;
use solana_client::rpc_client::RpcClient;
use solana_commitment_config::CommitmentConfig;
use solana_sdk::{pubkey::Pubkey, signature::read_keypair_file, signer::Signer};
use std::{env, fs, str::FromStr, time::Duration};

use crate::{
    auth::{get_auth_token, verify_tee_rpc_integrity},
    cli::{Cli, TargetArgs},
    constants::{
        DEFAULT_PER_RPC_DEVNET, DEFAULT_PER_RPC_MAINNET, DEFAULT_ROUTER_RPC_DEVNET,
        DEFAULT_ROUTER_RPC_MAINNET, ER_VALIDATOR_DEVNET_STR, ER_VALIDATOR_MAINNET_STR,
    },
    pda::{find_deposit_pda, find_username_deposit_pda, validate_username},
    types::{AppContext, ResolvedSolanaConfig, SolanaCliConfigFile, Target},
};

pub(crate) fn init_logging(cli: &Cli) {
    if cli.debug && env::var("RUST_LOG").is_err() {
        env::set_var("RUST_LOG", "debug");
    }

    let env = env_logger::Env::default().filter_or("RUST_LOG", "warn");
    let _ = env_logger::Builder::from_env(env)
        .format_timestamp_millis()
        .try_init();
}

pub(crate) fn build_context(cli: &Cli) -> Result<AppContext> {
    let solana_cfg = resolve_solana_config(cli)?;
    let commitment = parse_commitment(&solana_cfg.commitment)?;
    debug!(
        "resolved solana config: config_path={}, rpc_url={}, ws_url={}, keypair_path={}, commitment={}",
        solana_cfg.config_path,
        solana_cfg.rpc_url,
        solana_cfg.websocket_url,
        solana_cfg.keypair_path,
        solana_cfg.commitment
    );

    let keypair_path = expand_tilde(&solana_cfg.keypair_path);
    let signer = read_keypair_file(&keypair_path)
        .map_err(|e| anyhow!("failed to read keypair {}: {e}", keypair_path))?;
    let signer_pubkey = signer.pubkey();
    debug!("loaded signer pubkey={signer_pubkey}");

    let http_client = HttpClient::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .context("failed to build HTTP client")?;

    let default_per_rpc = if solana_cfg.rpc_url.contains("mainnet") {
        DEFAULT_PER_RPC_MAINNET
    } else {
        DEFAULT_PER_RPC_DEVNET
    };
    let per_rpc_resolved = cli
        .per_rpc
        .clone()
        .unwrap_or_else(|| default_per_rpc.to_string());
    let default_router_rpc = if per_rpc_resolved.contains("mainnet-tee") {
        DEFAULT_ROUTER_RPC_MAINNET
    } else {
        DEFAULT_ROUTER_RPC_DEVNET
    };
    let router_url = cli
        .router_url
        .clone()
        .unwrap_or_else(|| default_router_rpc.to_string());
    let validator_str = cli.validator.clone().unwrap_or_else(|| {
        if per_rpc_resolved.contains("mainnet-tee") {
            ER_VALIDATOR_MAINNET_STR.to_string()
        } else {
            ER_VALIDATOR_DEVNET_STR.to_string()
        }
    });
    let mut per_rpc_url = per_rpc_resolved.clone();
    let mut per_ws_url = cli
        .per_ws
        .clone()
        .unwrap_or_else(|| derive_ws_url(&per_rpc_resolved));
    debug!(
        "starting PER config: per_rpc={}, per_ws={}, router_url={}, validator={}",
        per_rpc_url, per_ws_url, router_url, validator_str
    );

    let has_inline_token = per_rpc_url.contains("token=") || per_ws_url.contains("token=");

    if !has_inline_token {
        let token = if let Some(token) = &cli.per_auth_token {
            Some(token.clone())
        } else if per_rpc_url.contains("tee") {
            // Best-effort integrity probe first, then auth token flow.
            let integrity_ok =
                verify_tee_rpc_integrity(&http_client, &per_rpc_url).unwrap_or(false);
            if !integrity_ok {
                warn!("TEE integrity probe did not verify successfully");
            }
            Some(get_auth_token(&http_client, &per_rpc_url, &signer)?)
        } else {
            None
        };

        if let Some(token) = token {
            per_rpc_url = append_query_token(&per_rpc_url, &token);
            per_ws_url = append_query_token(&per_ws_url, &token);
        }
    }

    let base_client = RpcClient::new_with_commitment(solana_cfg.rpc_url.clone(), commitment);
    let per_client = RpcClient::new_with_commitment(per_rpc_url.clone(), commitment);
    debug!(
        "rpc clients initialized: base_rpc={}, per_rpc={}, per_ws={}",
        solana_cfg.rpc_url, per_rpc_url, per_ws_url
    );

    let validator = parse_pubkey(&validator_str, "validator")?;
    let inferred_validator = if per_rpc_resolved.contains("mainnet-tee") {
        ER_VALIDATOR_MAINNET_STR
    } else {
        ER_VALIDATOR_DEVNET_STR
    };
    if validator.to_string() != inferred_validator {
        warn!(
            "validator {} does not match inferred validator {} for PER endpoint {}",
            validator, inferred_validator, per_rpc_resolved
        );
    }

    Ok(AppContext {
        base_client,
        per_client,
        http_client,
        signer,
        signer_pubkey,
        output: cli.output,
        solana_config: solana_cfg,
        per_rpc_url,
        per_ws_url,
        router_url,
        commitment,
        validator,
        simulate: cli.simulate || cli.simulate_only,
        simulate_only: cli.simulate_only,
    })
}

fn resolve_solana_config(cli: &Cli) -> Result<ResolvedSolanaConfig> {
    let config_path = cli
        .config
        .clone()
        .or_else(|| std::env::var("SOLANA_CONFIG").ok())
        .unwrap_or_else(default_solana_config_path);

    let expanded_config_path = expand_tilde(&config_path);
    let parsed_cfg = match fs::read_to_string(&expanded_config_path) {
        Ok(contents) => serde_yaml::from_str::<SolanaCliConfigFile>(&contents)
            .with_context(|| format!("failed to parse {}", expanded_config_path))?,
        Err(_) => SolanaCliConfigFile::default(),
    };

    let rpc_url = cli
        .url
        .clone()
        .or(parsed_cfg.json_rpc_url)
        .unwrap_or_else(|| "https://api.devnet.solana.com".to_string());

    let websocket_url = cli
        .ws
        .clone()
        .or(parsed_cfg.websocket_url)
        .unwrap_or_else(|| derive_ws_url(&rpc_url));

    let keypair_path = cli
        .keypair
        .clone()
        .or(parsed_cfg.keypair_path)
        .unwrap_or_else(default_keypair_path);

    let commitment = cli
        .commitment
        .clone()
        .or(parsed_cfg.commitment)
        .unwrap_or_else(|| "confirmed".to_string());

    Ok(ResolvedSolanaConfig {
        config_path: expanded_config_path,
        rpc_url,
        websocket_url,
        keypair_path,
        commitment,
    })
}

pub(crate) fn resolve_target(args: &TargetArgs, signer_pubkey: Pubkey) -> Result<Target> {
    let mint = parse_pubkey(&args.mint, "mint")?;
    debug!(
        "resolving target: mint={}, user_arg={:?}, username_arg={:?}, signer={}",
        mint, args.user, args.username, signer_pubkey
    );

    if let Some(username) = &args.username {
        validate_username(username)?;
        let deposit = find_username_deposit_pda(username, &mint);
        debug!(
            "resolved username deposit target: username={}, deposit={}",
            username, deposit
        );
        return Ok(Target::UsernameDeposit {
            username: username.clone(),
            mint,
            deposit,
        });
    }

    let user = match &args.user {
        Some(value) => parse_pubkey(value, "user")?,
        None => signer_pubkey,
    };
    let deposit = find_deposit_pda(&user, &mint);
    debug!(
        "resolved deposit target: user={}, deposit={}",
        user, deposit
    );

    Ok(Target::Deposit {
        user,
        mint,
        deposit,
    })
}

pub(crate) fn parse_pubkey(value: &str, field: &str) -> Result<Pubkey> {
    Pubkey::from_str(value).with_context(|| format!("invalid {field} pubkey: {value}"))
}

fn parse_commitment(value: &str) -> Result<CommitmentConfig> {
    match value {
        "processed" => Ok(CommitmentConfig::processed()),
        "confirmed" => Ok(CommitmentConfig::confirmed()),
        "finalized" => Ok(CommitmentConfig::finalized()),
        other => bail!("unsupported commitment '{other}', use processed|confirmed|finalized"),
    }
}

fn derive_ws_url(rpc_url: &str) -> String {
    if let Some(rest) = rpc_url.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = rpc_url.strip_prefix("http://") {
        format!("ws://{rest}")
    } else {
        rpc_url.to_string()
    }
}

fn append_query_token(url: &str, token: &str) -> String {
    if url.contains("?token=") || url.contains("&token=") {
        return url.to_string();
    }
    if url.contains('?') {
        format!("{url}&token={token}")
    } else {
        format!("{url}?token={token}")
    }
}

fn default_solana_config_path() -> String {
    let home = dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "~".to_string());
    format!("{home}/.config/solana/cli/config.yml")
}

fn default_keypair_path() -> String {
    let home = dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "~".to_string());
    format!("{home}/.config/solana/id.json")
}

fn expand_tilde(path: &str) -> String {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest).to_string_lossy().to_string();
        }
    }
    path.to_string()
}
