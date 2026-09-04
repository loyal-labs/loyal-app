use std::sync::Arc;

use loyal_smart_accounts_rs::smart_accounts::CreateSmartAccountRequest;
use loyal_smart_accounts_rs::types::{Permissions, SmartAccountSigner};
use loyal_smart_accounts_rs::{
    create_loyal_smart_accounts_client, ExportedFeature, LoyalSmartAccountsClientConfig,
    PROGRAM_ID, RUST_EXPORTED_FEATURES, RUST_EXPORTED_OPERATIONS,
};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;

#[test]
fn exports_only_completed_feature_surface() {
    let rpc = Arc::new(RpcClient::new("http://127.0.0.1:8899".into()));
    let client = create_loyal_smart_accounts_client(LoyalSmartAccountsClientConfig {
        rpc,
        program_id: None,
        default_commitment: None,
        sender: None,
        confirmer: None,
    });

    let _ = client.smart_accounts();

    assert_ne!(PROGRAM_ID, Pubkey::default());
    assert_eq!(RUST_EXPORTED_FEATURES, &[ExportedFeature::SmartAccounts]);
    assert_eq!(RUST_EXPORTED_OPERATIONS, &["createSmartAccount"]);
}

#[test]
fn prepares_smart_account_create_operation() {
    let creator = Pubkey::new_unique();
    let request = CreateSmartAccountRequest {
        treasury: Pubkey::new_unique(),
        creator,
        settings: None,
        settings_authority: None,
        threshold: 1,
        signers: vec![SmartAccountSigner {
            key: creator,
            permissions: Permissions::all(),
        }],
        time_lock: 0,
        rent_collector: None,
        memo: None,
        program_id: None,
        remaining_accounts: vec![],
    };

    let prepared = loyal_smart_accounts_rs::smart_accounts::prepare::create(&request, PROGRAM_ID)
        .expect("prepare create should succeed");

    assert_eq!(prepared.operation_name(), "create");
    assert_eq!(prepared.operation_spec_name(), "createSmartAccount");
    assert_eq!(prepared.instructions.len(), 1);
}
