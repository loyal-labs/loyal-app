use serde::Deserialize;

use loyal_smart_accounts_rs::smart_accounts::CreateSmartAccountRequest;
use loyal_smart_accounts_rs::types::SmartAccountSigner;
use loyal_smart_accounts_rs::{smart_accounts, PROGRAM_ID};
use solana_sdk::pubkey::Pubkey;

#[derive(Debug, Deserialize)]
struct RequestSignerFixture {
    key: String,
    permissions: PermissionsFixture,
}

#[derive(Debug, Deserialize)]
struct PermissionsFixture {
    mask: u8,
}

#[derive(Debug, Deserialize)]
struct RequestFixture {
    creator: String,
    treasury: String,
    settings: String,
    #[serde(rename = "settingsAuthority")]
    settings_authority: String,
    threshold: u16,
    signers: Vec<RequestSignerFixture>,
    #[serde(rename = "timeLock")]
    time_lock: u32,
    #[serde(rename = "rentCollector")]
    rent_collector: String,
    memo: String,
}

#[derive(Debug, Deserialize)]
struct KeyFixture {
    pubkey: String,
    #[serde(rename = "isSigner")]
    is_signer: bool,
    #[serde(rename = "isWritable")]
    is_writable: bool,
}

#[derive(Debug, Deserialize)]
struct InstructionFixture {
    #[serde(rename = "programId")]
    program_id: String,
    keys: Vec<KeyFixture>,
    data: Vec<u8>,
}

#[derive(Debug, Deserialize)]
struct PreparedFixture {
    operation: String,
    payer: String,
    #[serde(rename = "programId")]
    program_id: String,
    #[serde(rename = "requiresConfirmation")]
    requires_confirmation: bool,
    #[serde(rename = "instructionCount")]
    instruction_count: usize,
    #[serde(rename = "lookupTableCount")]
    lookup_table_count: usize,
}

#[derive(Debug, Deserialize)]
struct CreateFixture {
    request: RequestFixture,
    instruction: InstructionFixture,
    prepared: PreparedFixture,
}

#[derive(Debug, Deserialize)]
struct FixtureFile {
    create: CreateFixture,
}

fn parse_pubkey(value: &str) -> Pubkey {
    value.parse().expect("fixture pubkey should parse")
}

#[test]
fn create_instruction_and_prepare_match_typescript_fixture() {
    let fixture: FixtureFile =
        serde_json::from_str(include_str!("../upstream/parity/create-smart-account.json"))
            .expect("fixture should parse");

    let request = CreateSmartAccountRequest {
        treasury: parse_pubkey(&fixture.create.request.treasury),
        creator: parse_pubkey(&fixture.create.request.creator),
        settings: Some(parse_pubkey(&fixture.create.request.settings)),
        settings_authority: Some(parse_pubkey(&fixture.create.request.settings_authority)),
        threshold: fixture.create.request.threshold,
        signers: fixture
            .create
            .request
            .signers
            .iter()
            .map(|signer| SmartAccountSigner {
                key: parse_pubkey(&signer.key),
                permissions: loyal_smart_accounts_rs::types::Permissions {
                    mask: signer.permissions.mask,
                },
            })
            .collect(),
        time_lock: fixture.create.request.time_lock,
        rent_collector: Some(parse_pubkey(&fixture.create.request.rent_collector)),
        memo: Some(fixture.create.request.memo.clone()),
        program_id: Some(PROGRAM_ID),
        remaining_accounts: vec![],
    };

    let instruction =
        smart_accounts::instructions::create(&request, PROGRAM_ID).expect("instruction build");
    let prepared = smart_accounts::prepare::create(&request, PROGRAM_ID).expect("prepare create");

    assert_eq!(
        instruction.program_id.to_string(),
        fixture.create.instruction.program_id
    );
    assert_eq!(instruction.data, fixture.create.instruction.data);
    assert_eq!(
        instruction.accounts.len(),
        fixture.create.instruction.keys.len()
    );

    for (actual, expected) in instruction
        .accounts
        .iter()
        .zip(&fixture.create.instruction.keys)
    {
        assert_eq!(actual.pubkey.to_string(), expected.pubkey);
        assert_eq!(actual.is_signer, expected.is_signer);
        assert_eq!(actual.is_writable, expected.is_writable);
    }

    assert_eq!(prepared.operation_name(), fixture.create.prepared.operation);
    assert_eq!(prepared.payer.to_string(), fixture.create.prepared.payer);
    assert_eq!(
        prepared.program_id.to_string(),
        fixture.create.prepared.program_id
    );
    assert_eq!(
        prepared.requires_confirmation(),
        fixture.create.prepared.requires_confirmation
    );
    assert_eq!(
        prepared.instructions.len(),
        fixture.create.prepared.instruction_count
    );
    assert_eq!(
        prepared.address_lookup_table_accounts.len(),
        fixture.create.prepared.lookup_table_count
    );
}
