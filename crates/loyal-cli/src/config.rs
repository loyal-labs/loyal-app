use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use solana_commitment_config::CommitmentConfig;
use std::{env, fs, path::PathBuf};
use url::Url;

use crate::cli::Cli;

const DEFAULT_WEB_URL: &str = "https://askloyal.com/app";
pub(crate) const DEFAULT_RPC_URL: &str = "https://api.mainnet-beta.solana.com";
pub(crate) const DEFAULT_SMART_ACCOUNTS_PROGRAM_ID: &str =
    "SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG";

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub(crate) struct LoyalCliConfigFile {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) web_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) json_rpc_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) websocket_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) keypair_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) commitment: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) program_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) settings_pda: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) policy_pda: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) account_index: Option<u8>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct SolanaCliConfigFile {
    json_rpc_url: Option<String>,
    websocket_url: Option<String>,
    commitment: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct ResolvedConfig {
    pub(crate) config_path: PathBuf,
    pub(crate) web_url: String,
    pub(crate) rpc_url: String,
    pub(crate) ws_url: Option<String>,
    pub(crate) keypair_path: PathBuf,
    pub(crate) commitment: CommitmentConfig,
    pub(crate) program_id: String,
    pub(crate) settings_pda: Option<String>,
    pub(crate) policy_pda: Option<String>,
    pub(crate) account_index: Option<u8>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SavedConnection {
    pub(crate) settings_pda: String,
    pub(crate) policy_pda: String,
    pub(crate) account_index: Option<u8>,
}

pub(crate) fn resolve_config(cli: &Cli) -> Result<ResolvedConfig> {
    let config_path = resolve_config_path(cli.config.as_deref())?;
    let parsed = read_config_file(&config_path)?;
    let solana_config = read_solana_config_file()?;

    let web_url = normalize_optional_url(cli.url.clone())
        .or_else(|| normalize_optional_url(env::var("LOYAL_URL").ok()))
        .or_else(|| normalize_optional_url(env::var("LOYAL_BASE_URL").ok()))
        .or_else(|| normalize_optional_url(parsed.web_url))
        .unwrap_or_else(|| DEFAULT_WEB_URL.to_string());

    let rpc_url = normalize_optional_url(cli.rpc_url.clone())
        .or_else(|| normalize_optional_url(env::var("LOYAL_RPC_URL").ok()))
        .or_else(|| normalize_optional_url(env::var("RPC_URL").ok()))
        .or_else(|| normalize_optional_url(parsed.json_rpc_url))
        .or_else(|| normalize_optional_url(solana_config.json_rpc_url))
        .unwrap_or_else(|| DEFAULT_RPC_URL.to_string());

    let ws_url = normalize_optional_url(cli.ws_url.clone())
        .or_else(|| normalize_optional_url(env::var("LOYAL_WS_URL").ok()))
        .or_else(|| normalize_optional_url(parsed.websocket_url))
        .or_else(|| normalize_optional_url(solana_config.websocket_url));

    let keypair_path = cli
        .keypair
        .clone()
        .or_else(|| env::var("LOYAL_KEYPAIR").ok())
        .or(parsed.keypair_path)
        .map(|path| expand_tilde(&path))
        .unwrap_or_else(default_keypair_path);

    let commitment = cli
        .commitment
        .clone()
        .or_else(|| env::var("LOYAL_COMMITMENT").ok())
        .or(solana_config.commitment)
        .unwrap_or_else(|| "confirmed".to_string());

    let program_id = cli
        .smart_accounts_program_id
        .clone()
        .or_else(|| env::var("LOYAL_SMART_ACCOUNTS_PROGRAM_ID").ok())
        .unwrap_or_else(|| DEFAULT_SMART_ACCOUNTS_PROGRAM_ID.to_string());

    let settings_pda = cli
        .settings_pda
        .clone()
        .or_else(|| env::var("LOYAL_SETTINGS_PDA").ok())
        .or(parsed.settings_pda);

    let policy_pda = cli
        .policy_pda
        .clone()
        .or_else(|| env::var("LOYAL_POLICY_PDA").ok())
        .or(parsed.policy_pda);

    Ok(ResolvedConfig {
        config_path,
        web_url: normalize_web_url(&web_url),
        rpc_url,
        ws_url,
        keypair_path,
        commitment: parse_commitment(&commitment)?,
        program_id,
        settings_pda,
        policy_pda,
        account_index: parsed.account_index,
    })
}

pub(crate) fn save_connection(config: &ResolvedConfig, connection: &SavedConnection) -> Result<()> {
    let mut file = read_config_file(&config.config_path)?;
    file.web_url = None;
    file.json_rpc_url = None;
    file.websocket_url = None;
    file.keypair_path = Some(config.keypair_path.display().to_string());
    file.commitment = None;
    file.program_id = None;
    file.settings_pda = Some(connection.settings_pda.clone());
    file.policy_pda = Some(connection.policy_pda.clone());
    file.account_index = connection.account_index.or(config.account_index);

    if let Some(parent) = config.config_path.parent() {
        fs::create_dir_all(parent).with_context(|| {
            format!(
                "failed to create Loyal config directory {}",
                parent.display()
            )
        })?;
    }

    fs::write(&config.config_path, serde_yaml::to_string(&file)?).with_context(|| {
        format!(
            "failed to write Loyal config file {}",
            config.config_path.display()
        )
    })?;

    Ok(())
}

pub(crate) fn connect_url(base_url: &str, pubkey: &str) -> String {
    let normalized_base_url = base_url.trim_end_matches('/');

    if let Ok(mut url) = Url::parse(normalized_base_url) {
        url.query_pairs_mut().append_pair("connect", pubkey);
        return url.to_string();
    }

    let separator = if normalized_base_url.contains('?') {
        "&"
    } else {
        "?"
    };
    format!(
        "{}{}connect={}",
        normalized_base_url,
        separator,
        urlencoding::encode(pubkey)
    )
}

pub(crate) fn websocket_url_from_rpc(rpc_url: &str) -> String {
    if rpc_url.starts_with("wss://") || rpc_url.starts_with("ws://") {
        return rpc_url.to_string();
    }
    if let Some(rest) = rpc_url.strip_prefix("https://") {
        return format!("wss://{rest}");
    }
    if let Some(rest) = rpc_url.strip_prefix("http://") {
        return format!("ws://{rest}");
    }
    rpc_url.to_string()
}

fn read_config_file(path: &PathBuf) -> Result<LoyalCliConfigFile> {
    match fs::read_to_string(path) {
        Ok(contents) => serde_yaml::from_str(&contents)
            .with_context(|| format!("failed to parse Loyal config {}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(LoyalCliConfigFile::default())
        }
        Err(error) => {
            Err(error).with_context(|| format!("failed to read Loyal config {}", path.display()))
        }
    }
}

fn read_solana_config_file() -> Result<SolanaCliConfigFile> {
    let path = resolve_solana_config_path()?;
    match fs::read_to_string(&path) {
        Ok(contents) => serde_yaml::from_str(&contents)
            .with_context(|| format!("failed to parse Solana config {}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(SolanaCliConfigFile::default())
        }
        Err(error) => {
            Err(error).with_context(|| format!("failed to read Solana config {}", path.display()))
        }
    }
}

fn resolve_solana_config_path() -> Result<PathBuf> {
    if let Ok(path) = env::var("SOLANA_CONFIG") {
        return Ok(expand_tilde(&path));
    }

    let home = dirs::home_dir()
        .ok_or_else(|| anyhow!("Unable to determine home directory for Solana config"))?;
    Ok(home
        .join(".config")
        .join("solana")
        .join("cli")
        .join("config.yml"))
}

fn resolve_config_path(cli_config: Option<&str>) -> Result<PathBuf> {
    if let Some(path) = cli_config {
        return Ok(expand_tilde(path));
    }

    if let Ok(path) = env::var("LOYAL_CONFIG") {
        return Ok(expand_tilde(&path));
    }

    Ok(default_loyal_config_dir()?.join("cli").join("config.yml"))
}

fn default_keypair_path() -> PathBuf {
    default_loyal_config_dir()
        .unwrap_or_else(|_| PathBuf::from(".loyal"))
        .join("id.json")
}

fn default_loyal_config_dir() -> Result<PathBuf> {
    let home = dirs::home_dir()
        .ok_or_else(|| anyhow!("Unable to determine home directory for Loyal config"))?;
    Ok(home.join(".config").join("loyal"))
}

fn expand_tilde(path: &str) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }

    PathBuf::from(path)
}

fn normalize_web_url(value: &str) -> String {
    value.trim_end_matches('/').to_string()
}

fn normalize_optional_url(value: Option<String>) -> Option<String> {
    value.and_then(|url| {
        let trimmed = url.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn parse_commitment(value: &str) -> Result<CommitmentConfig> {
    match value {
        "processed" => Ok(CommitmentConfig::processed()),
        "confirmed" => Ok(CommitmentConfig::confirmed()),
        "finalized" => Ok(CommitmentConfig::finalized()),
        other => {
            anyhow::bail!("unsupported commitment '{other}', use processed|confirmed|finalized")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{connect_url, normalize_optional_url, websocket_url_from_rpc};

    #[test]
    fn connect_url_preserves_path_prefix() {
        assert_eq!(
            connect_url("http://localhost:3000/app", "agent-pubkey"),
            "http://localhost:3000/app?connect=agent-pubkey"
        );
    }

    #[test]
    fn connect_url_handles_root_frontend_url() {
        assert_eq!(
            connect_url("http://localhost:3000", "agent-pubkey"),
            "http://localhost:3000/?connect=agent-pubkey"
        );
    }

    #[test]
    fn connect_url_appends_to_existing_query() {
        assert_eq!(
            connect_url("https://askloyal.com/app?source=cli", "agent pubkey"),
            "https://askloyal.com/app?source=cli&connect=agent+pubkey"
        );
    }

    #[test]
    fn normalize_optional_url_discards_empty_values() {
        assert_eq!(normalize_optional_url(None), None);
        assert_eq!(normalize_optional_url(Some(String::new())), None);
        assert_eq!(normalize_optional_url(Some("  \t\n".to_string())), None);
    }

    #[test]
    fn normalize_optional_url_trims_non_empty_values() {
        assert_eq!(
            normalize_optional_url(Some("  wss://api.mainnet-beta.solana.com/  ".to_string())),
            Some("wss://api.mainnet-beta.solana.com/".to_string())
        );
    }

    #[test]
    fn empty_optional_ws_url_falls_back_to_rpc_websocket_url() {
        let ws_url = normalize_optional_url(Some(String::new()))
            .unwrap_or_else(|| websocket_url_from_rpc("https://api.mainnet-beta.solana.com"));

        assert_eq!(ws_url, "wss://api.mainnet-beta.solana.com");
    }
}
