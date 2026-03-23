use serde::Deserialize;

use loyal_smart_accounts_rs::pda;
use loyal_smart_accounts_rs::PROGRAM_ID;
use solana_sdk::pubkey::Pubkey;

#[derive(Debug, Deserialize)]
struct PdaFixtureEntry {
    address: String,
    bump: u8,
}

#[derive(Debug, Deserialize)]
struct PdaFixture {
    pda: std::collections::BTreeMap<String, PdaFixtureEntry>,
}

fn pubkey(byte: u8) -> Pubkey {
    Pubkey::new_from_array([byte; 32])
}

#[test]
fn pda_helpers_match_typescript_fixtures() {
    let fixture: PdaFixture =
        serde_json::from_str(include_str!("../upstream/parity/pda-fixtures.json"))
            .expect("fixture should parse");

    let cases = vec![
        ("programConfig", pda::get_program_config_pda(None)),
        ("settings", pda::get_settings_pda(1, None)),
        (
            "smartAccount",
            pda::get_smart_account_pda(pubkey(3), 2, Some(PROGRAM_ID)),
        ),
        (
            "transaction",
            pda::get_transaction_pda(pubkey(3), 9, Some(PROGRAM_ID)),
        ),
        (
            "proposal",
            pda::get_proposal_pda(pubkey(3), 9, Some(PROGRAM_ID)),
        ),
        (
            "batchTransaction",
            pda::get_batch_transaction_pda(pubkey(3), 4, 3, Some(PROGRAM_ID)),
        ),
        (
            "ephemeralSigner",
            pda::get_ephemeral_signer_pda(pubkey(9), 7, Some(PROGRAM_ID)),
        ),
        (
            "spendingLimit",
            pda::get_spending_limit_pda(pubkey(3), pubkey(8), Some(PROGRAM_ID)),
        ),
        (
            "transactionBuffer",
            pda::get_transaction_buffer_pda(pubkey(7), pubkey(1), 5, Some(PROGRAM_ID)),
        ),
        (
            "policy",
            pda::get_policy_pda(pubkey(3), 11, Some(PROGRAM_ID)),
        ),
    ];

    for (name, derived) in cases {
        let expected = fixture.pda.get(name).expect("fixture entry should exist");
        assert_eq!(derived.address.to_string(), expected.address, "{}", name);
        assert_eq!(derived.bump, expected.bump, "{}", name);
    }
}
