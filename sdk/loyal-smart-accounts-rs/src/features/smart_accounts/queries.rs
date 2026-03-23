use anchor_lang::AccountDeserialize;
use loyal_smart_accounts_rs_core::accounts::{Settings, SettingsTransaction};
use loyal_smart_accounts_rs_core::errors::LoyalSmartAccountsError;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;

pub fn module_name() -> &'static str {
    "smart_accounts"
}

pub async fn fetch_settings(
    rpc: &RpcClient,
    address: Pubkey,
) -> Result<Settings, LoyalSmartAccountsError> {
    let account = rpc
        .get_account(&address)
        .await
        .map_err(|error| LoyalSmartAccountsError::Rpc(error.to_string()))?;
    let mut data = account.data.as_slice();
    Settings::try_deserialize(&mut data)
        .map_err(|error| LoyalSmartAccountsError::Rpc(error.to_string()))
}

pub async fn fetch_settings_transaction(
    rpc: &RpcClient,
    address: Pubkey,
) -> Result<SettingsTransaction, LoyalSmartAccountsError> {
    let account = rpc
        .get_account(&address)
        .await
        .map_err(|error| LoyalSmartAccountsError::Rpc(error.to_string()))?;
    let mut data = account.data.as_slice();
    SettingsTransaction::try_deserialize(&mut data)
        .map_err(|error| LoyalSmartAccountsError::Rpc(error.to_string()))
}
