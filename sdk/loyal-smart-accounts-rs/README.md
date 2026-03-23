# loyal-smart-accounts-rs

Parity-first Rust SDK for the Squads Smart Account program, maintained in Loyal's monorepo.

This crate intentionally exports only the behavior-complete surface:

- `smart_accounts::instructions::create`
- `smart_accounts::prepare::create`
- `client.smart_accounts().create(...)`
- protocol-level helpers in `pda`, `types`, and `PreparedOperation`

The generated Rust sources, operation spec, vendored IDL, and golden parity fixtures are synced by:

```bash
bun run loyal-smart-accounts:update
```

Quick start:

```rust
use std::sync::Arc;

use loyal_smart_accounts_rs::{
    create_loyal_smart_accounts_client,
    smart_accounts::CreateSmartAccountRequest,
    types::{Permissions, SmartAccountSigner},
    LoyalSmartAccountsClientConfig,
};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::{pubkey::Pubkey, signature::Keypair};

let creator = Keypair::new();
let rpc = Arc::new(RpcClient::new("https://api.devnet.solana.com".into()));
let client = create_loyal_smart_accounts_client(LoyalSmartAccountsClientConfig {
    rpc,
    program_id: None,
    default_commitment: None,
    sender: None,
    confirmer: None,
});

let request = CreateSmartAccountRequest {
    treasury: Pubkey::new_unique(),
    creator: creator.pubkey(),
    settings: None,
    settings_authority: None,
    threshold: 1,
    signers: vec![SmartAccountSigner {
        key: creator.pubkey(),
        permissions: Permissions::all(),
    }],
    time_lock: 0,
    rent_collector: None,
    memo: None,
    program_id: None,
    remaining_accounts: vec![],
};

let _signature = client.smart_accounts().create(request, &creator).await?;
# Ok::<(), Box<dyn std::error::Error>>(())
```
