use loyal_smart_accounts_rs_core::transport::LoyalSmartAccountsTransport;

pub struct ProposalsClient<'a> {
    transport: &'a LoyalSmartAccountsTransport,
}

impl<'a> ProposalsClient<'a> {
    pub(crate) fn new(transport: &'a LoyalSmartAccountsTransport) -> Self {
        Self { transport }
    }

    pub fn transport(&self) -> &'a LoyalSmartAccountsTransport {
        self.transport
    }
}
