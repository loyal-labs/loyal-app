use thiserror::Error;

#[derive(Debug, Error)]
pub enum LoyalSmartAccountsError {
    #[error("operation `{operation}` requires a signer matching request role `{role}`")]
    MissingRequiredSigner {
        operation: &'static str,
        role: &'static str,
    },
    #[error("operation `{operation}` received signer `{provided}` for role `{role}`, expected `{expected}`")]
    SignerPubkeyMismatch {
        operation: &'static str,
        role: &'static str,
        expected: String,
        provided: String,
    },
    #[error("rpc error: {0}")]
    Rpc(String),
    #[error("serialization error: {0}")]
    Serialization(String),
}
