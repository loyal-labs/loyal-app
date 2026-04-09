use serde_json::Value;
use solana_sdk::{
    signature::{EncodableKey, Keypair},
    signer::Signer,
};
use std::{path::PathBuf, process::Command};
use tempfile::tempdir;

#[test]
fn show_returns_success_for_missing_identity() {
    let temp = tempdir().unwrap();
    let keypair_path = temp.path().join("missing.json");

    let output = Command::new(binary_path())
        .args([
            "--keypair",
            keypair_path.to_str().unwrap(),
            "--output",
            "json-compact",
            "show",
        ])
        .output()
        .unwrap();

    assert!(output.status.success());

    let value = parse_json(&output.stdout);
    assert_eq!(value["status"], "missing");
    assert_eq!(value["exists"], false);
    assert_eq!(value["keypairPath"], keypair_path.display().to_string());
    assert!(value.get("pubkey").unwrap().is_null());
}

#[test]
fn pubkey_fails_for_missing_identity() {
    let temp = tempdir().unwrap();
    let keypair_path = temp.path().join("missing.json");

    let output = Command::new(binary_path())
        .args(["--keypair", keypair_path.to_str().unwrap(), "pubkey"])
        .output()
        .unwrap();

    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("Run `loyal-smart-accounts init`"));
}

#[test]
fn show_reports_unreadable_identity_without_failing() {
    let temp = tempdir().unwrap();
    let keypair_path = temp.path().join("broken.json");
    std::fs::write(&keypair_path, b"not-json").unwrap();

    let output = Command::new(binary_path())
        .args([
            "--keypair",
            keypair_path.to_str().unwrap(),
            "--output",
            "json-compact",
            "show",
        ])
        .output()
        .unwrap();

    assert!(output.status.success());

    let value = parse_json(&output.stdout);
    assert_eq!(value["status"], "unreadable");
    assert_eq!(value["exists"], true);
    assert_eq!(value["keypairPath"], keypair_path.display().to_string());
    assert!(value["error"]
        .as_str()
        .unwrap()
        .contains("failed to read keypair file"));
}

#[test]
fn init_and_show_json_output_work() {
    let temp = tempdir().unwrap();
    let keypair_path = temp.path().join("identity.json");

    let init_output = Command::new(binary_path())
        .args([
            "--keypair",
            keypair_path.to_str().unwrap(),
            "--output",
            "json-compact",
            "init",
        ])
        .output()
        .unwrap();

    assert!(init_output.status.success());

    let init_value = parse_json(&init_output.stdout);
    assert_eq!(init_value["status"], "ready");
    assert_eq!(init_value["exists"], true);
    assert_eq!(
        init_value["keypairPath"],
        keypair_path.display().to_string()
    );
    assert!(init_value["pubkey"].as_str().unwrap().len() > 20);

    let show_output = Command::new(binary_path())
        .args([
            "--keypair",
            keypair_path.to_str().unwrap(),
            "--output",
            "json-compact",
            "show",
        ])
        .output()
        .unwrap();

    assert!(show_output.status.success());

    let show_value = parse_json(&show_output.stdout);
    assert_eq!(show_value["status"], "ready");
    assert_eq!(show_value["pubkey"], init_value["pubkey"]);
}

#[test]
fn sign_message_returns_expected_signature_for_fixture_key() {
    let temp = tempdir().unwrap();
    let keypair_path = temp.path().join("fixture.json");
    let keypair = Keypair::new_from_array([7u8; 32]);
    let message = "hello loyal";
    let expected_signature = keypair.sign_message(message.as_bytes()).to_string();
    let expected_pubkey = keypair.pubkey().to_string();
    keypair.write_to_file(&keypair_path).unwrap();

    let output = Command::new(binary_path())
        .args([
            "--keypair",
            keypair_path.to_str().unwrap(),
            "--output",
            "json-compact",
            "sign-message",
            "--message",
            message,
        ])
        .output()
        .unwrap();

    assert!(output.status.success());

    let value = parse_json(&output.stdout);
    assert_eq!(value["keypairPath"], keypair_path.display().to_string());
    assert_eq!(value["pubkey"], expected_pubkey);
    assert_eq!(value["message"], message);
    assert_eq!(value["signature"], expected_signature);
}

#[test]
fn pubkey_display_outputs_only_pubkey() {
    let temp = tempdir().unwrap();
    let keypair_path = temp.path().join("fixture.json");
    let keypair = Keypair::new_from_array([7u8; 32]);
    let expected_pubkey = keypair.pubkey().to_string();
    keypair.write_to_file(&keypair_path).unwrap();

    let output = Command::new(binary_path())
        .args(["--keypair", keypair_path.to_str().unwrap(), "pubkey"])
        .output()
        .unwrap();

    assert!(output.status.success());
    assert_eq!(
        String::from_utf8_lossy(&output.stdout),
        format!("{expected_pubkey}\n")
    );
}

fn binary_path() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_loyal-smart-accounts"))
}

fn parse_json(bytes: &[u8]) -> Value {
    serde_json::from_slice(bytes).unwrap()
}
