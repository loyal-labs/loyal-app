use anchor_lang::prelude::*;

pub const CRANK_AUTHORITY_SEED: &[u8] = b"kamino_route_crank";

pub const SQUADS_SMART_ACCOUNT_PROGRAM_ID: Pubkey =
    pubkey!("SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG");

pub const EXECUTE_TRANSACTION_SYNC_V2_DISCRIMINATOR: [u8; 8] = [90, 81, 187, 81, 39, 70, 128, 78];
pub const SYNC_PAYLOAD_POLICY_VARIANT: u8 = 1;

pub const MAX_POLICY_PAYLOAD_LEN: usize = 2048;
