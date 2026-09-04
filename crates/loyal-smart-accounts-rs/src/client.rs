use crate::features::smart_accounts::client::SmartAccountsClient;
use crate::transport::{LoyalSmartAccountsClientConfig, LoyalSmartAccountsTransport};

#[derive(Clone)]
pub struct LoyalSmartAccountsClient {
    transport: LoyalSmartAccountsTransport,
}

pub fn create_loyal_smart_accounts_client(
    config: LoyalSmartAccountsClientConfig,
) -> LoyalSmartAccountsClient {
    LoyalSmartAccountsClient {
        transport: LoyalSmartAccountsTransport::new(config),
    }
}

impl LoyalSmartAccountsClient {
    pub fn smart_accounts(&self) -> SmartAccountsClient<'_> {
        SmartAccountsClient::new(&self.transport)
    }
}
