use anchor_lang::prelude::*;

#[error_code]
pub enum KaminoRouterError {
    #[msg("Invalid token mint")]
    InvalidMint,
    #[msg("Invalid token account")]
    InvalidTokenAccount,
    #[msg("Invalid fee token account")]
    InvalidFeeTokenAccount,
    #[msg("Invalid Kamino accounts")]
    InvalidKaminoAccounts,
    #[msg("Source balance is not above the routing threshold")]
    ThresholdNotMet,
    #[msg("Route amount is too small")]
    RouteAmountTooSmall,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Kamino consumed an unexpected liquidity amount")]
    InvalidKaminoDeposit,
    #[msg("Kamino deposit minted no collateral shares")]
    NoCollateralMinted,
}
