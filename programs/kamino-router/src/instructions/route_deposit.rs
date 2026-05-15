use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke,
};
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{transfer_checked, Mint, Token, TokenAccount, TransferChecked},
};

use crate::{constants::*, KaminoRouterError};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RouteDepositArgs {
    pub keep_liquidity_amount: u64,
    pub minimum_deposit_amount: u64,
}

#[derive(Accounts)]
pub struct RouteDeposit<'info> {
    #[account(mut)]
    pub crank: Signer<'info>,
    /// CHECK: Must be the Squads vault signer for this synchronous policy execution.
    pub vault: Signer<'info>,
    #[account(
        mut,
        constraint = source_liquidity.mint == token_mint.key() @ KaminoRouterError::InvalidTokenAccount,
        constraint = source_liquidity.owner == vault.key() @ KaminoRouterError::InvalidTokenAccount,
    )]
    pub source_liquidity: Account<'info, TokenAccount>,
    #[account(address = USDC_MINT @ KaminoRouterError::InvalidMint)]
    pub token_mint: Account<'info, Mint>,
    #[account(
        mut,
        constraint = fee_liquidity.mint == token_mint.key() @ KaminoRouterError::InvalidFeeTokenAccount,
        constraint = fee_liquidity.owner == crank.key() @ KaminoRouterError::InvalidFeeTokenAccount,
        constraint = fee_liquidity.key() != source_liquidity.key() @ KaminoRouterError::InvalidFeeTokenAccount,
    )]
    pub fee_liquidity: Account<'info, TokenAccount>,
    /// CHECK: Pinned below.
    #[account(address = KLEND_LENDING_MARKET @ KaminoRouterError::InvalidKaminoAccounts)]
    pub lending_market: UncheckedAccount<'info>,
    /// CHECK: Derived below.
    pub lending_market_authority: UncheckedAccount<'info>,
    /// CHECK: Pinned below.
    #[account(mut, address = KLEND_RESERVE @ KaminoRouterError::InvalidKaminoAccounts)]
    pub reserve: UncheckedAccount<'info>,
    /// CHECK: Pinned below.
    #[account(mut, address = KLEND_RESERVE_LIQUIDITY_SUPPLY @ KaminoRouterError::InvalidKaminoAccounts)]
    pub reserve_liquidity_supply: UncheckedAccount<'info>,
    #[account(mut, address = KLEND_RESERVE_COLLATERAL_MINT @ KaminoRouterError::InvalidKaminoAccounts)]
    pub reserve_collateral_mint: Account<'info, Mint>,
    #[account(
        init_if_needed,
        payer = crank,
        associated_token::mint = reserve_collateral_mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program,
    )]
    pub vault_collateral_token_account: Account<'info, TokenAccount>,
    /// CHECK: Pinned to instructions sysvar.
    #[account(address = sysvar::instructions::ID @ KaminoRouterError::InvalidKaminoAccounts)]
    pub instruction_sysvar_account: UncheckedAccount<'info>,
    /// CHECK: Pinned to KLend.
    #[account(address = KLEND_PROGRAM_ID @ KaminoRouterError::InvalidKaminoAccounts)]
    pub klend_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<RouteDeposit>, args: RouteDepositArgs) -> Result<()> {
    require_eq!(
        ctx.accounts.token_mint.decimals,
        USDC_DECIMALS,
        KaminoRouterError::InvalidMint
    );
    validate_lending_market_authority(&ctx.accounts.lending_market_authority.key())?;

    let routable_amount = ctx
        .accounts
        .source_liquidity
        .amount
        .checked_sub(args.keep_liquidity_amount)
        .ok_or(KaminoRouterError::ThresholdNotMet)?;
    require!(routable_amount > 0, KaminoRouterError::ThresholdNotMet);

    let fee_amount = calculate_fee_amount(routable_amount)?;
    let deposit_amount = routable_amount
        .checked_sub(fee_amount)
        .ok_or(KaminoRouterError::Overflow)?;

    require!(
        deposit_amount >= args.minimum_deposit_amount && deposit_amount > 0,
        KaminoRouterError::RouteAmountTooSmall
    );

    if fee_amount > 0 {
        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    mint: ctx.accounts.token_mint.to_account_info(),
                    from: ctx.accounts.source_liquidity.to_account_info(),
                    to: ctx.accounts.fee_liquidity.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
            ),
            fee_amount,
            USDC_DECIMALS,
        )?;
        ctx.accounts.source_liquidity.reload()?;
    }

    let liquidity_before = ctx.accounts.source_liquidity.amount;
    let collateral_before = ctx.accounts.vault_collateral_token_account.amount;

    invoke_klend_deposit(&ctx, deposit_amount)?;

    ctx.accounts.source_liquidity.reload()?;
    ctx.accounts.vault_collateral_token_account.reload()?;

    let consumed_liquidity = liquidity_before
        .checked_sub(ctx.accounts.source_liquidity.amount)
        .ok_or(KaminoRouterError::Overflow)?;
    require!(
        consumed_liquidity == deposit_amount,
        KaminoRouterError::InvalidKaminoDeposit
    );

    let minted_collateral = ctx
        .accounts
        .vault_collateral_token_account
        .amount
        .checked_sub(collateral_before)
        .ok_or(KaminoRouterError::Overflow)?;
    require!(minted_collateral > 0, KaminoRouterError::NoCollateralMinted);

    emit!(KaminoRouteEvent {
        vault: ctx.accounts.vault.key(),
        source_liquidity: ctx.accounts.source_liquidity.key(),
        fee_liquidity: ctx.accounts.fee_liquidity.key(),
        reserve: ctx.accounts.reserve.key(),
        keep_liquidity_amount: args.keep_liquidity_amount,
        routed_amount: routable_amount,
        fee_amount,
        deposited_amount: deposit_amount,
        minted_collateral,
    });

    Ok(())
}

fn validate_lending_market_authority(actual: &Pubkey) -> Result<()> {
    let (expected, _) =
        Pubkey::find_program_address(&[b"lma", KLEND_LENDING_MARKET.as_ref()], &KLEND_PROGRAM_ID);
    require_keys_eq!(*actual, expected, KaminoRouterError::InvalidKaminoAccounts);
    Ok(())
}

fn calculate_fee_amount(amount: u64) -> Result<u64> {
    let fee = u128::from(amount)
        .checked_mul(u128::from(FEE_BASIS_POINTS))
        .ok_or(KaminoRouterError::Overflow)?
        .checked_div(u128::from(BASIS_POINTS_DENOMINATOR))
        .ok_or(KaminoRouterError::Overflow)?;
    u64::try_from(fee).map_err(|_| error!(KaminoRouterError::Overflow))
}

fn invoke_klend_deposit(ctx: &Context<RouteDeposit>, liquidity_amount: u64) -> Result<()> {
    let mut data = Vec::with_capacity(16);
    data.extend_from_slice(&KLEND_DEPOSIT_RESERVE_LIQUIDITY_DISCRIMINATOR);
    data.extend_from_slice(&liquidity_amount.to_le_bytes());

    let ix = Instruction {
        program_id: KLEND_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(ctx.accounts.vault.key(), true),
            AccountMeta::new(ctx.accounts.reserve.key(), false),
            AccountMeta::new_readonly(ctx.accounts.lending_market.key(), false),
            AccountMeta::new_readonly(ctx.accounts.lending_market_authority.key(), false),
            AccountMeta::new_readonly(ctx.accounts.token_mint.key(), false),
            AccountMeta::new(ctx.accounts.reserve_liquidity_supply.key(), false),
            AccountMeta::new(ctx.accounts.reserve_collateral_mint.key(), false),
            AccountMeta::new(ctx.accounts.source_liquidity.key(), false),
            AccountMeta::new(ctx.accounts.vault_collateral_token_account.key(), false),
            AccountMeta::new_readonly(ctx.accounts.token_program.key(), false),
            AccountMeta::new_readonly(ctx.accounts.token_program.key(), false),
            AccountMeta::new_readonly(ctx.accounts.instruction_sysvar_account.key(), false),
        ],
        data,
    };

    invoke(
        &ix,
        &[
            ctx.accounts.vault.to_account_info(),
            ctx.accounts.reserve.to_account_info(),
            ctx.accounts.lending_market.to_account_info(),
            ctx.accounts.lending_market_authority.to_account_info(),
            ctx.accounts.token_mint.to_account_info(),
            ctx.accounts.reserve_liquidity_supply.to_account_info(),
            ctx.accounts.reserve_collateral_mint.to_account_info(),
            ctx.accounts.source_liquidity.to_account_info(),
            ctx.accounts
                .vault_collateral_token_account
                .to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.instruction_sysvar_account.to_account_info(),
            ctx.accounts.klend_program.to_account_info(),
        ],
    )?;

    Ok(())
}

#[event]
pub struct KaminoRouteEvent {
    pub vault: Pubkey,
    pub source_liquidity: Pubkey,
    pub fee_liquidity: Pubkey,
    pub reserve: Pubkey,
    pub keep_liquidity_amount: u64,
    pub routed_amount: u64,
    pub fee_amount: u64,
    pub deposited_amount: u64,
    pub minted_collateral: u64,
}
