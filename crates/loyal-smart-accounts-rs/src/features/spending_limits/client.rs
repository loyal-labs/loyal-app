use loyal_smart_accounts_rs_core::transport::LoyalSmartAccountsTransport;

pub struct SpendingLimitsClient<'a> {
    transport: &'a LoyalSmartAccountsTransport,
}

impl<'a> SpendingLimitsClient<'a> {
    pub(crate) fn new(transport: &'a LoyalSmartAccountsTransport) -> Self {
        Self { transport }
    }

    pub fn transport(&self) -> &'a LoyalSmartAccountsTransport {
        self.transport
    }
}
