use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};

use crate::{consts::*, ModifyDeposit};

pub fn invoke_klend_deposit(ctx: &Context<ModifyDeposit>, liquidity_amount: u64) -> Result<()> {
    let mut data = Vec::with_capacity(16);
    data.extend_from_slice(&KLEND_DEPOSIT_DISCRIMINATOR);
    data.extend_from_slice(&liquidity_amount.to_le_bytes());

    let ix = Instruction {
        program_id: KLEND_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(ctx.accounts.vault.key(), true),
            AccountMeta::new(ctx.accounts.reserve.key(), false),
            AccountMeta::new_readonly(ctx.accounts.lending_market.key(), false),
            AccountMeta::new_readonly(ctx.accounts.lending_market_authority.key(), false),
            AccountMeta::new_readonly(ctx.accounts.token_mint.key(), false), // reserve_liquidity_mint
            AccountMeta::new(ctx.accounts.reserve_liquidity_supply.key(), false),
            AccountMeta::new(ctx.accounts.reserve_collateral_mint.key(), false),
            AccountMeta::new(ctx.accounts.vault_token_account.key(), false), // user_source_liquidity
            AccountMeta::new(ctx.accounts.vault_collateral_token_account.key(), false), // user_destination_collateral
            AccountMeta::new_readonly(ctx.accounts.collateral_token_program.key(), false),
            AccountMeta::new_readonly(ctx.accounts.token_program.key(), false), // liquidity_token_program
            AccountMeta::new_readonly(ctx.accounts.instruction_sysvar_account.key(), false),
        ],
        data,
    };

    let token_mint_key = ctx.accounts.token_mint.key();
    let vault_signer_seeds = &[VAULT_PDA_SEED, token_mint_key.as_ref(), &[ctx.bumps.vault]];

    invoke_signed(
        &ix,
        &[
            ctx.accounts.vault.to_account_info(),
            ctx.accounts.reserve.to_account_info(),
            ctx.accounts.lending_market.to_account_info(),
            ctx.accounts.lending_market_authority.to_account_info(),
            ctx.accounts.token_mint.to_account_info(),
            ctx.accounts.reserve_liquidity_supply.to_account_info(),
            ctx.accounts.reserve_collateral_mint.to_account_info(),
            ctx.accounts.vault_token_account.to_account_info(),
            ctx.accounts
                .vault_collateral_token_account
                .to_account_info(),
            ctx.accounts.collateral_token_program.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.instruction_sysvar_account.to_account_info(),
            ctx.accounts.klend_program.to_account_info(),
        ],
        &[vault_signer_seeds],
    )?;

    Ok(())
}

pub fn invoke_klend_redeem(ctx: &Context<ModifyDeposit>, share_amount: u64) -> Result<()> {
    let mut data = Vec::with_capacity(16);
    data.extend_from_slice(&KLEND_REDEEM_DISCRIMINATOR);
    data.extend_from_slice(&share_amount.to_le_bytes());

    let ix = Instruction {
        program_id: KLEND_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(ctx.accounts.vault.key(), true),
            AccountMeta::new_readonly(ctx.accounts.lending_market.key(), false),
            AccountMeta::new(ctx.accounts.reserve.key(), false),
            AccountMeta::new_readonly(ctx.accounts.lending_market_authority.key(), false),
            AccountMeta::new_readonly(ctx.accounts.token_mint.key(), false),
            AccountMeta::new(ctx.accounts.reserve_collateral_mint.key(), false),
            AccountMeta::new(ctx.accounts.reserve_liquidity_supply.key(), false),
            AccountMeta::new(ctx.accounts.vault_collateral_token_account.key(), false),
            AccountMeta::new(ctx.accounts.vault_token_account.key(), false),
            AccountMeta::new_readonly(ctx.accounts.collateral_token_program.key(), false),
            AccountMeta::new_readonly(ctx.accounts.token_program.key(), false),
            AccountMeta::new_readonly(ctx.accounts.instruction_sysvar_account.key(), false),
        ],
        data,
    };

    let token_mint_key = ctx.accounts.token_mint.key();
    let vault_signer_seeds = &[VAULT_PDA_SEED, token_mint_key.as_ref(), &[ctx.bumps.vault]];

    invoke_signed(
        &ix,
        &[
            ctx.accounts.vault.to_account_info(),
            ctx.accounts.lending_market.to_account_info(),
            ctx.accounts.reserve.to_account_info(),
            ctx.accounts.lending_market_authority.to_account_info(),
            ctx.accounts.token_mint.to_account_info(),
            ctx.accounts.reserve_collateral_mint.to_account_info(),
            ctx.accounts.reserve_liquidity_supply.to_account_info(),
            ctx.accounts
                .vault_collateral_token_account
                .to_account_info(),
            ctx.accounts.vault_token_account.to_account_info(),
            ctx.accounts.collateral_token_program.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.instruction_sysvar_account.to_account_info(),
            ctx.accounts.klend_program.to_account_info(),
        ],
        &[vault_signer_seeds],
    )?;

    Ok(())
}
