use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};

use crate::{constants::*, KaminoRouteCrankError};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CrankRouteArgs {
    pub account_index: u8,
    pub policy_payload: Vec<u8>,
}

#[derive(Accounts)]
pub struct CrankRoute<'info> {
    /// CHECK: Squads validates this as a consensus account.
    #[account(mut)]
    pub policy: UncheckedAccount<'info>,
    /// CHECK: PDA signer registered as a signer on the target policy.
    #[account(seeds = [CRANK_AUTHORITY_SEED, policy.key().as_ref()], bump)]
    pub crank_authority: UncheckedAccount<'info>,
    /// CHECK: Pinned to the Squads smart-account program.
    #[account(address = SQUADS_SMART_ACCOUNT_PROGRAM_ID)]
    pub smart_account_program: UncheckedAccount<'info>,
}

pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, CrankRoute<'info>>,
    args: CrankRouteArgs,
) -> Result<()> {
    require!(
        !args.policy_payload.is_empty(),
        KaminoRouteCrankError::InvalidPolicyPayload
    );
    require!(
        args.policy_payload.len() <= MAX_POLICY_PAYLOAD_LEN,
        KaminoRouteCrankError::PolicyPayloadTooLarge
    );

    let mut data = Vec::with_capacity(8 + 2 + 1 + args.policy_payload.len());
    data.extend_from_slice(&EXECUTE_TRANSACTION_SYNC_V2_DISCRIMINATOR);
    data.push(args.account_index);
    data.push(1);
    data.push(SYNC_PAYLOAD_POLICY_VARIANT);
    data.extend_from_slice(&args.policy_payload);

    let mut accounts = Vec::with_capacity(3 + ctx.remaining_accounts.len());
    accounts.push(AccountMeta::new(ctx.accounts.policy.key(), false));
    accounts.push(AccountMeta::new_readonly(
        ctx.accounts.smart_account_program.key(),
        false,
    ));
    accounts.push(AccountMeta::new_readonly(
        ctx.accounts.crank_authority.key(),
        true,
    ));
    accounts.extend(ctx.remaining_accounts.iter().map(|account| {
        if account.is_writable {
            AccountMeta::new(account.key(), account.is_signer)
        } else {
            AccountMeta::new_readonly(account.key(), account.is_signer)
        }
    }));

    let instruction = Instruction {
        program_id: ctx.accounts.smart_account_program.key(),
        accounts,
        data,
    };

    let policy_key = ctx.accounts.policy.key();
    let signer_seeds: &[&[u8]] = &[
        CRANK_AUTHORITY_SEED,
        policy_key.as_ref(),
        &[ctx.bumps.crank_authority],
    ];

    let mut account_infos = Vec::with_capacity(3 + ctx.remaining_accounts.len());
    account_infos.push(ctx.accounts.policy.to_account_info());
    account_infos.push(ctx.accounts.smart_account_program.to_account_info());
    account_infos.push(ctx.accounts.crank_authority.to_account_info());
    account_infos.extend(ctx.remaining_accounts.iter().cloned());

    invoke_signed(&instruction, &account_infos, &[signer_seeds])?;

    Ok(())
}
