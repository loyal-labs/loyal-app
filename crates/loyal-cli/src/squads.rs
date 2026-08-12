use anyhow::{anyhow, bail, Context, Result};
use base64::{engine::general_purpose, Engine as _};
use borsh::BorshSerialize;
use serde::Serialize;
use solana_account_decoder_client_types::UiAccountEncoding;
use solana_address_lookup_table_interface::state::AddressLookupTable;
use solana_client::{
    pubsub_client::{PubsubClient, PubsubProgramClientSubscription},
    rpc_client::RpcClient,
    rpc_config::{RpcAccountInfoConfig, RpcProgramAccountsConfig},
    rpc_filter::{Memcmp, RpcFilterType},
    rpc_response::RpcKeyedAccount,
};
use solana_sdk::{
    account::Account,
    hash::Hash,
    instruction::{AccountMeta, Instruction},
    message::{v0, AddressLookupTableAccount, VersionedMessage},
    pubkey::Pubkey,
    signature::Signature,
    signer::Signer,
    transaction::{Transaction, VersionedTransaction},
};
use std::{
    collections::HashSet,
    io::{self, Write},
    str::FromStr,
    sync::mpsc,
    time::{Duration, Instant},
};

use crate::{
    cli::{AuthArgs, ProposeCommonArgs, RawProposeArgs, SolTransferArgs, TokenTransferArgs},
    config::{websocket_url_from_rpc, ResolvedConfig},
    identity::LoadedIdentity,
    transaction_diagnostics::send_transaction_with_diagnostics,
    transfers::{
        build_sol_spending_limit_payload, build_sol_transfer, build_token_spending_limit_payload,
        build_token_transfer, SpendingLimitTransferPayload,
    },
};

type PolicyUpdateReceiver = mpsc::Receiver<(usize, RpcKeyedAccount)>;

const POLICY_DISCRIMINATOR: [u8; 8] = [222, 135, 7, 163, 235, 177, 33, 68];
const CREATE_TRANSACTION_DISCRIMINATOR: [u8; 8] = [227, 193, 53, 239, 55, 126, 112, 105];
const CREATE_PROPOSAL_DISCRIMINATOR: [u8; 8] = [132, 116, 68, 174, 216, 160, 198, 22];
const POLICY_SIGNER_OFFSET: usize = 69;
const POLICY_SIGNER_SIZE: usize = 33;
const PERMISSION_INITIATE: u8 = 0b0000_0001;
const CONFIRM_POLL_INTERVAL: Duration = Duration::from_millis(500);
const CONFIRM_TIMEOUT: Duration = Duration::from_secs(90);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentConnection {
    pub(crate) signer: String,
    pub(crate) settings_pda: String,
    pub(crate) policy_pda: String,
    pub(crate) program_id: String,
    pub(crate) rpc_url: String,
    pub(crate) ws_url: Option<String>,
    pub(crate) permission_mask: u8,
    pub(crate) can_initiate: bool,
    pub(crate) signer_index: usize,
    pub(crate) account_index: Option<u8>,
    pub(crate) policy_state: String,
    pub(crate) vault_pda: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProposalOutput {
    pub(crate) signature: String,
    pub(crate) program_id: String,
    pub(crate) settings_pda: String,
    pub(crate) policy_pda: String,
    pub(crate) signer: String,
    pub(crate) account_index: u8,
    pub(crate) vault_pda: String,
    pub(crate) transaction_index: String,
    pub(crate) transaction_pda: String,
    pub(crate) proposal_pda: String,
    pub(crate) instruction_count: usize,
    pub(crate) lookup_table_count: usize,
}

#[derive(Debug, Clone)]
struct PolicyAccount {
    address: Pubkey,
    settings: Pubkey,
    transaction_index: u64,
    signers: Vec<PolicySigner>,
    account_index: Option<u8>,
    state: PolicyState,
}

#[derive(Debug, Clone)]
struct PolicySigner {
    key: Pubkey,
    permissions_mask: u8,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum PolicyState {
    InternalFundTransfer,
    SpendingLimit {
        mint: Pubkey,
        destinations: Vec<Pubkey>,
    },
    SettingsChange,
    ProgramInteraction,
    Unknown(u8),
}

impl PolicyState {
    fn as_str(&self) -> &'static str {
        match self {
            Self::InternalFundTransfer => "InternalFundTransfer",
            Self::SpendingLimit { .. } => "SpendingLimit",
            Self::SettingsChange => "SettingsChange",
            Self::ProgramInteraction => "ProgramInteraction",
            Self::Unknown(_) => "Unknown",
        }
    }

    fn is_program_interaction(&self) -> bool {
        matches!(self, Self::ProgramInteraction)
    }

    fn spending_limit(&self) -> Option<(&Pubkey, &[Pubkey])> {
        match self {
            Self::SpendingLimit { mint, destinations } => Some((mint, destinations)),
            _ => None,
        }
    }
}

#[derive(Debug)]
struct DecodedTransaction {
    instructions: Vec<Instruction>,
    address_lookup_table_accounts: Vec<AddressLookupTableAccount>,
}

#[derive(Debug)]
enum ProposalPayload {
    ProgramInteraction(DecodedTransaction),
    SpendingLimit(SpendingLimitTransferPayload),
}

#[derive(BorshSerialize)]
struct SmartAccountTransactionMessageBytes {
    num_signers: u8,
    num_writable_signers: u8,
    num_writable_non_signers: u8,
    account_keys: Vec<[u8; 32]>,
    instructions: Vec<SmartAccountCompiledInstructionBytes>,
    address_table_lookups: Vec<SmartAccountMessageAddressTableLookupBytes>,
}

#[derive(BorshSerialize)]
struct SmartAccountCompiledInstructionBytes {
    program_id_index: u8,
    account_indexes: Vec<u8>,
    data: Vec<u8>,
}

#[derive(BorshSerialize)]
struct SmartAccountMessageAddressTableLookupBytes {
    account_key: [u8; 32],
    writable_indexes: Vec<u8>,
    readonly_indexes: Vec<u8>,
}

#[derive(BorshSerialize)]
enum CreateTransactionArgs {
    #[allow(dead_code)]
    TransactionPayload(TransactionPayload),
    PolicyPayload {
        payload: PolicyPayload,
    },
}

#[derive(BorshSerialize)]
enum PolicyPayload {
    #[allow(dead_code)]
    InternalFundTransfer,
    ProgramInteraction(ProgramInteractionPayload),
    SpendingLimit(SpendingLimitPayload),
    #[allow(dead_code)]
    SettingsChange,
}

#[derive(BorshSerialize)]
struct ProgramInteractionPayload {
    instruction_constraint_indices: Option<Vec<u8>>,
    transaction_payload: ProgramInteractionTransactionPayload,
}

#[derive(BorshSerialize)]
struct SpendingLimitPayload {
    amount: u64,
    destination: [u8; 32],
    decimals: u8,
}

#[derive(BorshSerialize)]
enum ProgramInteractionTransactionPayload {
    AsyncTransaction(TransactionPayload),
}

#[derive(BorshSerialize)]
struct TransactionPayload {
    account_index: u8,
    ephemeral_signers: u8,
    transaction_message: Vec<u8>,
    memo: Option<String>,
}

#[derive(BorshSerialize)]
struct CreateProposalArgs {
    transaction_index: u64,
    draft: bool,
}

pub(crate) fn wait_for_policy_connection(
    config: &ResolvedConfig,
    signer: &Pubkey,
    args: &AuthArgs,
    show_progress: bool,
) -> Result<AgentConnection> {
    validate_index_range(args.from_index, args.to_index)?;

    let program_id = parse_pubkey("program id", &config.program_id)?;
    let settings_filter = parse_optional_pubkey("settings PDA", config.settings_pda.as_deref())?;
    let rpc_client = RpcClient::new_with_commitment(config.rpc_url.clone(), config.commitment);
    let ws_url = config
        .ws_url
        .clone()
        .unwrap_or_else(|| websocket_url_from_rpc(&config.rpc_url));
    let started = Instant::now();

    let (mut subscriptions, mut updates_rx) = start_policy_subscriptions(
        &ws_url,
        &program_id,
        signer,
        args.from_index,
        args.to_index,
        settings_filter.as_ref(),
        config,
    )?;

    let timeout = Duration::from_secs(args.timeout_seconds);
    let mut last_progress = Instant::now();
    let mut progress_frame = 0usize;
    render_wait_progress(
        show_progress,
        progress_frame,
        started,
        signer,
        args.from_index,
        args.to_index,
    )?;

    let existing_connections = existing_policy_connections(
        config,
        &rpc_client,
        &program_id,
        Some(ws_url.clone()),
        signer,
        args.from_index,
        args.to_index,
        settings_filter.as_ref(),
    )?;
    if let Some(connection) = resolve_existing_connection(existing_connections, show_progress)? {
        abandon_subscriptions(&mut subscriptions);
        return Ok(connection);
    }

    loop {
        if started.elapsed() >= timeout {
            abandon_subscriptions(&mut subscriptions);
            finish_wait_progress(show_progress)?;
            bail!(
                "Timed out waiting for {} to be added as an Initiate policy signer",
                signer
            );
        }

        if last_progress.elapsed() >= Duration::from_millis(250) {
            progress_frame = progress_frame.wrapping_add(1);
            last_progress = Instant::now();
            render_wait_progress(
                show_progress,
                progress_frame,
                started,
                signer,
                args.from_index,
                args.to_index,
            )?;
        }

        match updates_rx.recv_timeout(Duration::from_millis(250)) {
            Ok((signer_index, keyed_account)) => {
                if let Some(connection) = connection_from_keyed_account(
                    keyed_account,
                    &program_id,
                    &config.rpc_url,
                    Some(ws_url.clone()),
                    signer,
                    signer_index,
                    settings_filter.as_ref(),
                )? {
                    abandon_subscriptions(&mut subscriptions);
                    return Ok(connection);
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                abandon_subscriptions(&mut subscriptions);
                match start_policy_subscriptions(
                    &ws_url,
                    &program_id,
                    signer,
                    args.from_index,
                    args.to_index,
                    settings_filter.as_ref(),
                    config,
                ) {
                    Ok((next_subscriptions, next_updates_rx)) => {
                        subscriptions = next_subscriptions;
                        updates_rx = next_updates_rx;
                    }
                    Err(error) => {
                        log::warn!(
                            "policy subscription disconnected; waiting before reconnect retry: {error:#}"
                        );
                        std::thread::sleep(Duration::from_millis(500));
                        let (closed_tx, closed_rx) = mpsc::channel();
                        drop(closed_tx);
                        updates_rx = closed_rx;
                    }
                }
            }
        }
    }
}

fn abandon_subscriptions(subscriptions: &mut Vec<PubsubProgramClientSubscription>) {
    for subscription in subscriptions.drain(..) {
        std::mem::forget(subscription);
    }
}

fn start_policy_subscriptions(
    ws_url: &str,
    program_id: &Pubkey,
    signer: &Pubkey,
    from_index: usize,
    to_index: usize,
    settings_filter: Option<&Pubkey>,
    config: &ResolvedConfig,
) -> Result<(Vec<PubsubProgramClientSubscription>, PolicyUpdateReceiver)> {
    let (updates_tx, updates_rx) = mpsc::channel();
    let mut subscriptions = Vec::new();

    for signer_index in from_index..=to_index {
        let subscription_config =
            policy_program_accounts_config(signer, signer_index, settings_filter, config);
        let (subscription, receiver) =
            PubsubClient::program_subscribe(ws_url, program_id, Some(subscription_config))
                .with_context(|| {
                    format!("subscribing to policy signer index {signer_index} via {ws_url}")
                })?;

        let thread_tx = updates_tx.clone();
        std::thread::spawn(move || {
            while let Ok(response) = receiver.recv() {
                if thread_tx.send((signer_index, response.value)).is_err() {
                    break;
                }
            }
        });
        subscriptions.push(subscription);
    }

    drop(updates_tx);
    Ok((subscriptions, updates_rx))
}

fn existing_policy_connections(
    config: &ResolvedConfig,
    client: &RpcClient,
    program_id: &Pubkey,
    ws_url: Option<String>,
    signer: &Pubkey,
    from_index: usize,
    to_index: usize,
    settings_filter: Option<&Pubkey>,
) -> Result<Vec<AgentConnection>> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();

    if let Some(policy_pda) = config
        .policy_pda
        .as_deref()
        .map(|value| parse_pubkey("policy PDA", value))
        .transpose()?
    {
        match client.get_account(&policy_pda) {
            Ok(account) => {
                let policy = parse_policy_account(policy_pda, &account)?;
                if let Some(connection) = connection_from_policy_in_range(
                    &policy,
                    program_id,
                    &config.rpc_url,
                    ws_url.clone(),
                    signer,
                    from_index,
                    to_index,
                    settings_filter,
                )? {
                    seen.insert(policy_pda);
                    out.push(connection);
                }
            }
            Err(error) => {
                log::warn!("failed to fetch saved policy {policy_pda}: {error:#}");
            }
        }
    }

    if out.is_empty() {
        match list_policy_connections(
            client,
            program_id,
            &config.rpc_url,
            ws_url,
            signer,
            from_index,
            to_index,
            settings_filter,
        ) {
            Ok(connections) => {
                for connection in connections {
                    let policy_pda = parse_pubkey("policy PDA", &connection.policy_pda)?;
                    if seen.insert(policy_pda) {
                        out.push(connection);
                    }
                }
            }
            Err(error) => {
                log::warn!("failed to scan existing signer policies: {error:#}");
            }
        }
    }

    Ok(out)
}

fn resolve_existing_connection(
    connections: Vec<AgentConnection>,
    prompt: bool,
) -> Result<Option<AgentConnection>> {
    if connections.is_empty() {
        return Ok(None);
    }

    if !prompt {
        return Ok(connections.into_iter().next());
    }

    finish_wait_progress(true)?;

    let count = connections.len();
    let policy_list = connections
        .iter()
        .map(|connection| connection.policy_pda.as_str())
        .collect::<Vec<_>>()
        .join(", ");
    let prompt_text = if count == 1 {
        format!(
            "Agent is already an Initiate signer for 1 policy: {policy_list}. Use this policy? [Y/n] "
        )
    } else {
        format!(
            "Agent is already an Initiate signer for {count} policies: {policy_list}. Use the first policy? [Y/n] "
        )
    };

    print!("{prompt_text}");
    io::stdout()
        .flush()
        .context("failed to flush existing signer prompt")?;

    let mut answer = String::new();
    io::stdin()
        .read_line(&mut answer)
        .context("failed to read existing signer prompt response")?;

    let answer = answer.trim().to_ascii_lowercase();
    if answer.is_empty() || answer == "y" || answer == "yes" {
        return Ok(connections.into_iter().next());
    }

    println!("Waiting for a new policy approval.");
    Ok(None)
}

fn render_wait_progress(
    show_progress: bool,
    frame_index: usize,
    started: Instant,
    signer: &Pubkey,
    from_index: usize,
    to_index: usize,
) -> Result<()> {
    if !show_progress {
        return Ok(());
    }

    let frames = ['-', '\\', '|', '/'];
    let frame = frames[frame_index % frames.len()];
    let signer = signer.to_string();
    let short_signer = format!("{}...{}", &signer[..4], &signer[signer.len() - 4..]);
    print!(
        "\r{frame} Waiting for policy approval for {short_signer} in slots {from_index}..={to_index} ({}s)",
        started.elapsed().as_secs()
    );
    io::stdout()
        .flush()
        .context("failed to flush progress output")
}

fn finish_wait_progress(show_progress: bool) -> Result<()> {
    if show_progress {
        println!();
        io::stdout()
            .flush()
            .context("failed to flush progress output")?;
    }
    Ok(())
}

pub(crate) fn propose_raw_transaction(
    config: &ResolvedConfig,
    identity: &LoadedIdentity,
    args: &RawProposeArgs,
) -> Result<ProposalOutput> {
    propose_with_payload(
        config,
        identity,
        &args.common,
        |rpc_client, policy, _vault_pda| {
            if !policy.state.is_program_interaction() {
                bail!(
                    "raw proposals require a ProgramInteraction policy; policy {} is {}",
                    policy.address,
                    policy.state.as_str()
                );
            }
            Ok(ProposalPayload::ProgramInteraction(
                decode_transaction_for_vault(rpc_client, &args.encoded_transaction)?,
            ))
        },
    )
}

fn build_sol_proposal_payload(
    rpc_client: &RpcClient,
    policy: &PolicyAccount,
    vault_pda: &Pubkey,
    args: &SolTransferArgs,
) -> Result<ProposalPayload> {
    if policy.state.is_program_interaction() {
        return Ok(ProposalPayload::ProgramInteraction(DecodedTransaction {
            instructions: build_sol_transfer(rpc_client, vault_pda, args)?,
            address_lookup_table_accounts: Vec::new(),
        }));
    }

    let payload = build_sol_spending_limit_payload(rpc_client, vault_pda, args)?;
    validate_spending_limit_payload(policy, &payload)?;
    Ok(ProposalPayload::SpendingLimit(payload))
}

fn build_token_proposal_payload(
    rpc_client: &RpcClient,
    policy: &PolicyAccount,
    vault_pda: &Pubkey,
    args: &TokenTransferArgs,
) -> Result<ProposalPayload> {
    if policy.state.is_program_interaction() {
        return Ok(ProposalPayload::ProgramInteraction(DecodedTransaction {
            instructions: build_token_transfer(rpc_client, vault_pda, args)?,
            address_lookup_table_accounts: Vec::new(),
        }));
    }

    let payload = build_token_spending_limit_payload(rpc_client, vault_pda, args)?;
    validate_spending_limit_payload(policy, &payload)?;
    Ok(ProposalPayload::SpendingLimit(payload))
}

fn validate_spending_limit_payload(
    policy: &PolicyAccount,
    payload: &SpendingLimitTransferPayload,
) -> Result<()> {
    let Some((policy_mint, destinations)) = policy.state.spending_limit() else {
        bail!(
            "policy {} is {}, but transfer proposals require ProgramInteraction or SpendingLimit policy",
            policy.address,
            policy.state.as_str()
        );
    };

    if *policy_mint != payload.mint {
        bail!(
            "policy {} is for mint {}, not {}",
            policy.address,
            policy_mint,
            payload.mint
        );
    }

    if !destinations.is_empty()
        && !destinations
            .iter()
            .any(|entry| *entry == payload.destination)
    {
        bail!(
            "destination {} is not allowed by spending-limit policy {}",
            payload.destination,
            policy.address
        );
    }

    Ok(())
}

fn create_program_interaction_payload(
    account_index: u8,
    transaction_message: Vec<u8>,
    instruction_constraint_indices: Option<Vec<u8>>,
    memo: Option<String>,
) -> PolicyPayload {
    PolicyPayload::ProgramInteraction(ProgramInteractionPayload {
        instruction_constraint_indices,
        transaction_payload: ProgramInteractionTransactionPayload::AsyncTransaction(
            TransactionPayload {
                account_index,
                ephemeral_signers: 0,
                transaction_message,
                memo,
            },
        ),
    })
}

pub(crate) fn propose_sol_transfer(
    config: &ResolvedConfig,
    identity: &LoadedIdentity,
    args: &SolTransferArgs,
) -> Result<ProposalOutput> {
    let common = effective_common_args(&args.common, args.no_wait);
    propose_with_payload(
        config,
        identity,
        &common,
        |rpc_client, policy, vault_pda| {
            build_sol_proposal_payload(rpc_client, policy, vault_pda, args)
        },
    )
}

pub(crate) fn propose_token_transfer(
    config: &ResolvedConfig,
    identity: &LoadedIdentity,
    args: &TokenTransferArgs,
) -> Result<ProposalOutput> {
    let common = effective_common_args(&args.common, args.no_wait);
    propose_with_payload(
        config,
        identity,
        &common,
        |rpc_client, policy, vault_pda| {
            build_token_proposal_payload(rpc_client, policy, vault_pda, args)
        },
    )
}

fn effective_common_args(common: &ProposeCommonArgs, no_wait: bool) -> ProposeCommonArgs {
    let mut common = common.clone();
    common.no_confirm |= no_wait;
    common
}

fn propose_with_payload(
    config: &ResolvedConfig,
    identity: &LoadedIdentity,
    common: &ProposeCommonArgs,
    build_payload: impl FnOnce(&RpcClient, &PolicyAccount, &Pubkey) -> Result<ProposalPayload>,
) -> Result<ProposalOutput> {
    let program_id = parse_pubkey("program id", &config.program_id)?;
    let signer = identity.keypair.pubkey();
    let rpc_client = RpcClient::new_with_commitment(config.rpc_url.clone(), config.commitment);
    let policy_pda = common
        .policy_pda
        .as_deref()
        .or(config.policy_pda.as_deref())
        .map(|value| parse_pubkey("policy PDA", value))
        .transpose()?;
    let settings_filter = common
        .settings_pda
        .as_deref()
        .or(config.settings_pda.as_deref())
        .map(|value| parse_pubkey("settings PDA", value))
        .transpose()?;

    let policy = if let Some(policy_pda) = policy_pda {
        let account = rpc_client
            .get_account(&policy_pda)
            .with_context(|| format!("failed to fetch policy account {policy_pda}"))?;
        let policy = parse_policy_account(policy_pda, &account)?;
        verify_policy_signer(&policy, &signer)?;
        if let Some(settings_filter) = settings_filter {
            if policy.settings != settings_filter {
                bail!(
                    "policy {} belongs to settings {}, not {}",
                    policy.address,
                    policy.settings,
                    settings_filter
                );
            }
        }
        policy
    } else {
        let matches = list_policy_connections(
            &rpc_client,
            &program_id,
            &config.rpc_url,
            None,
            &signer,
            0,
            8,
            settings_filter.as_ref(),
        )?;

        match matches.as_slice() {
            [connection] => {
                let address = parse_pubkey("policy PDA", &connection.policy_pda)?;
                let account = rpc_client
                    .get_account(&address)
                    .with_context(|| format!("failed to fetch policy account {address}"))?;
                parse_policy_account(address, &account)?
            }
            [] => bail!(
                "No Initiate policy signer entry found for {}. Run `loyal auth` first.",
                signer
            ),
            _ => bail!(
                "Found multiple policy signer entries for {}. Re-run with --policy-pda.",
                signer
            ),
        }
    };

    verify_policy_signer(&policy, &signer)?;

    let account_index = common
        .account_index
        .or(config.account_index)
        .or(policy.account_index)
        .unwrap_or(0);
    if let Some(policy_account_index) = policy.account_index {
        if account_index != policy_account_index {
            bail!(
                "policy {} targets account index {}, not {}",
                policy.address,
                policy_account_index,
                account_index
            );
        }
    }
    let vault_pda = smart_account_pda(&policy.settings, account_index, &program_id);
    let payload = build_payload(&rpc_client, &policy, &vault_pda)?;
    let transaction_index = policy
        .transaction_index
        .checked_add(1)
        .ok_or_else(|| anyhow!("policy transaction index overflow"))?;
    let transaction_pda = transaction_pda(&policy.address, transaction_index, &program_id);
    let proposal_pda = proposal_pda(&policy.address, transaction_index, &program_id);
    let (create_transaction_ix, instruction_count, lookup_table_count) = match payload {
        ProposalPayload::ProgramInteraction(decoded) => {
            if decoded.instructions.is_empty() {
                bail!("proposal does not contain any instructions");
            }

            let compiled_message = compile_smart_account_message_bytes(
                &vault_pda,
                &decoded.instructions,
                &decoded.address_lookup_table_accounts,
            )?;
            let instruction_constraint_indices = resolve_instruction_constraint_indices(
                common.instruction_constraint_indices.as_deref(),
                decoded.instructions.len(),
            )?;
            let payload = create_program_interaction_payload(
                account_index,
                compiled_message,
                instruction_constraint_indices,
                common.memo.clone(),
            );
            (
                create_policy_transaction_instruction(
                    &program_id,
                    &policy.address,
                    &transaction_pda,
                    &signer,
                    payload,
                )?,
                decoded.instructions.len(),
                decoded.address_lookup_table_accounts.len(),
            )
        }
        ProposalPayload::SpendingLimit(payload) => {
            if common.memo.is_some() {
                bail!("--memo is not supported for SpendingLimit transfer proposals");
            }
            if common.instruction_constraint_indices.is_some() {
                bail!(
                    "--instruction-constraint-indices is not supported for SpendingLimit transfer proposals"
                );
            }
            (
                create_policy_transaction_instruction(
                    &program_id,
                    &policy.address,
                    &transaction_pda,
                    &signer,
                    PolicyPayload::SpendingLimit(SpendingLimitPayload {
                        amount: payload.amount,
                        destination: payload.destination.to_bytes(),
                        decimals: payload.decimals,
                    }),
                )?,
                1,
                0,
            )
        }
    };
    let create_proposal_ix = create_proposal_instruction(
        &program_id,
        &policy.address,
        &proposal_pda,
        &signer,
        transaction_index,
    )?;
    let (blockhash, last_valid_block_height) = rpc_client
        .get_latest_blockhash_with_commitment(config.commitment)
        .context("failed to fetch latest blockhash")?;
    let transaction = Transaction::new_signed_with_payer(
        &[create_transaction_ix, create_proposal_ix],
        Some(&signer),
        &[&identity.keypair],
        blockhash,
    );
    let signature = send_transaction_with_diagnostics(
        &rpc_client,
        &transaction,
        "failed to submit proposal transaction",
    )?;

    if !common.no_confirm {
        confirm_signature(&rpc_client, &signature, last_valid_block_height)?;
    }

    Ok(ProposalOutput {
        signature: signature.to_string(),
        program_id: program_id.to_string(),
        settings_pda: policy.settings.to_string(),
        policy_pda: policy.address.to_string(),
        signer: signer.to_string(),
        account_index,
        vault_pda: vault_pda.to_string(),
        transaction_index: transaction_index.to_string(),
        transaction_pda: transaction_pda.to_string(),
        proposal_pda: proposal_pda.to_string(),
        instruction_count,
        lookup_table_count,
    })
}

fn list_policy_connections(
    client: &RpcClient,
    program_id: &Pubkey,
    rpc_url: &str,
    ws_url: Option<String>,
    signer: &Pubkey,
    from_index: usize,
    to_index: usize,
    settings_filter: Option<&Pubkey>,
) -> Result<Vec<AgentConnection>> {
    validate_index_range(from_index, to_index)?;
    let mut out = Vec::new();
    let mut seen = HashSet::new();

    for signer_index in from_index..=to_index {
        let accounts = client.get_program_accounts_with_config(
            program_id,
            policy_program_accounts_config_for_commitment(
                signer,
                signer_index,
                settings_filter,
                client.commitment(),
            ),
        )?;

        for (pubkey, account) in accounts {
            if !seen.insert(pubkey) {
                continue;
            }
            let policy = parse_policy_account(pubkey, &account)?;
            if let Some(connection) = connection_from_policy(
                &policy,
                program_id,
                rpc_url,
                ws_url.clone(),
                signer,
                signer_index,
                settings_filter,
            )? {
                out.push(connection);
            }
        }
    }

    Ok(out)
}

fn connection_from_keyed_account(
    keyed_account: RpcKeyedAccount,
    program_id: &Pubkey,
    rpc_url: &str,
    ws_url: Option<String>,
    signer: &Pubkey,
    signer_index: usize,
    settings_filter: Option<&Pubkey>,
) -> Result<Option<AgentConnection>> {
    let data = keyed_account
        .account
        .data
        .decode()
        .ok_or_else(|| anyhow!("program notification did not include binary account data"))?;
    let pubkey = parse_pubkey("policy PDA", &keyed_account.pubkey)?;
    let policy = parse_policy_account_data(pubkey, &data)?;

    connection_from_policy(
        &policy,
        program_id,
        rpc_url,
        ws_url,
        signer,
        signer_index,
        settings_filter,
    )
}

fn connection_from_policy_in_range(
    policy: &PolicyAccount,
    program_id: &Pubkey,
    rpc_url: &str,
    ws_url: Option<String>,
    signer: &Pubkey,
    from_index: usize,
    to_index: usize,
    settings_filter: Option<&Pubkey>,
) -> Result<Option<AgentConnection>> {
    for signer_index in from_index..=to_index {
        if let Some(connection) = connection_from_policy(
            policy,
            program_id,
            rpc_url,
            ws_url.clone(),
            signer,
            signer_index,
            settings_filter,
        )? {
            return Ok(Some(connection));
        }
    }

    Ok(None)
}

fn connection_from_policy(
    policy: &PolicyAccount,
    program_id: &Pubkey,
    rpc_url: &str,
    ws_url: Option<String>,
    signer: &Pubkey,
    signer_index: usize,
    settings_filter: Option<&Pubkey>,
) -> Result<Option<AgentConnection>> {
    if settings_filter.is_some_and(|settings| policy.settings != *settings) {
        return Ok(None);
    }

    let Some((actual_index, signer_entry)) = policy
        .signers
        .iter()
        .enumerate()
        .find(|(_, entry)| entry.key == *signer)
    else {
        return Ok(None);
    };

    if actual_index != signer_index {
        return Ok(None);
    }

    let can_initiate = signer_entry.permissions_mask & PERMISSION_INITIATE == PERMISSION_INITIATE;
    if !can_initiate {
        return Ok(None);
    }

    let vault_pda = policy
        .account_index
        .map(|index| smart_account_pda(&policy.settings, index, program_id).to_string());

    Ok(Some(AgentConnection {
        signer: signer.to_string(),
        settings_pda: policy.settings.to_string(),
        policy_pda: policy.address.to_string(),
        program_id: program_id.to_string(),
        rpc_url: rpc_url.to_string(),
        ws_url,
        permission_mask: signer_entry.permissions_mask,
        can_initiate,
        signer_index: actual_index,
        account_index: policy.account_index,
        policy_state: policy.state.as_str().to_string(),
        vault_pda,
    }))
}

fn policy_program_accounts_config(
    signer: &Pubkey,
    signer_index: usize,
    settings_filter: Option<&Pubkey>,
    config: &ResolvedConfig,
) -> RpcProgramAccountsConfig {
    policy_program_accounts_config_for_commitment(
        signer,
        signer_index,
        settings_filter,
        config.commitment,
    )
}

fn policy_program_accounts_config_for_commitment(
    signer: &Pubkey,
    signer_index: usize,
    settings_filter: Option<&Pubkey>,
    commitment: solana_commitment_config::CommitmentConfig,
) -> RpcProgramAccountsConfig {
    RpcProgramAccountsConfig {
        filters: Some(policy_signer_filters(signer, signer_index, settings_filter)),
        account_config: RpcAccountInfoConfig {
            encoding: Some(UiAccountEncoding::Base64),
            data_slice: None,
            commitment: Some(commitment),
            min_context_slot: None,
        },
        with_context: None,
        sort_results: None,
    }
}

fn policy_signer_filters(
    signer: &Pubkey,
    signer_index: usize,
    settings_filter: Option<&Pubkey>,
) -> Vec<RpcFilterType> {
    let mut filters = vec![
        RpcFilterType::Memcmp(Memcmp::new_base58_encoded(0, &POLICY_DISCRIMINATOR)),
        RpcFilterType::Memcmp(Memcmp::new_base58_encoded(
            policy_signer_offset(signer_index),
            &signer.to_bytes(),
        )),
    ];

    if let Some(settings) = settings_filter {
        filters.push(RpcFilterType::Memcmp(Memcmp::new_base58_encoded(
            8,
            &settings.to_bytes(),
        )));
    }

    filters
}

fn policy_signer_offset(index: usize) -> usize {
    POLICY_SIGNER_OFFSET + POLICY_SIGNER_SIZE * index
}

fn parse_policy_account(pubkey: Pubkey, account: &Account) -> Result<PolicyAccount> {
    parse_policy_account_data(pubkey, &account.data)
}

fn parse_policy_account_data(address: Pubkey, data: &[u8]) -> Result<PolicyAccount> {
    if data.get(..8) != Some(POLICY_DISCRIMINATOR.as_slice()) {
        bail!("{address} is not a Squads policy account");
    }

    let mut reader = Reader::new(data, 8);
    let settings = reader.pubkey()?;
    let _seed = reader.u64()?;
    let _bump = reader.u8()?;
    let transaction_index = reader.u64()?;
    let _stale_transaction_index = reader.u64()?;
    let signer_count = reader.u32()? as usize;
    if signer_count > 4096 {
        bail!("policy {address} has suspicious signer count {signer_count}");
    }
    let mut signers = Vec::with_capacity(signer_count);
    for _ in 0..signer_count {
        signers.push(PolicySigner {
            key: reader.pubkey()?,
            permissions_mask: reader.u8()?,
        });
    }
    let _threshold = reader.u16()?;
    let _time_lock = reader.u32()?;
    let policy_state_tag = reader.u8()?;
    let (state, account_index) = match policy_state_tag {
        0 => (PolicyState::InternalFundTransfer, None),
        1 => {
            let source_account_index = reader.u8()?;
            let destinations = reader.pubkey_vec()?;
            let mint = reader.pubkey()?;
            (
                PolicyState::SpendingLimit { mint, destinations },
                Some(source_account_index),
            )
        }
        2 => (PolicyState::SettingsChange, None),
        3 => (PolicyState::ProgramInteraction, Some(reader.u8()?)),
        tag => (PolicyState::Unknown(tag), None),
    };

    Ok(PolicyAccount {
        address,
        settings,
        transaction_index,
        signers,
        account_index,
        state,
    })
}

fn verify_policy_signer(policy: &PolicyAccount, signer: &Pubkey) -> Result<()> {
    let Some(entry) = policy.signers.iter().find(|entry| entry.key == *signer) else {
        bail!(
            "signer {signer} is not a member of policy {}",
            policy.address
        );
    };

    if entry.permissions_mask & PERMISSION_INITIATE != PERMISSION_INITIATE {
        bail!(
            "signer {signer} does not have Initiate permission on policy {}",
            policy.address
        );
    }

    Ok(())
}

fn decode_transaction_for_vault(client: &RpcClient, encoded: &str) -> Result<DecodedTransaction> {
    let bytes = decode_transaction_bytes(encoded)?;
    let versioned = bincode::deserialize::<VersionedTransaction>(&bytes)
        .or_else(|_| {
            bincode::deserialize::<Transaction>(&bytes).map(|transaction| VersionedTransaction {
                signatures: transaction.signatures,
                message: VersionedMessage::Legacy(transaction.message),
            })
        })
        .context("failed to deserialize encoded transaction")?;

    decompile_versioned_transaction(client, &versioned)
}

fn decode_transaction_bytes(encoded: &str) -> Result<Vec<u8>> {
    let trimmed = encoded.trim();
    general_purpose::STANDARD
        .decode(trimmed)
        .or_else(|_| general_purpose::URL_SAFE_NO_PAD.decode(trimmed))
        .or_else(|_| bs58::decode(trimmed).into_vec())
        .context("encoded transaction must be base64, URL-safe base64, or base58")
}

fn decompile_versioned_transaction(
    client: &RpcClient,
    transaction: &VersionedTransaction,
) -> Result<DecodedTransaction> {
    let (account_keys, address_lookup_table_accounts) = match &transaction.message {
        VersionedMessage::Legacy(message) => (message.account_keys.clone(), Vec::new()),
        VersionedMessage::V0(message) => {
            let lookup_accounts =
                load_lookup_table_accounts(client, &message.address_table_lookups)?;
            let mut account_keys = message.account_keys.clone();
            for (lookup, lookup_account) in message
                .address_table_lookups
                .iter()
                .zip(lookup_accounts.iter())
            {
                for index in &lookup.writable_indexes {
                    account_keys.push(*lookup_account.addresses.get(*index as usize).ok_or_else(
                        || {
                            anyhow!(
                                "lookup table {} missing writable index {}",
                                lookup.account_key,
                                index
                            )
                        },
                    )?);
                }
                for index in &lookup.readonly_indexes {
                    account_keys.push(*lookup_account.addresses.get(*index as usize).ok_or_else(
                        || {
                            anyhow!(
                                "lookup table {} missing readonly index {}",
                                lookup.account_key,
                                index
                            )
                        },
                    )?);
                }
            }
            (account_keys, lookup_accounts)
        }
    };

    let mut instructions = Vec::new();
    for compiled in transaction.message.instructions() {
        let program_id = *account_keys
            .get(compiled.program_id_index as usize)
            .ok_or_else(|| anyhow!("instruction program id index is out of bounds"))?;
        let mut accounts = Vec::new();
        for index in &compiled.accounts {
            let index = *index as usize;
            let pubkey = *account_keys
                .get(index)
                .ok_or_else(|| anyhow!("instruction account index is out of bounds"))?;
            accounts.push(AccountMeta {
                pubkey,
                is_signer: transaction.message.is_signer(index),
                is_writable: transaction.message.is_maybe_writable(index, None),
            });
        }
        instructions.push(Instruction {
            program_id,
            accounts,
            data: compiled.data.clone(),
        });
    }

    Ok(DecodedTransaction {
        instructions,
        address_lookup_table_accounts,
    })
}

fn load_lookup_table_accounts(
    client: &RpcClient,
    lookups: &[v0::MessageAddressTableLookup],
) -> Result<Vec<AddressLookupTableAccount>> {
    let mut out = Vec::new();
    for lookup in lookups {
        let account = client
            .get_account(&lookup.account_key)
            .with_context(|| format!("failed to fetch lookup table {}", lookup.account_key))?;
        let table = AddressLookupTable::deserialize(&account.data).map_err(|error| {
            anyhow!(
                "failed to decode lookup table {}: {error}",
                lookup.account_key
            )
        })?;
        out.push(AddressLookupTableAccount {
            key: lookup.account_key,
            addresses: table.addresses.to_vec(),
        });
    }
    Ok(out)
}

fn compile_smart_account_message_bytes(
    vault_pda: &Pubkey,
    instructions: &[Instruction],
    lookup_tables: &[AddressLookupTableAccount],
) -> Result<Vec<u8>> {
    let message = v0::Message::try_compile(vault_pda, instructions, lookup_tables, Hash::default())
        .context("failed to compile transaction for the Squads vault")?;
    let serialized = SmartAccountTransactionMessageBytes {
        num_signers: message.header.num_required_signatures,
        num_writable_signers: message
            .header
            .num_required_signatures
            .saturating_sub(message.header.num_readonly_signed_accounts),
        num_writable_non_signers: (message.account_keys.len() as u8)
            .saturating_sub(message.header.num_required_signatures)
            .saturating_sub(message.header.num_readonly_unsigned_accounts),
        account_keys: message
            .account_keys
            .iter()
            .map(|key| key.to_bytes())
            .collect::<Vec<_>>(),
        instructions: message
            .instructions
            .iter()
            .map(|instruction| SmartAccountCompiledInstructionBytes {
                program_id_index: instruction.program_id_index,
                account_indexes: instruction.accounts.clone(),
                data: instruction.data.clone(),
            })
            .collect(),
        address_table_lookups: message
            .address_table_lookups
            .iter()
            .map(|lookup| SmartAccountMessageAddressTableLookupBytes {
                account_key: lookup.account_key.to_bytes(),
                writable_indexes: lookup.writable_indexes.clone(),
                readonly_indexes: lookup.readonly_indexes.clone(),
            })
            .collect(),
    };

    borsh::to_vec(&serialized).context("failed to serialize Squads transaction message")
}

fn resolve_instruction_constraint_indices(
    value: Option<&str>,
    instruction_count: usize,
) -> Result<Option<Vec<u8>>> {
    let indices = match value {
        Some(value) => parse_csv_u8(value)?,
        None => vec![0; instruction_count],
    };

    if indices.len() != instruction_count {
        bail!(
            "--instruction-constraint-indices must contain one u8 per instruction (expected {}, got {})",
            instruction_count,
            indices.len()
        );
    }

    Ok(Some(indices))
}

fn parse_csv_u8(value: &str) -> Result<Vec<u8>> {
    if value.trim().is_empty() {
        return Ok(Vec::new());
    }

    value
        .split(',')
        .map(|entry| {
            let trimmed = entry.trim();
            let parsed = trimmed
                .parse::<u8>()
                .with_context(|| format!("invalid u8 value in CSV: {trimmed}"))?;
            Ok(parsed)
        })
        .collect()
}

fn create_policy_transaction_instruction(
    program_id: &Pubkey,
    policy_pda: &Pubkey,
    transaction_pda: &Pubkey,
    signer: &Pubkey,
    payload: PolicyPayload,
) -> Result<Instruction> {
    let args = CreateTransactionArgs::PolicyPayload { payload };
    let mut data = CREATE_TRANSACTION_DISCRIMINATOR.to_vec();
    data.extend(borsh::to_vec(&args).context("failed to serialize createTransaction args")?);

    Ok(Instruction {
        program_id: *program_id,
        accounts: vec![
            AccountMeta::new(*policy_pda, false),
            AccountMeta::new(*transaction_pda, false),
            AccountMeta::new_readonly(*signer, true),
            AccountMeta::new(*signer, true),
            AccountMeta::new_readonly(system_program_id(), false),
            AccountMeta::new_readonly(*program_id, false),
        ],
        data,
    })
}

fn create_proposal_instruction(
    program_id: &Pubkey,
    consensus_pda: &Pubkey,
    proposal_pda: &Pubkey,
    signer: &Pubkey,
    transaction_index: u64,
) -> Result<Instruction> {
    let args = CreateProposalArgs {
        transaction_index,
        draft: false,
    };
    let mut data = CREATE_PROPOSAL_DISCRIMINATOR.to_vec();
    data.extend(borsh::to_vec(&args).context("failed to serialize createProposal args")?);

    Ok(Instruction {
        program_id: *program_id,
        accounts: vec![
            AccountMeta::new_readonly(*consensus_pda, false),
            AccountMeta::new(*proposal_pda, false),
            AccountMeta::new_readonly(*signer, true),
            AccountMeta::new(*signer, true),
            AccountMeta::new_readonly(system_program_id(), false),
            AccountMeta::new_readonly(*program_id, false),
        ],
        data,
    })
}

fn system_program_id() -> Pubkey {
    Pubkey::new_from_array([0; 32])
}

fn smart_account_pda(settings_pda: &Pubkey, account_index: u8, program_id: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[
            b"smart_account",
            settings_pda.as_ref(),
            b"smart_account",
            &[account_index],
        ],
        program_id,
    )
    .0
}

fn transaction_pda(consensus_pda: &Pubkey, transaction_index: u64, program_id: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[
            b"smart_account",
            consensus_pda.as_ref(),
            b"transaction",
            &transaction_index.to_le_bytes(),
        ],
        program_id,
    )
    .0
}

fn proposal_pda(consensus_pda: &Pubkey, transaction_index: u64, program_id: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[
            b"smart_account",
            consensus_pda.as_ref(),
            b"transaction",
            &transaction_index.to_le_bytes(),
            b"proposal",
        ],
        program_id,
    )
    .0
}

fn confirm_signature(
    client: &RpcClient,
    signature: &Signature,
    last_valid_block_height: u64,
) -> Result<()> {
    let started_at = Instant::now();

    loop {
        let statuses = client
            .get_signature_statuses(&[*signature])
            .context("failed to fetch proposal transaction status")?
            .value;

        if let Some(Some(status)) = statuses.first() {
            if let Some(error) = &status.err {
                bail!("proposal transaction failed after submission: {signature}: {error:?}");
            }

            if status.satisfies_commitment(client.commitment()) {
                return Ok(());
            }
        }

        if client
            .get_block_height_with_commitment(client.commitment())
            .is_ok_and(|height| height > last_valid_block_height)
        {
            bail!("proposal transaction was not confirmed before blockhash expiry: {signature}");
        }

        if started_at.elapsed() >= CONFIRM_TIMEOUT {
            bail!("timed out waiting for proposal transaction confirmation: {signature}");
        }

        std::thread::sleep(CONFIRM_POLL_INTERVAL);
    }
}

fn parse_pubkey(label: &str, value: &str) -> Result<Pubkey> {
    Pubkey::from_str(value).with_context(|| format!("invalid {label}: {value}"))
}

fn parse_optional_pubkey(label: &str, value: Option<&str>) -> Result<Option<Pubkey>> {
    value.map(|value| parse_pubkey(label, value)).transpose()
}

fn validate_index_range(from_index: usize, to_index: usize) -> Result<()> {
    if from_index > to_index {
        bail!("--from-index ({from_index}) must be <= --to-index ({to_index})");
    }
    Ok(())
}

struct Reader<'a> {
    data: &'a [u8],
    offset: usize,
}

impl<'a> Reader<'a> {
    fn new(data: &'a [u8], offset: usize) -> Self {
        Self { data, offset }
    }

    fn raw(&mut self, size: usize) -> Result<&'a [u8]> {
        if self.offset + size > self.data.len() {
            bail!("policy account read past end at {}", self.offset);
        }
        let out = &self.data[self.offset..self.offset + size];
        self.offset += size;
        Ok(out)
    }

    fn u8(&mut self) -> Result<u8> {
        Ok(self.raw(1)?[0])
    }

    fn u16(&mut self) -> Result<u16> {
        let mut bytes = [0u8; 2];
        bytes.copy_from_slice(self.raw(2)?);
        Ok(u16::from_le_bytes(bytes))
    }

    fn u32(&mut self) -> Result<u32> {
        let mut bytes = [0u8; 4];
        bytes.copy_from_slice(self.raw(4)?);
        Ok(u32::from_le_bytes(bytes))
    }

    fn u64(&mut self) -> Result<u64> {
        let mut bytes = [0u8; 8];
        bytes.copy_from_slice(self.raw(8)?);
        Ok(u64::from_le_bytes(bytes))
    }

    fn pubkey(&mut self) -> Result<Pubkey> {
        let mut bytes = [0u8; 32];
        bytes.copy_from_slice(self.raw(32)?);
        Ok(Pubkey::new_from_array(bytes))
    }

    fn pubkey_vec(&mut self) -> Result<Vec<Pubkey>> {
        let count = self.u32()? as usize;
        if count > 4096 {
            bail!("policy account has suspicious pubkey vector length {count}");
        }

        let mut out = Vec::with_capacity(count);
        for _ in 0..count {
            out.push(self.pubkey()?);
        }
        Ok(out)
    }
}
