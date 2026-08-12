use solana_sdk::instruction::AccountMeta;
use solana_sdk::pubkey::Pubkey;

use crate::types::SmartAccountSigner;

#[derive(Debug, Clone)]
pub struct CreateSmartAccountRequest {
    pub treasury: Pubkey,
    pub creator: Pubkey,
    pub settings: Option<Pubkey>,
    pub settings_authority: Option<Pubkey>,
    pub threshold: u16,
    pub signers: Vec<SmartAccountSigner>,
    pub time_lock: u32,
    pub rent_collector: Option<Pubkey>,
    pub memo: Option<String>,
    pub program_id: Option<Pubkey>,
    pub remaining_accounts: Vec<AccountMeta>,
}
