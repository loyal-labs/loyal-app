use reqwest::blocking::Client as HttpClient;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use solana_client::rpc_client::RpcClient;
use solana_commitment_config::CommitmentConfig;
use solana_sdk::{pubkey::Pubkey, signature::Keypair};

use crate::cli::OutputFormat;

#[derive(Debug, Deserialize, Default)]
pub(crate) struct SolanaCliConfigFile {
    pub(crate) json_rpc_url: Option<String>,
    pub(crate) websocket_url: Option<String>,
    pub(crate) keypair_path: Option<String>,
    pub(crate) commitment: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct ResolvedSolanaConfig {
    pub(crate) config_path: String,
    pub(crate) rpc_url: String,
    pub(crate) websocket_url: String,
    pub(crate) keypair_path: String,
    pub(crate) commitment: String,
}

pub(crate) struct AppContext {
    pub(crate) base_client: RpcClient,
    pub(crate) per_client: RpcClient,
    pub(crate) http_client: HttpClient,
    pub(crate) signer: Keypair,
    pub(crate) signer_pubkey: Pubkey,
    pub(crate) output: OutputFormat,
    pub(crate) solana_config: ResolvedSolanaConfig,
    pub(crate) per_rpc_url: String,
    pub(crate) per_ws_url: String,
    pub(crate) router_url: String,
    pub(crate) commitment: CommitmentConfig,
    pub(crate) validator: Pubkey,
    pub(crate) simulate: bool,
    pub(crate) simulate_only: bool,
}

#[derive(Debug, Clone)]
pub(crate) enum Target {
    Deposit {
        user: Pubkey,
        mint: Pubkey,
        deposit: Pubkey,
    },
    UsernameDeposit {
        username: String,
        mint: Pubkey,
        deposit: Pubkey,
    },
}

#[derive(Debug, Serialize)]
pub(crate) struct DisplayResult {
    pub(crate) target_type: String,
    pub(crate) account: String,
    pub(crate) base_owner: Option<String>,
    pub(crate) per_owner: Option<String>,
    pub(crate) base_amount: Option<u64>,
    pub(crate) per_amount: Option<u64>,
    pub(crate) delegated_on_base: bool,
    pub(crate) delegation_status: Option<DelegationStatusResult>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DelegationRecord {
    pub(crate) authority: String,
    pub(crate) owner: Option<String>,
    pub(crate) delegation_slot: Option<u64>,
    pub(crate) lamports: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DelegationStatusResult {
    pub(crate) is_delegated: bool,
    pub(crate) fqdn: Option<String>,
    pub(crate) delegation_record: Option<DelegationRecord>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct DelegationStatusResponse {
    pub(crate) result: Option<DelegationStatusResult>,
    pub(crate) error: Option<Value>,
}

#[derive(Debug)]
pub(crate) struct DepositAccountData {
    pub(crate) amount: u64,
}

#[derive(Debug)]
pub(crate) struct UsernameDepositAccountData {
    pub(crate) amount: u64,
}

#[derive(Debug, Deserialize, Serialize)]
pub(crate) struct AuthChallengeResponse {
    pub(crate) challenge: Option<String>,
    pub(crate) error: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthLoginResponse {
    pub(crate) token: Option<String>,
    pub(crate) expires_at: Option<i64>,
    pub(crate) error: Option<String>,
}
