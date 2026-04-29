use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};
use anchor_spl::{
    associated_token::{create_idempotent, get_associated_token_address_with_program_id, Create},
    token::accessor,
};

use crate::{consts::*, ErrorCode, ModifyDeposit};

pub struct KlendAccounts<'info> {
    pub lending_market: AccountInfo<'info>,
    pub lending_market_authority: AccountInfo<'info>,
    pub reserve: AccountInfo<'info>,
    pub reserve_liquidity_supply: AccountInfo<'info>,
    pub reserve_collateral_mint: AccountInfo<'info>,
    pub vault_collateral_token_account: AccountInfo<'info>,
    pub instruction_sysvar_account: AccountInfo<'info>,
    pub klend_program: AccountInfo<'info>,
}

impl<'info> KlendAccounts<'info> {
    pub fn try_from_remaining_accounts(accounts: &[AccountInfo<'info>]) -> Result<Self> {
        let [
            lending_market,
            lending_market_authority,
            reserve,
            reserve_liquidity_supply,
            reserve_collateral_mint,
            vault_collateral_token_account,
            instruction_sysvar_account,
            klend_program,
        ] = accounts
        else {
            return err!(ErrorCode::InvalidKaminoAccounts);
        };

        Ok(Self {
            lending_market: lending_market.clone(),
            lending_market_authority: lending_market_authority.clone(),
            reserve: reserve.clone(),
            reserve_liquidity_supply: reserve_liquidity_supply.clone(),
            reserve_collateral_mint: reserve_collateral_mint.clone(),
            vault_collateral_token_account: vault_collateral_token_account.clone(),
            instruction_sysvar_account: instruction_sysvar_account.clone(),
            klend_program: klend_program.clone(),
        })
    }

    pub fn validate(
        &self,
        vault: &AccountInfo<'info>,
        token_program: &AccountInfo<'info>,
    ) -> Result<()> {
        require_keys_eq!(
            self.lending_market.key(),
            KLEND_LENDING_MARKET,
            ErrorCode::InvalidKaminoAccounts
        );

        let lending_market_key = self.lending_market.key();
        let (expected_lending_market_authority, _) =
            Pubkey::find_program_address(&[b"lma", lending_market_key.as_ref()], &KLEND_PROGRAM_ID);
        require_keys_eq!(
            self.lending_market_authority.key(),
            expected_lending_market_authority,
            ErrorCode::InvalidKaminoAccounts
        );
        require_keys_eq!(
            self.reserve.key(),
            KLEND_RESERVE,
            ErrorCode::InvalidKaminoAccounts
        );
        require_keys_eq!(
            self.reserve_liquidity_supply.key(),
            KLEND_RESERVE_LIQUIDITY_SUPPLY,
            ErrorCode::InvalidKaminoAccounts
        );
        require_keys_eq!(
            self.reserve_collateral_mint.key(),
            KLEND_RESERVE_COLLATERAL_MINT,
            ErrorCode::InvalidKaminoAccounts
        );

        let expected_vault_collateral_token_account = get_associated_token_address_with_program_id(
            vault.key,
            self.reserve_collateral_mint.key,
            token_program.key,
        );
        require_keys_eq!(
            self.vault_collateral_token_account.key(),
            expected_vault_collateral_token_account,
            ErrorCode::InvalidKaminoAccounts
        );
        require_keys_eq!(
            self.instruction_sysvar_account.key(),
            sysvar::instructions::ID,
            ErrorCode::InvalidKaminoAccounts
        );
        require_keys_eq!(
            self.klend_program.key(),
            KLEND_PROGRAM_ID,
            ErrorCode::InvalidKaminoAccounts
        );

        Ok(())
    }

    pub fn ensure_vault_collateral_token_account(
        &self,
        ctx: &Context<'_, '_, '_, 'info, ModifyDeposit<'info>>,
    ) -> Result<()> {
        create_idempotent(CpiContext::new(
            ctx.accounts.associated_token_program.to_account_info(),
            Create {
                payer: ctx.accounts.payer.to_account_info(),
                associated_token: self.vault_collateral_token_account.clone(),
                authority: ctx.accounts.vault.to_account_info(),
                mint: self.reserve_collateral_mint.clone(),
                system_program: ctx.accounts.system_program.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            },
        ))
    }

    pub fn vault_collateral_amount(&self) -> Result<u64> {
        accessor::amount(&self.vault_collateral_token_account)
    }
}

pub fn invoke_klend_deposit<'info>(
    ctx: &Context<'_, '_, '_, 'info, ModifyDeposit<'info>>,
    klend_accounts: &KlendAccounts<'info>,
    liquidity_amount: u64,
) -> Result<()> {
    let mut data = Vec::with_capacity(16);
    data.extend_from_slice(&KLEND_DEPOSIT_DISCRIMINATOR);
    data.extend_from_slice(&liquidity_amount.to_le_bytes());

    let token_program = ctx.accounts.token_program.to_account_info();

    let ix = Instruction {
        program_id: KLEND_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(ctx.accounts.vault.key(), true),
            AccountMeta::new(klend_accounts.reserve.key(), false),
            AccountMeta::new_readonly(klend_accounts.lending_market.key(), false),
            AccountMeta::new_readonly(klend_accounts.lending_market_authority.key(), false),
            AccountMeta::new_readonly(ctx.accounts.token_mint.key(), false), // reserve_liquidity_mint
            AccountMeta::new(klend_accounts.reserve_liquidity_supply.key(), false),
            AccountMeta::new(klend_accounts.reserve_collateral_mint.key(), false),
            AccountMeta::new(ctx.accounts.vault_token_account.key(), false), // user_source_liquidity
            AccountMeta::new(klend_accounts.vault_collateral_token_account.key(), false),
            AccountMeta::new_readonly(token_program.key(), false), // collateral_token_program
            AccountMeta::new_readonly(token_program.key(), false), // liquidity_token_program
            AccountMeta::new_readonly(klend_accounts.instruction_sysvar_account.key(), false),
        ],
        data,
    };

    let token_mint_key = ctx.accounts.token_mint.key();
    let vault_signer_seeds = &[VAULT_PDA_SEED, token_mint_key.as_ref(), &[ctx.bumps.vault]];

    invoke_signed(
        &ix,
        &[
            ctx.accounts.vault.to_account_info(),
            klend_accounts.reserve.clone(),
            klend_accounts.lending_market.clone(),
            klend_accounts.lending_market_authority.clone(),
            ctx.accounts.token_mint.to_account_info(),
            klend_accounts.reserve_liquidity_supply.clone(),
            klend_accounts.reserve_collateral_mint.clone(),
            ctx.accounts.vault_token_account.to_account_info(),
            klend_accounts.vault_collateral_token_account.clone(),
            token_program.clone(),
            token_program.clone(),
            klend_accounts.instruction_sysvar_account.clone(),
            klend_accounts.klend_program.clone(),
        ],
        &[vault_signer_seeds],
    )?;

    Ok(())
}

pub fn invoke_klend_redeem<'info>(
    ctx: &Context<'_, '_, '_, 'info, ModifyDeposit<'info>>,
    klend_accounts: &KlendAccounts<'info>,
    share_amount: u64,
) -> Result<()> {
    let mut data = Vec::with_capacity(16);
    data.extend_from_slice(&KLEND_REDEEM_DISCRIMINATOR);
    data.extend_from_slice(&share_amount.to_le_bytes());

    let token_program = ctx.accounts.token_program.to_account_info();

    let ix = Instruction {
        program_id: KLEND_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(ctx.accounts.vault.key(), true),
            AccountMeta::new_readonly(klend_accounts.lending_market.key(), false),
            AccountMeta::new(klend_accounts.reserve.key(), false),
            AccountMeta::new_readonly(klend_accounts.lending_market_authority.key(), false),
            AccountMeta::new_readonly(ctx.accounts.token_mint.key(), false),
            AccountMeta::new(klend_accounts.reserve_collateral_mint.key(), false),
            AccountMeta::new(klend_accounts.reserve_liquidity_supply.key(), false),
            AccountMeta::new(klend_accounts.vault_collateral_token_account.key(), false),
            AccountMeta::new(ctx.accounts.vault_token_account.key(), false),
            AccountMeta::new_readonly(token_program.key(), false), // collateral_token_program
            AccountMeta::new_readonly(token_program.key(), false), // liquidity_token_program
            AccountMeta::new_readonly(klend_accounts.instruction_sysvar_account.key(), false),
        ],
        data,
    };

    let token_mint_key = ctx.accounts.token_mint.key();
    let vault_signer_seeds = &[VAULT_PDA_SEED, token_mint_key.as_ref(), &[ctx.bumps.vault]];

    invoke_signed(
        &ix,
        &[
            ctx.accounts.vault.to_account_info(),
            klend_accounts.lending_market.clone(),
            klend_accounts.reserve.clone(),
            klend_accounts.lending_market_authority.clone(),
            ctx.accounts.token_mint.to_account_info(),
            klend_accounts.reserve_collateral_mint.clone(),
            klend_accounts.reserve_liquidity_supply.clone(),
            klend_accounts.vault_collateral_token_account.clone(),
            ctx.accounts.vault_token_account.to_account_info(),
            token_program.clone(),
            token_program.clone(),
            klend_accounts.instruction_sysvar_account.clone(),
            klend_accounts.klend_program.clone(),
        ],
        &[vault_signer_seeds],
    )?;

    Ok(())
}
