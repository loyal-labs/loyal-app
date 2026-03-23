use crate::errors::LoyalSmartAccountsError;
use crate::operation_spec::CreateSmartAccountOperation;
use crate::transport::PreparedOperation;

use super::instructions::{self, resolve_program_id};
use super::requests::CreateSmartAccountRequest;

pub fn create(
    request: &CreateSmartAccountRequest,
    default_program_id: solana_sdk::pubkey::Pubkey,
) -> Result<PreparedOperation<CreateSmartAccountOperation>, LoyalSmartAccountsError> {
    let program_id = resolve_program_id(request.program_id, default_program_id);
    Ok(PreparedOperation::new(
        request.creator,
        program_id,
        vec![instructions::create(request, default_program_id)?],
        Vec::new(),
    ))
}
