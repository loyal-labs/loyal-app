use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{transfer_checked, Mint, Token, TokenAccount, TransferChecked};
use ephemeral_rollups_sdk::access_control::instructions::CreatePermissionCpiBuilder;
use ephemeral_rollups_sdk::access_control::structs::{
    Member, MembersArgs, ACCOUNT_SIGNATURES_FLAG, AUTHORITY_FLAG, TX_BALANCES_FLAG, TX_LOGS_FLAG,
    TX_MESSAGE_FLAG,
};
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::commit_and_undelegate_accounts;
use session_keys::{session_auth_or, Session, SessionError, SessionToken};
use solana_hash::HASH_BYTES;
use telegram_verification::TelegramSession;

pub mod consts;
pub mod klend;

use consts::*;

declare_id!("97FzQdWi26mFNR21AbQNg4KqofiCLqQydQfAvRQMcXhV");

#[ephemeral]
#[program]
pub mod telegram_private_transfer {
    use crate::klend::{invoke_klend_deposit, invoke_klend_redeem};

    use super::*;

    /// Initializes a deposit account for a user and token mint if it does not exist.
    ///
    /// Sets up a new deposit account with zero balance for the user and token mint.
    /// If the account is already initialized, this instruction is a no-op.
    pub fn initialize_deposit(ctx: Context<InitializeDeposit>) -> Result<()> {
        let deposit = &mut ctx.accounts.deposit;

        // Only initialize if account is fresh (uninitialized)
        if deposit.user == Pubkey::default() {
            deposit.set_inner(Deposit {
                user: ctx.accounts.user.key(),
                token_mint: ctx.accounts.token_mint.key(),
                amount: 0,
            });
        }

        Ok(())
    }

    pub fn initialize_username_deposit(
        ctx: Context<InitializeUsernameDeposit>,
        username_hash: [u8; HASH_BYTES],
    ) -> Result<()> {
        let deposit = &mut ctx.accounts.deposit;

        // Only initialize if account is fresh (uninitialized)
        if deposit.token_mint == Pubkey::default() {
            deposit.token_mint = ctx.accounts.token_mint.key();
            deposit.username_hash = username_hash;
            deposit.amount = 0;
        }

        Ok(())
    }

    /// Modifies the balance of a user's deposit account by transferring tokens in or out.
    ///
    /// If `args.increase` is true, tokens are transferred from the user's token account to the deposit account.
    /// If false, tokens are transferred from the deposit account back to the user's token account.
    pub fn modify_balance(ctx: Context<ModifyDeposit>, args: ModifyDepositArgs) -> Result<()> {
        let token_program = ctx.accounts.token_program.to_account_info();
        let token_mint = ctx.accounts.token_mint.to_account_info();
        let decimals = ctx.accounts.token_mint.decimals;

        let user = ctx.accounts.user.to_account_info();
        let vault = ctx.accounts.vault.to_account_info();

        let user_token_account = ctx.accounts.user_token_account.to_account_info();

        // FIXME: validate kamino accounts
        // FIXME: ! refresh accounts after CPI

        // Checks
        let (expected_lending_market_authority, _) = Pubkey::find_program_address(
            &[b"lma", ctx.accounts.lending_market.key().as_ref()],
            &KLEND_PROGRAM_ID,
        );
        require_keys_eq!(
            ctx.accounts.lending_market_authority.key(),
            expected_lending_market_authority,
            ErrorCode::InvalidKaminoAccounts
        );

        if token_mint.key() == USDC_MINT {
            if args.increase {
                let liquidity_amount = args.amount;
                transfer_checked(
                    CpiContext::new(
                        token_program,
                        TransferChecked {
                            mint: token_mint,
                            authority: user,
                            from: user_token_account,
                            to: ctx.accounts.vault_token_account.to_account_info(),
                        },
                    ),
                    liquidity_amount,
                    decimals,
                )?;

                ctx.accounts.vault_token_account.reload()?;

                let liquidity_before = ctx.accounts.vault_token_account.amount;
                let collateral_before = ctx.accounts.vault_collateral_token_account.amount;

                invoke_klend_deposit(&ctx, liquidity_amount)?;

                ctx.accounts.vault_token_account.reload()?;
                ctx.accounts.vault_collateral_token_account.reload()?;

                let liquidity_after = ctx.accounts.vault_token_account.amount;
                let collateral_after = ctx.accounts.vault_collateral_token_account.amount;

                let consumed_liquidity = liquidity_before
                    .checked_sub(liquidity_after)
                    .ok_or(ErrorCode::Overflow)?;
                require!(
                    consumed_liquidity == liquidity_amount,
                    ErrorCode::InvalidAmount
                );

                let minted_shares = collateral_after
                    .checked_sub(collateral_before)
                    .ok_or(ErrorCode::Overflow)?;

                ctx.accounts.deposit.amount = ctx
                    .accounts
                    .deposit
                    .amount
                    .checked_add(minted_shares)
                    .ok_or(ErrorCode::Overflow)?;
            } else {
                let share_amount = args.amount;

                let liquidity_before = ctx.accounts.vault_token_account.amount;
                let collateral_before = ctx.accounts.vault_collateral_token_account.amount;

                invoke_klend_redeem(&ctx, share_amount)?;

                ctx.accounts.vault_token_account.reload()?;
                ctx.accounts.vault_collateral_token_account.reload()?;

                let liquidity_after = ctx.accounts.vault_token_account.amount;
                let collateral_after = ctx.accounts.vault_collateral_token_account.amount;

                // Assert that before/after diff is effect of klend redeem,
                // and nothing else touched these accounts.

                // Assert that klend didn't triggered any pre/post hooks
                // that could affect liquidity calculations here.

                let returned_liquidity = liquidity_after
                    .checked_sub(liquidity_before)
                    .ok_or(ErrorCode::Overflow)?;

                let burned_shares = collateral_before
                    .checked_sub(collateral_after)
                    .ok_or(ErrorCode::Overflow)?;
                require!(burned_shares == share_amount, ErrorCode::InvalidAmount);

                let seeds = [
                    VAULT_PDA_SEED,
                    &token_mint.key.to_bytes(),
                    &[ctx.bumps.vault],
                ];
                let signer_seeds = &[&seeds[..]];
                transfer_checked(
                    CpiContext::new_with_signer(
                        token_program,
                        TransferChecked {
                            mint: token_mint,
                            authority: vault,
                            from: ctx.accounts.vault_token_account.to_account_info(),
                            to: user_token_account,
                        },
                        signer_seeds,
                    ),
                    returned_liquidity,
                    decimals,
                )?;
                ctx.accounts.deposit.amount = ctx
                    .accounts
                    .deposit
                    .amount
                    .checked_sub(burned_shares)
                    .ok_or(ErrorCode::InsufficientDeposit)?;
            }
        } else {
            let deposit = &mut ctx.accounts.deposit;
            let vault_token_account = ctx.accounts.vault_token_account.to_account_info();

            if args.increase {
                transfer_checked(
                    CpiContext::new(
                        token_program,
                        TransferChecked {
                            mint: token_mint,
                            authority: user,
                            from: user_token_account,
                            to: vault_token_account,
                        },
                    ),
                    args.amount,
                    decimals,
                )?;
                deposit.amount = deposit
                    .amount
                    .checked_add(args.amount)
                    .ok_or(ErrorCode::Overflow)?;
            } else {
                let seeds = [
                    VAULT_PDA_SEED,
                    &token_mint.key.to_bytes(),
                    &[ctx.bumps.vault],
                ];
                let signer_seeds = &[&seeds[..]];
                transfer_checked(
                    CpiContext::new_with_signer(
                        token_program,
                        TransferChecked {
                            mint: token_mint,
                            authority: vault,
                            from: vault_token_account,
                            to: user_token_account,
                        },
                        signer_seeds,
                    ),
                    args.amount,
                    decimals,
                )?;
                deposit.amount = deposit
                    .amount
                    .checked_sub(args.amount)
                    .ok_or(ErrorCode::InsufficientDeposit)?;
            }
        }

        Ok(())
    }

    /// Claim tokens and transfer from username deposit to deposit
    pub fn claim_username_deposit_to_deposit(
        ctx: Context<ClaimUsernameDepositToDeposit>,
        amount: u64,
    ) -> Result<()> {
        let source_username_deposit = &mut ctx.accounts.source_username_deposit;
        let destination_deposit = &mut ctx.accounts.destination_deposit;
        let session = &ctx.accounts.session;

        require!(session.verified, ErrorCode::NotVerified);
        require!(
            session.username_hash == source_username_deposit.username_hash,
            ErrorCode::InvalidUsername
        );
        require!(
            source_username_deposit.amount >= amount,
            ErrorCode::InsufficientDeposit
        );

        source_username_deposit.amount = source_username_deposit
            .amount
            .checked_sub(amount)
            .ok_or(ErrorCode::InsufficientDeposit)?;
        destination_deposit.amount = destination_deposit
            .amount
            .checked_add(amount)
            .ok_or(ErrorCode::Overflow)?;

        Ok(())
    }

    /// Transfers a specified amount from one user's deposit account to another's for the same token mint.
    ///
    /// Only updates the internal accounting; does not move actual tokens.
    #[session_auth_or(
        ctx.accounts.user.key() == ctx.accounts.source_deposit.user,
        ErrorCode::Unauthorized
    )]
    pub fn transfer_deposit(ctx: Context<TransferDeposit>, amount: u64) -> Result<()> {
        let source_deposit = &mut ctx.accounts.source_deposit;
        let destination_deposit = &mut ctx.accounts.destination_deposit;

        source_deposit.amount = source_deposit
            .amount
            .checked_sub(amount)
            .ok_or(ErrorCode::InsufficientDeposit)?;
        destination_deposit.amount = destination_deposit
            .amount
            .checked_add(amount)
            .ok_or(ErrorCode::Overflow)?;

        Ok(())
    }

    /// Transfers a specified amount from a user's deposit account to a username-based deposit.
    ///
    /// Only updates the internal accounting; does not move actual tokens.
    #[session_auth_or(
        ctx.accounts.user.key() == ctx.accounts.source_deposit.user,
        ErrorCode::Unauthorized
    )]
    pub fn transfer_to_username_deposit(
        ctx: Context<TransferToUsernameDeposit>,
        amount: u64,
    ) -> Result<()> {
        let source_deposit = &mut ctx.accounts.source_deposit;
        let destination_deposit = &mut ctx.accounts.destination_deposit;

        source_deposit.amount = source_deposit
            .amount
            .checked_sub(amount)
            .ok_or(ErrorCode::InsufficientDeposit)?;
        destination_deposit.amount = destination_deposit
            .amount
            .checked_add(amount)
            .ok_or(ErrorCode::Overflow)?;

        Ok(())
    }

    /// Creates a permission for a deposit account using the external permission program.
    ///
    /// Calls out to the permission program to create a permission for the deposit account.
    pub fn create_permission(ctx: Context<CreatePermission>) -> Result<()> {
        let CreatePermission {
            payer,
            permission,
            permission_program,
            deposit,
            user,
            system_program,
        } = ctx.accounts;

        // Whitelist programs allowed to use the permission account.
        // The owner program is added by default to prevent bricking the account.
        let flags = AUTHORITY_FLAG
            | TX_LOGS_FLAG
            | TX_BALANCES_FLAG
            | TX_MESSAGE_FLAG
            | ACCOUNT_SIGNATURES_FLAG;
        let members = vec![Member {
            pubkey: user.key(),
            flags,
        }];
        CreatePermissionCpiBuilder::new(&permission_program)
            .permission(&permission)
            .permissioned_account(&deposit.to_account_info())
            .payer(&payer)
            .system_program(system_program)
            .args(MembersArgs {
                members: Some(members),
            })
            .invoke_signed(&[&[
                DEPOSIT_PDA_SEED,
                user.key().as_ref(),
                deposit.token_mint.as_ref(),
                &[ctx.bumps.deposit],
            ]])?;

        Ok(())
    }

    /// Creates a permission for a username-based deposit account.
    pub fn create_username_permission(ctx: Context<CreateUsernamePermission>) -> Result<()> {
        let CreateUsernamePermission {
            payer,
            authority,
            session,
            permission,
            permission_program,
            deposit,
            system_program,
        } = ctx.accounts;

        require!(session.verified, ErrorCode::NotVerified);
        require!(
            session.username_hash == deposit.username_hash,
            ErrorCode::InvalidUsername
        );
        require_keys_eq!(
            session.user_wallet,
            authority.key(),
            ErrorCode::Unauthorized
        );

        let flags = AUTHORITY_FLAG
            | TX_LOGS_FLAG
            | TX_BALANCES_FLAG
            | TX_MESSAGE_FLAG
            | ACCOUNT_SIGNATURES_FLAG;
        let members = vec![Member {
            pubkey: authority.key(),
            flags,
        }];
        CreatePermissionCpiBuilder::new(&permission_program)
            .permission(&permission)
            .permissioned_account(&deposit.to_account_info())
            .payer(&payer)
            .system_program(system_program)
            .args(MembersArgs {
                members: Some(members),
            })
            .invoke_signed(&[&[
                USERNAME_DEPOSIT_PDA_SEED,
                &deposit.username_hash,
                deposit.token_mint.as_ref(),
                &[ctx.bumps.deposit],
            ]])?;

        Ok(())
    }

    /// Delegates the deposit account to the ephemeral rollups delegate program.
    ///
    /// Uses the ephemeral rollups delegate CPI to delegate the deposit account.
    pub fn delegate(ctx: Context<DelegateDeposit>, user: Pubkey, token_mint: Pubkey) -> Result<()> {
        let validator = ctx.accounts.validator.as_ref().map(|v| v.key());
        ctx.accounts.delegate_deposit(
            &ctx.accounts.payer,
            &[DEPOSIT_PDA_SEED, user.as_ref(), token_mint.as_ref()],
            DelegateConfig {
                validator,
                commit_frequency_ms: 0,
            },
        )?;
        Ok(())
    }

    /// Delegates the username-based deposit account to the ephemeral rollups delegate program.
    pub fn delegate_username_deposit(
        ctx: Context<DelegateUsernameDeposit>,
        username_hash: [u8; HASH_BYTES],
        token_mint: Pubkey,
    ) -> Result<()> {
        // TODO(zotho): uncomment when decided how to allow sender to create recepient's deposit
        // require!(ctx.accounts.session.verified, ErrorCode::NotVerified);
        // require!(
        //     ctx.accounts.session.username_hash == username_hash,
        //     ErrorCode::InvalidUsername
        // );
        // require_keys_eq!(
        //     ctx.accounts.session.user_wallet,
        //     ctx.accounts.payer.key(),
        //     ErrorCode::Unauthorized
        // );
        let validator = ctx.accounts.validator.as_ref().map(|v| v.key());
        ctx.accounts.delegate_deposit(
            &ctx.accounts.payer,
            &[
                USERNAME_DEPOSIT_PDA_SEED,
                &username_hash,
                token_mint.as_ref(),
            ],
            DelegateConfig {
                validator,
                commit_frequency_ms: 0,
            },
        )?;
        Ok(())
    }

    /// Commits and undelegates the deposit account from the ephemeral rollups program.
    ///
    /// Uses the ephemeral rollups SDK to commit and undelegate the deposit account.
    #[session_auth_or(
        ctx.accounts.user.key() == ctx.accounts.deposit.user,
        ErrorCode::Unauthorized
    )]
    pub fn undelegate(ctx: Context<UndelegateDeposit>) -> Result<()> {
        commit_and_undelegate_accounts(
            &ctx.accounts.payer,
            vec![&ctx.accounts.deposit.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;
        Ok(())
    }

    /// Commits and undelegates the username-based deposit account from the ephemeral rollups program.
    pub fn undelegate_username_deposit(
        ctx: Context<UndelegateUsernameDeposit>,
        username_hash: [u8; HASH_BYTES],
        token_mint: Pubkey,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.deposit.key(),
            Pubkey::create_program_address(
                &[
                    USERNAME_DEPOSIT_PDA_SEED,
                    &username_hash,
                    token_mint.as_ref(),
                    &[ctx.bumps.deposit]
                ],
                ctx.program_id
            )
            .map_err(|_| error!(ErrorCode::InvalidUsername))?,
            ErrorCode::InvalidUsername
        );
        commit_and_undelegate_accounts(
            &ctx.accounts.payer,
            vec![&ctx.accounts.deposit.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;
        Ok(())
    }
}

// ---------------- Accounts ----------------
#[derive(Accounts)]
pub struct InitializeDeposit<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Anyone can initialize the deposit
    pub user: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Deposit::INIT_SPACE,
        seeds = [DEPOSIT_PDA_SEED, user.key().as_ref(), token_mint.key().as_ref()],
        bump
    )]
    pub deposit: Account<'info, Deposit>,
    pub token_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(username_hash: [u8; HASH_BYTES])]
pub struct InitializeUsernameDeposit<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + UsernameDeposit::INIT_SPACE,
        seeds = [
            USERNAME_DEPOSIT_PDA_SEED,
            &username_hash,
            token_mint.key().as_ref()
        ],
        bump
    )]
    pub deposit: Account<'info, UsernameDeposit>,
    pub token_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct ModifyDepositArgs {
    pub amount: u64,
    pub increase: bool,
}

#[derive(Accounts)]
pub struct ModifyDeposit<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub user: Signer<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Vault::INIT_SPACE,
        seeds = [VAULT_PDA_SEED, deposit.token_mint.as_ref()],
        bump,
    )]
    pub vault: Account<'info, Vault>,
    #[account(
        mut,
        seeds = [DEPOSIT_PDA_SEED, deposit.user.as_ref(), deposit.token_mint.as_ref()],
        bump,
        has_one = user,
        has_one = token_mint,
    )]
    pub deposit: Account<'info, Deposit>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = token_mint,
        associated_token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = token_mint,
        associated_token::authority = vault,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    pub token_mint: Account<'info, Mint>,

    // Lending
    /// CHECK: Fixed KLend lending market address
    #[account(address = KLEND_LENDING_MARKET)]
    pub lending_market: UncheckedAccount<'info>,

    /// CHECK: Derived PDA validated at runtime
    pub lending_market_authority: UncheckedAccount<'info>,

    /// CHECK: Fixed KLend reserve address
    #[account(mut, address = KLEND_RESERVE)]
    pub reserve: UncheckedAccount<'info>,
    /// CHECK: Fixed KLend reserve liquidity supply address
    #[account(mut, address = KLEND_RESERVE_LIQUIDITY_SUPPLY)]
    pub reserve_liquidity_supply: UncheckedAccount<'info>,
    /// CHECK: Fixed KLend reserve collateral mint address
    #[account(mut, address = KLEND_RESERVE_COLLATERAL_MINT)]
    pub reserve_collateral_mint: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = reserve_collateral_mint,
        associated_token::authority = vault,
        associated_token::token_program = collateral_token_program,
    )]
    pub vault_collateral_token_account: Account<'info, TokenAccount>,

    /// CHECK: Fixed instructions sysvar address
    #[account(address = sysvar::instructions::ID)]
    pub instruction_sysvar_account: UncheckedAccount<'info>,

    /// CHECK: Fixed KLend program address
    #[account(address = KLEND_PROGRAM_ID)]
    pub klend_program: UncheckedAccount<'info>,
    /// cToken token program address
    pub collateral_token_program: Program<'info, Token>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimUsernameDepositToDeposit<'info> {
    /// CHECK: Matched against the deposit account
    pub user: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [USERNAME_DEPOSIT_PDA_SEED, &source_username_deposit.username_hash, source_username_deposit.token_mint.as_ref()],
        bump,
        has_one = token_mint,
    )]
    pub source_username_deposit: Account<'info, UsernameDeposit>,
    #[account(
        mut,
        seeds = [
            DEPOSIT_PDA_SEED,
            destination_deposit.user.as_ref(),
            destination_deposit.token_mint.as_ref()
        ],
        bump,
        has_one = user,
        has_one = token_mint,
    )]
    pub destination_deposit: Account<'info, Deposit>,
    pub token_mint: Account<'info, Mint>,
    #[account(
        constraint = session.user_wallet == destination_deposit.user @ ErrorCode::InvalidRecipient,
        constraint = session.verified @ ErrorCode::NotVerified,
        constraint = session.username_hash == source_username_deposit.username_hash @ ErrorCode::InvalidUsername,
    )]
    pub session: Account<'info, TelegramSession>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts, Session)]
pub struct TransferDeposit<'info> {
    /// CHECK: Matched against the deposit account
    pub user: AccountInfo<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[session(
        signer = payer,
        authority = user.key()
    )]
    pub session_token: Option<Account<'info, SessionToken>>,
    #[account(
        mut,
        seeds = [
            DEPOSIT_PDA_SEED,
            source_deposit.user.as_ref(),
            source_deposit.token_mint.as_ref()
        ],
        bump,
        has_one = user,
        has_one = token_mint,
        constraint = source_deposit.user != destination_deposit.user,
    )]
    pub source_deposit: Account<'info, Deposit>,
    #[account(
        mut,
        seeds = [
            DEPOSIT_PDA_SEED,
            destination_deposit.user.as_ref(),
            destination_deposit.token_mint.as_ref()
        ],
        bump,
        has_one = token_mint,
    )]
    pub destination_deposit: Account<'info, Deposit>,
    pub token_mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts, Session)]
pub struct TransferToUsernameDeposit<'info> {
    /// CHECK: Matched against the deposit account
    pub user: AccountInfo<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[session(
        signer = payer,
        authority = user.key()
    )]
    pub session_token: Option<Account<'info, SessionToken>>,
    #[account(
        mut,
        seeds = [
            DEPOSIT_PDA_SEED,
            source_deposit.user.as_ref(),
            source_deposit.token_mint.as_ref()
        ],
        bump,
        has_one = user,
        has_one = token_mint,
    )]
    pub source_deposit: Account<'info, Deposit>,
    #[account(
        mut,
        seeds = [
            USERNAME_DEPOSIT_PDA_SEED,
            &destination_deposit.username_hash,
            destination_deposit.token_mint.as_ref()
        ],
        bump,
        has_one = token_mint,
    )]
    pub destination_deposit: Account<'info, UsernameDeposit>,
    pub token_mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreatePermission<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub user: Signer<'info>,
    #[account(
        seeds = [DEPOSIT_PDA_SEED, user.key().as_ref(), deposit.token_mint.as_ref()],
        bump
    )]
    pub deposit: Account<'info, Deposit>,
    /// CHECK: Checked by the permission program
    #[account(mut)]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: Checked by the permission program
    pub permission_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateUsernamePermission<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub authority: Signer<'info>,
    #[account(
        seeds = [
            USERNAME_DEPOSIT_PDA_SEED,
            &deposit.username_hash,
            deposit.token_mint.as_ref()
        ],
        bump
    )]
    pub deposit: Account<'info, UsernameDeposit>,
    #[account(
        constraint = session.user_wallet == authority.key() @ ErrorCode::Unauthorized,
        constraint = session.verified @ ErrorCode::NotVerified,
        constraint = session.username_hash == deposit.username_hash @ ErrorCode::InvalidUsername,
    )]
    pub session: Account<'info, TelegramSession>,
    /// CHECK: Checked by the permission program
    #[account(mut)]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: Checked by the permission program
    pub permission_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(user: Pubkey, token_mint: Pubkey)]
pub struct DelegateDeposit<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Checked by the delegate program
    pub validator: Option<AccountInfo<'info>>,
    /// CHECK: Checked counter accountby the delegate program
    #[account(
        mut,
        del,
        seeds = [DEPOSIT_PDA_SEED, user.as_ref(), token_mint.as_ref()],
        bump,
    )]
    pub deposit: AccountInfo<'info>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(username_hash: [u8; HASH_BYTES], token_mint: Pubkey)]
pub struct DelegateUsernameDeposit<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Checked by the delegate program
    pub validator: Option<AccountInfo<'info>>,
    // TODO(zotho): uncomment when decided how to allow sender to create recepient's deposit
    // #[account(
    //     constraint = session.user_wallet == payer.key() @ ErrorCode::Unauthorized,
    //     constraint = session.verified @ ErrorCode::NotVerified,
    //     constraint = session.username_hash == username_hash @ ErrorCode::InvalidUsername,
    // )]
    // pub session: Account<'info, TelegramSession>,
    /// CHECK: Checked by the delegate program
    #[account(
        mut,
        del,
        seeds = [USERNAME_DEPOSIT_PDA_SEED, &username_hash, token_mint.as_ref()],
        bump,
    )]
    pub deposit: AccountInfo<'info>,
}

#[commit]
#[derive(Accounts, Session)]
pub struct UndelegateDeposit<'info> {
    /// CHECK: Matched against the deposit account
    pub user: AccountInfo<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[session(
        signer = payer,
        authority = user.key()
    )]
    pub session_token: Option<Account<'info, SessionToken>>,
    #[account(
        mut,
        seeds = [DEPOSIT_PDA_SEED, user.key().as_ref(), deposit.token_mint.as_ref()],
        bump
    )]
    pub deposit: Account<'info, Deposit>,
}

#[commit]
#[derive(Accounts)]
#[instruction(username_hash: [u8; HASH_BYTES], token_mint: Pubkey)]
pub struct UndelegateUsernameDeposit<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        constraint = session.user_wallet == payer.key() @ ErrorCode::Unauthorized,
        constraint = session.verified @ ErrorCode::NotVerified,
        constraint = session.username_hash == username_hash @ ErrorCode::InvalidUsername,
    )]
    pub session: Account<'info, TelegramSession>,
    /// CHECK: Delegated account (owned by delegation program)
    #[account(
        mut,
        seeds = [
            USERNAME_DEPOSIT_PDA_SEED,
            &username_hash,
            token_mint.as_ref()
        ],
        bump
    )]
    pub deposit: AccountInfo<'info>,
}

// ---------------- State ----------------

/// A deposit account for a user and token mint.
#[account]
#[derive(InitSpace)]
pub struct Deposit {
    pub user: Pubkey,
    pub token_mint: Pubkey,
    pub amount: u64,
}

/// A deposit account for a telegram username sha256 hash and token mint.
#[account]
#[derive(InitSpace)]
pub struct UsernameDeposit {
    pub username_hash: [u8; HASH_BYTES],
    pub token_mint: Pubkey,
    pub amount: u64,
}

/// A vault storing deposited tokens.
/// Has a dummy field because Anchor requires it.
#[account]
#[derive(InitSpace)]
pub struct Vault {
    _dummy: u8,
}

// ---------------- Error Codes ----------------
#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Overflow")]
    Overflow,
    #[msg("Invalid Mint")]
    InvalidMint,
    #[msg("Insufficient Vault")]
    InsufficientVault,
    #[msg("Insufficient Deposit")]
    InsufficientDeposit,
    #[msg("Not Verified")]
    NotVerified,
    #[msg("Expired Signature")]
    ExpiredSignature,
    #[msg("Replay")]
    Replay,
    #[msg("Invalid Ed25519")]
    InvalidEd25519,
    #[msg("Invalid Username")]
    InvalidUsername,
    #[msg("Invalid Recipient")]
    InvalidRecipient,
    #[msg("Invalid Depositor")]
    InvalidDepositor,
    #[msg("Invalid Kamino accounts")]
    InvalidKaminoAccounts,
    #[msg("Invalid amount")]
    InvalidAmount,
}
