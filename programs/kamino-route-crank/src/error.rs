use anchor_lang::prelude::*;

#[error_code]
pub enum KaminoRouteCrankError {
    #[msg("Policy payload is too large")]
    PolicyPayloadTooLarge,
    #[msg("Invalid policy payload")]
    InvalidPolicyPayload,
}
