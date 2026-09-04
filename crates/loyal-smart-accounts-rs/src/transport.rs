use std::collections::BTreeMap;
use std::marker::PhantomData;
use std::sync::Arc;

use async_trait::async_trait;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::commitment_config::CommitmentConfig;
use solana_sdk::hash::Hash;
use solana_sdk::instruction::Instruction;
use solana_sdk::message::v0;
use solana_sdk::message::{AddressLookupTableAccount, VersionedMessage};
use solana_sdk::signature::Signature;
use solana_sdk::signer::Signer;
use solana_sdk::transaction::VersionedTransaction;

use crate::errors::LoyalSmartAccountsError;
use crate::generated::constants::PROGRAM_ID;
use crate::operation_spec::OperationSpec;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfirmBehavior {
    Always,
    Never,
    IfRequired,
}

impl Default for ConfirmBehavior {
    fn default() -> Self {
        Self::IfRequired
    }
}

#[derive(Debug, Clone)]
pub struct PreparedOperation<O: OperationSpec> {
    pub payer: solana_sdk::pubkey::Pubkey,
    pub program_id: solana_sdk::pubkey::Pubkey,
    pub instructions: Vec<Instruction>,
    pub address_lookup_table_accounts: Vec<AddressLookupTableAccount>,
    _marker: PhantomData<O>,
}

impl<O: OperationSpec> PreparedOperation<O> {
    pub fn new(
        payer: solana_sdk::pubkey::Pubkey,
        program_id: solana_sdk::pubkey::Pubkey,
        instructions: Vec<Instruction>,
        address_lookup_table_accounts: Vec<AddressLookupTableAccount>,
    ) -> Self {
        Self {
            payer,
            program_id,
            instructions,
            address_lookup_table_accounts,
            _marker: PhantomData,
        }
    }

    pub fn operation_name(&self) -> &'static str {
        O::EXPORTED_NAME
    }

    pub fn operation_spec_name(&self) -> &'static str {
        O::NAME
    }

    pub fn requires_confirmation(&self) -> bool {
        O::REQUIRES_CONFIRMATION
    }
}

#[derive(Clone)]
pub struct LoyalSmartAccountsClientConfig {
    pub rpc: Arc<RpcClient>,
    pub program_id: Option<solana_sdk::pubkey::Pubkey>,
    pub default_commitment: Option<CommitmentConfig>,
    pub sender: Option<Arc<dyn PreparedOperationSender>>,
    pub confirmer: Option<Arc<dyn PreparedOperationConfirmer>>,
}

#[derive(Clone)]
pub(crate) struct LoyalSmartAccountsTransport {
    rpc: Arc<RpcClient>,
    program_id: solana_sdk::pubkey::Pubkey,
    default_commitment: Option<CommitmentConfig>,
    sender: Option<Arc<dyn PreparedOperationSender>>,
    confirmer: Option<Arc<dyn PreparedOperationConfirmer>>,
}

pub struct ConfirmContext {
    pub operation_name: &'static str,
    pub payer: solana_sdk::pubkey::Pubkey,
    pub program_id: solana_sdk::pubkey::Pubkey,
    pub requires_confirmation: bool,
    pub blockhash: Hash,
}

pub struct SendPreparedContext {
    pub blockhash: Hash,
    pub commitment: Option<CommitmentConfig>,
    pub transaction: VersionedTransaction,
}

#[async_trait]
pub trait PreparedOperationSender: Send + Sync {
    async fn send_prepared(
        &self,
        context: SendPreparedContext,
    ) -> Result<Signature, LoyalSmartAccountsError>;
}

#[async_trait]
pub trait PreparedOperationConfirmer: Send + Sync {
    async fn confirm(
        &self,
        signature: &Signature,
        context: ConfirmContext,
    ) -> Result<(), LoyalSmartAccountsError>;
}

impl LoyalSmartAccountsTransport {
    pub(crate) fn new(config: LoyalSmartAccountsClientConfig) -> Self {
        Self {
            rpc: config.rpc,
            program_id: config.program_id.unwrap_or(PROGRAM_ID),
            default_commitment: config.default_commitment,
            sender: config.sender,
            confirmer: config.confirmer,
        }
    }

    pub(crate) fn program_id(&self) -> solana_sdk::pubkey::Pubkey {
        self.program_id
    }

    pub(crate) async fn execute<O: OperationSpec + Send + Sync>(
        &self,
        prepared: &PreparedOperation<O>,
        signers: &[&dyn Signer],
        confirm: ConfirmBehavior,
    ) -> Result<Signature, LoyalSmartAccountsError> {
        let latest_blockhash = self
            .rpc
            .get_latest_blockhash()
            .await
            .map_err(|error| LoyalSmartAccountsError::Rpc(error.to_string()))?;

        let transaction = self.compile_and_sign(prepared, latest_blockhash, signers)?;

        let signature = if let Some(sender) = &self.sender {
            sender
                .send_prepared(SendPreparedContext {
                    blockhash: latest_blockhash,
                    commitment: self.default_commitment,
                    transaction,
                })
                .await?
        } else {
            self.rpc
                .send_transaction(&transaction)
                .await
                .map_err(|error| LoyalSmartAccountsError::Rpc(error.to_string()))?
        };

        let should_confirm = match confirm {
            ConfirmBehavior::Always => true,
            ConfirmBehavior::Never => false,
            ConfirmBehavior::IfRequired => prepared.requires_confirmation(),
        };

        if should_confirm {
            if let Some(confirmer) = &self.confirmer {
                confirmer
                    .confirm(
                        &signature,
                        ConfirmContext {
                            operation_name: prepared.operation_name(),
                            payer: prepared.payer,
                            program_id: prepared.program_id,
                            requires_confirmation: prepared.requires_confirmation(),
                            blockhash: latest_blockhash,
                        },
                    )
                    .await?;
            } else {
                self.rpc
                    .confirm_transaction(&signature)
                    .await
                    .map_err(|error| LoyalSmartAccountsError::Rpc(error.to_string()))?;
            }
        }

        Ok(signature)
    }

    fn compile_and_sign<O: OperationSpec>(
        &self,
        prepared: &PreparedOperation<O>,
        blockhash: Hash,
        signers: &[&dyn Signer],
    ) -> Result<VersionedTransaction, LoyalSmartAccountsError> {
        let message = v0::Message::try_compile(
            &prepared.payer,
            &prepared.instructions,
            &prepared.address_lookup_table_accounts,
            blockhash,
        )
        .map_err(|error| LoyalSmartAccountsError::Rpc(error.to_string()))?;

        let signer_refs = dedupe_signers(signers);

        VersionedTransaction::try_new(VersionedMessage::V0(message), &signer_refs)
            .map_err(|error| LoyalSmartAccountsError::Rpc(error.to_string()))
    }
}

fn dedupe_signers<'a>(signers: &'a [&'a dyn Signer]) -> Vec<&'a dyn Signer> {
    let mut unique = BTreeMap::new();
    for signer in signers {
        unique.insert(signer.pubkey(), *signer);
    }
    unique.into_values().collect()
}

#[cfg(test)]
mod tests {
    use super::dedupe_signers;
    use solana_sdk::signature::Keypair;
    use solana_sdk::signer::Signer;

    #[test]
    fn dedupes_signers_by_pubkey() {
        let signer = Keypair::new();
        let signers = [&signer as &dyn Signer, &signer as &dyn Signer];
        let deduped = dedupe_signers(&signers);
        assert_eq!(deduped.len(), 1);
        assert_eq!(deduped[0].pubkey(), signer.pubkey());
    }
}
