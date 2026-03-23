mod client;
mod errors;
mod generated;
mod operation_spec;
pub mod pda;
mod transport;
pub mod types;

pub mod features;

pub use client::{create_loyal_smart_accounts_client, LoyalSmartAccountsClient};
pub use errors::LoyalSmartAccountsError;
pub use features::smart_accounts;
pub use generated::constants::{PROGRAM_ADDRESS, PROGRAM_ID};
pub use operation_spec::{
    CreateSmartAccountOperation, ExportedFeature, OperationPhase, OperationSpec,
    RUST_EXPORTED_FEATURES, RUST_EXPORTED_OPERATIONS,
};
pub use transport::{
    ConfirmBehavior, LoyalSmartAccountsClientConfig, PreparedOperation, PreparedOperationConfirmer,
    PreparedOperationSender,
};
