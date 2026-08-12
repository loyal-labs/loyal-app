use solana_sdk::signature::Signature;
use solana_sdk::signer::Signer;

use crate::errors::LoyalSmartAccountsError;
use crate::transport::{ConfirmBehavior, LoyalSmartAccountsTransport};

use super::prepare;
use super::requests::CreateSmartAccountRequest;

pub struct SmartAccountsClient<'a> {
    transport: &'a LoyalSmartAccountsTransport,
}

impl<'a> SmartAccountsClient<'a> {
    pub(crate) fn new(transport: &'a LoyalSmartAccountsTransport) -> Self {
        Self { transport }
    }

    pub async fn create(
        &self,
        request: CreateSmartAccountRequest,
        creator_signer: &dyn Signer,
    ) -> Result<Signature, LoyalSmartAccountsError> {
        if creator_signer.pubkey() != request.creator {
            return Err(LoyalSmartAccountsError::SignerPubkeyMismatch {
                operation: "createSmartAccount",
                role: "creator",
                expected: request.creator.to_string(),
                provided: creator_signer.pubkey().to_string(),
            });
        }

        let prepared = prepare::create(&request, self.transport.program_id())?;

        self.transport
            .execute(&prepared, &[creator_signer], ConfirmBehavior::IfRequired)
            .await
    }
}
