use loyal_smart_accounts_rs_core::transport::PreparedOperation;

pub type ProposalsPrepareBuilder = fn() -> PreparedOperation;
