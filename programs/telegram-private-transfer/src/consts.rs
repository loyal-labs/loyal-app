use anchor_lang::prelude::*;

// Seed constants
pub const DEPOSIT_PDA_SEED: &[u8] = b"deposit_v2";
pub const USERNAME_DEPOSIT_PDA_SEED: &[u8] = b"username_deposit_v2";
pub const VAULT_PDA_SEED: &[u8] = b"vault";

// Constants
pub const KLEND_PROGRAM_ID: Pubkey = pubkey!("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
pub const KLEND_DEPOSIT_DISCRIMINATOR: [u8; 8] = [169, 201, 30, 126, 6, 205, 102, 68];
pub const KLEND_REDEEM_DISCRIMINATOR: [u8; 8] = [234, 117, 181, 125, 185, 142, 220, 29];

// Devnet
#[cfg(feature = "devnet")]
mod inner {
    use super::*;

    pub const USDC_MINT: Pubkey = pubkey!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

    pub const KLEND_LENDING_MARKET: Pubkey =
        pubkey!("27MKCQo5qP7ijrwWSMKX2Jeb3PhK2NZmHQ9befWVRS4J");

    pub const KLEND_RESERVE: Pubkey = pubkey!("9uKMtFU9UJ9DfbwzCReGENb31appi79KTEeDGdCnvMjy");

    pub const KLEND_RESERVE_LIQUIDITY_SUPPLY: Pubkey =
        pubkey!("Bh45cPkpfRvz9hAs23ye5TowsGbhbh4BXT4AGww8JfES");

    pub const KLEND_RESERVE_COLLATERAL_MINT: Pubkey =
        pubkey!("8GoBXfEq3aTiWTxEP2tAaygJMx3LhG764iN5e6gqaLA");
}

// Mainnet
#[cfg(not(feature = "devnet"))]
mod inner {
    use super::*;

    pub const USDC_MINT: Pubkey = pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

    pub const KLEND_LENDING_MARKET: Pubkey =
        pubkey!("CqAoLuqWtavaVE8deBjMKe8ZfSt9ghR6Vb8nfsyabyHA");

    pub const KLEND_RESERVE: Pubkey = pubkey!("9GJ9GBRwCp4pHmWrQ43L5xpc9Vykg7jnfwcFGN8FoHYu");

    pub const KLEND_RESERVE_LIQUIDITY_SUPPLY: Pubkey =
        pubkey!("H6JUwz8c61eQnYUx8avGXydKztKPyGvgWAUjmZUPS3BC");

    pub const KLEND_RESERVE_COLLATERAL_MINT: Pubkey =
        pubkey!("DKaVQFXD6Qz4USTkRWyPun3oU6r1RfYsWJ8YqLpnSnN5");
}

pub use inner::*;
