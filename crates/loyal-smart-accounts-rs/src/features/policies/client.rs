use loyal_smart_accounts_rs_core::transport::LoyalSmartAccountsTransport;

pub struct PoliciesClient<'a> {
    transport: &'a LoyalSmartAccountsTransport,
}

impl<'a> PoliciesClient<'a> {
    pub(crate) fn new(transport: &'a LoyalSmartAccountsTransport) -> Self {
        Self { transport }
    }

    pub fn transport(&self) -> &'a LoyalSmartAccountsTransport {
        self.transport
    }
}
