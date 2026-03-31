use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
    sysvar,
};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};
use ephemeral_rollups_sdk::access_control::instructions::CreatePermissionCpiBuilder;
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::commit_and_undelegate_accounts;
use session_keys::{session_auth_or, Session, SessionError, SessionToken};
use telegram_verification::TelegramSession;

declare_id!("97FzQdWi26mFNR21AbQNg4KqofiCLqQydQfAvRQMcXhV");

// Seed constants
pub const DEPOSIT_PDA_SEED: &[u8] = b"deposit_v2";
pub const USERNAME_DEPOSIT_PDA_SEED: &[u8] = b"username_deposit";
pub const VAULT_PDA_SEED: &[u8] = b"vault";

const MIN_USERNAME_LEN: usize = 5;
const MAX_USERNAME_LEN: usize = 32;
const KLEND_DEPOSIT_DISCRIMINATOR: [u8; 8] = [169, 201, 30, 126, 6, 205, 102, 68];
const KLEND_REDEEM_DISCRIMINATOR: [u8; 8] = [234, 117, 181, 125, 185, 142, 220, 29];

pub const KLEND_PROGRAM_ID: Pubkey = pubkey!("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
pub const MAIN_MARKET: Pubkey = pubkey!("7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF");
pub const MAIN_ALT_MARKET: Pubkey = pubkey!("CqAoLuqWtavaVE8deBjMKe8ZfSt9ghR6Vb8nfsyabyHA");
pub const SOL_MINT: Pubkey = pubkey!("So11111111111111111111111111111111111111112");
pub const USDC_MINT: Pubkey = pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
pub const USDT_MINT: Pubkey = pubkey!("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
pub const SOL_RESERVE: Pubkey = pubkey!("d4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q");
pub const USDC_RESERVE: Pubkey = pubkey!("9GJ9GBRwCp4pHmWrQ43L5xpc9Vykg7jnfwcFGN8FoHYu");
pub const USDT_RESERVE: Pubkey = pubkey!("H3t6qZ1JkguCNTi9uzVKqQ7dvt2cum4XiXWom6Gn5e5S");

#[ephemeral]
#[program]
pub mod telegram_private_transfer {
    use anchor_spl::token::{transfer_checked, TransferChecked};
    use ephemeral_rollups_sdk::access_control::structs::{
        Member, MembersArgs, ACCOUNT_SIGNATURES_FLAG, AUTHORITY_FLAG, TX_BALANCES_FLAG,
        TX_LOGS_FLAG, TX_MESSAGE_FLAG,
    };

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
        username: String,
    ) -> Result<()> {
        validate_username(&username)?;

        let deposit = &mut ctx.accounts.deposit;

        // Only initialize if account is fresh (uninitialized)
        if deposit.token_mint == Pubkey::default() {
            deposit.token_mint = ctx.accounts.token_mint.key();
            deposit.username = username.clone();
            deposit.amount = 0;
        }

        Ok(())
    }

    /// Modifies the balance of a user's deposit account by transferring tokens in or out.
    ///
    /// Deposits use `liquidity_amount` as exact underlying input and `share_amount` as minimum shares out.
    /// Withdrawals use `share_amount` as exact shares in and `liquidity_amount` as minimum underlying out.
    pub fn modify_balance(ctx: Context<ModifyDeposit>, args: ModifyDepositArgs) -> Result<()> {
        let kamino_config = supported_kamino_config(&ctx.accounts.token_mint.key())?;
        validate_kamino_accounts(&ctx, &kamino_config)?;
        initialize_vault_if_needed(
            &mut ctx.accounts.vault,
            ctx.accounts.token_mint.key(),
            ctx.accounts.reserve_collateral_mint.key(),
            &kamino_config,
        )?;

        if args.increase {
            let reserve_supply_before = ctx.accounts.reserve_liquidity_supply.amount;
            transfer_checked(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.user_token_account.to_account_info(),
                        mint: ctx.accounts.token_mint.to_account_info(),
                        to: ctx.accounts.vault_token_account.to_account_info(),
                        authority: ctx.accounts.user.to_account_info(),
                    },
                ),
                args.liquidity_amount,
                ctx.accounts.token_mint.decimals,
            )?;

            let collateral_before = ctx.accounts.vault_collateral_account.amount;
            invoke_klend_deposit(&ctx, args.liquidity_amount)?;
            ctx.accounts.reserve_liquidity_supply.reload()?;
            ctx.accounts.vault_token_account.reload()?;
            ctx.accounts.vault_collateral_account.reload()?;
            let consumed_liquidity = ctx
                .accounts
                .reserve_liquidity_supply
                .amount
                .checked_sub(reserve_supply_before)
                .ok_or(ErrorCode::Overflow)?;
            let refunded_liquidity = args
                .liquidity_amount
                .checked_sub(consumed_liquidity)
                .ok_or(ErrorCode::Overflow)?;
            let minted_shares = ctx
                .accounts
                .vault_collateral_account
                .amount
                .checked_sub(collateral_before)
                .ok_or(ErrorCode::Overflow)?;
            require!(
                minted_shares >= args.share_amount,
                ErrorCode::SlippageExceeded
            );

            if refunded_liquidity > 0 {
                let vault_account_info = ctx.accounts.vault.to_account_info();
                let seeds = [
                    VAULT_PDA_SEED,
                    &ctx.accounts.token_mint.key().to_bytes(),
                    &[ctx.bumps.vault],
                ];
                let signer_seeds = &[&seeds[..]];
                transfer_checked(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        TransferChecked {
                            from: ctx.accounts.vault_token_account.to_account_info(),
                            mint: ctx.accounts.token_mint.to_account_info(),
                            to: ctx.accounts.user_token_account.to_account_info(),
                            authority: vault_account_info,
                        },
                        signer_seeds,
                    ),
                    refunded_liquidity,
                    ctx.accounts.token_mint.decimals,
                )?;
            }

            ctx.accounts.deposit.amount = ctx
                .accounts
                .deposit
                .amount
                .checked_add(minted_shares)
                .ok_or(ErrorCode::Overflow)?;
            ctx.accounts.vault.total_shares = ctx
                .accounts
                .vault
                .total_shares
                .checked_add(minted_shares)
                .ok_or(ErrorCode::Overflow)?;
        } else {
            require!(
                ctx.accounts.deposit.amount >= args.share_amount,
                ErrorCode::InsufficientDeposit
            );
            require!(
                ctx.accounts.vault.total_shares >= args.share_amount,
                ErrorCode::InsufficientVault
            );

            let liquidity_before = ctx.accounts.vault_token_account.amount;
            invoke_klend_redeem(&ctx, args.share_amount)?;
            ctx.accounts.vault_token_account.reload()?;
            let redeemed_liquidity = ctx
                .accounts
                .vault_token_account
                .amount
                .checked_sub(liquidity_before)
                .ok_or(ErrorCode::Overflow)?;
            require!(
                redeemed_liquidity >= args.liquidity_amount,
                ErrorCode::SlippageExceeded
            );

            let vault_account_info = ctx.accounts.vault.to_account_info();
            let seeds = [
                VAULT_PDA_SEED,
                &ctx.accounts.token_mint.key().to_bytes(),
                &[ctx.bumps.vault],
            ];
            let signer_seeds = &[&seeds[..]];
            transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.vault_token_account.to_account_info(),
                        mint: ctx.accounts.token_mint.to_account_info(),
                        to: ctx.accounts.user_token_account.to_account_info(),
                        authority: vault_account_info,
                    },
                    signer_seeds,
                ),
                redeemed_liquidity,
                ctx.accounts.token_mint.decimals,
            )?;
            ctx.accounts.deposit.amount = ctx
                .accounts
                .deposit
                .amount
                .checked_sub(args.share_amount)
                .ok_or(ErrorCode::InsufficientDeposit)?;
            ctx.accounts.vault.total_shares = ctx
                .accounts
                .vault
                .total_shares
                .checked_sub(args.share_amount)
                .ok_or(ErrorCode::InsufficientDeposit)?;
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
            session.username == source_username_deposit.username,
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
            session.username == deposit.username,
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
                deposit.username.as_bytes(),
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
        username: String,
        token_mint: Pubkey,
    ) -> Result<()> {
        validate_username(&username)?;
        // require!(ctx.accounts.session.verified, ErrorCode::NotVerified);
        // require!(
        //     ctx.accounts.session.username == username,
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
                username.as_bytes(),
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
        username: String,
        token_mint: Pubkey,
    ) -> Result<()> {
        validate_username(&username)?;
        require!(ctx.accounts.session.verified, ErrorCode::NotVerified);
        require!(
            ctx.accounts.session.username == username,
            ErrorCode::InvalidUsername
        );
        require_keys_eq!(
            ctx.accounts.session.user_wallet,
            ctx.accounts.payer.key(),
            ErrorCode::Unauthorized
        );
        require_keys_eq!(
            ctx.accounts.deposit.key(),
            Pubkey::create_program_address(
                &[
                    USERNAME_DEPOSIT_PDA_SEED,
                    username.as_bytes(),
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
#[instruction(username: String)]
pub struct InitializeUsernameDeposit<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + UsernameDeposit::INIT_SPACE,
        seeds = [
            USERNAME_DEPOSIT_PDA_SEED,
            username.as_bytes(),
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
    pub liquidity_amount: u64,
    pub share_amount: u64,
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
    pub vault: Box<Account<'info, Vault>>,
    #[account(
        mut,
        seeds = [DEPOSIT_PDA_SEED, deposit.user.as_ref(), deposit.token_mint.as_ref()],
        bump,
        has_one = user,
        has_one = token_mint,
    )]
    pub deposit: Box<Account<'info, Deposit>>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = token_mint,
        associated_token::authority = user,
    )]
    pub user_token_account: Box<Account<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = token_mint,
        associated_token::authority = vault,
    )]
    pub vault_token_account: Box<Account<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = reserve_collateral_mint,
        associated_token::authority = vault,
    )]
    pub vault_collateral_account: Box<Account<'info, TokenAccount>>,
    pub token_mint: Box<Account<'info, Mint>>,
    pub reserve_collateral_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub reserve_liquidity_supply: Box<Account<'info, TokenAccount>>,
    /// CHECK: Validated against supported hardcoded config and KLend ownership at runtime
    pub reserve: UncheckedAccount<'info>,
    /// CHECK: Validated against supported hardcoded config and KLend ownership at runtime
    pub lending_market: UncheckedAccount<'info>,
    /// CHECK: Derived PDA validated at runtime
    pub lending_market_authority: UncheckedAccount<'info>,
    /// CHECK: Fixed instructions sysvar address
    #[account(address = sysvar::instructions::ID)]
    pub instruction_sysvar_account: UncheckedAccount<'info>,
    /// CHECK: Fixed KLend program address
    #[account(address = KLEND_PROGRAM_ID)]
    pub klend_program: UncheckedAccount<'info>,
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
        seeds = [USERNAME_DEPOSIT_PDA_SEED, source_username_deposit.username.as_bytes(), source_username_deposit.token_mint.as_ref()],
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
        constraint = session.username == source_username_deposit.username @ ErrorCode::InvalidUsername,
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
            destination_deposit.username.as_bytes(),
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
            deposit.username.as_bytes(),
            deposit.token_mint.as_ref()
        ],
        bump
    )]
    pub deposit: Account<'info, UsernameDeposit>,
    #[account(
        constraint = session.user_wallet == authority.key() @ ErrorCode::Unauthorized,
        constraint = session.verified @ ErrorCode::NotVerified,
        constraint = session.username == deposit.username @ ErrorCode::InvalidUsername,
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
#[instruction(username: String, token_mint: Pubkey)]
pub struct DelegateUsernameDeposit<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Checked by the delegate program
    pub validator: Option<AccountInfo<'info>>,
    // #[account(
    //     constraint = session.user_wallet == payer.key() @ ErrorCode::Unauthorized,
    //     constraint = session.verified @ ErrorCode::NotVerified,
    //     constraint = session.username == username @ ErrorCode::InvalidUsername,
    // )]
    // pub session: Account<'info, TelegramSession>,
    /// CHECK: Checked by the delegate program
    #[account(
        mut,
        del,
        seeds = [USERNAME_DEPOSIT_PDA_SEED, username.as_bytes(), token_mint.as_ref()],
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
#[instruction(username: String, token_mint: Pubkey)]
pub struct UndelegateUsernameDeposit<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        constraint = session.user_wallet == payer.key() @ ErrorCode::Unauthorized,
        constraint = session.verified @ ErrorCode::NotVerified,
        constraint = session.username == username @ ErrorCode::InvalidUsername,
    )]
    pub session: Account<'info, TelegramSession>,
    /// CHECK: Delegated account (owned by delegation program)
    #[account(
        mut,
        seeds = [
            USERNAME_DEPOSIT_PDA_SEED,
            username.as_bytes(),
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
    /// KLend collateral shares owned by this deposit.
    pub amount: u64,
}

/// A deposit account for a telegram username and token mint.
///
/// Telegram username is always lowercase (a-z, 0-9 and underscores)
#[account]
#[derive(InitSpace)]
pub struct UsernameDeposit {
    #[max_len(MAX_USERNAME_LEN)]
    pub username: String,
    pub token_mint: Pubkey,
    /// KLend collateral shares owned by this username deposit.
    pub amount: u64,
}

/// A per-mint vault that routes liquidity into a fixed KLend reserve.
#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub token_mint: Pubkey,
    pub lending_market: Pubkey,
    pub reserve: Pubkey,
    pub reserve_collateral_mint: Pubkey,
    pub total_shares: u64,
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
    #[msg("Unsupported token")]
    UnsupportedToken,
    #[msg("Slippage exceeded")]
    SlippageExceeded,
    #[msg("Invalid Kamino accounts")]
    InvalidKaminoAccounts,
}

fn validate_username(username: &str) -> Result<()> {
    require!(
        (MIN_USERNAME_LEN..=MAX_USERNAME_LEN).contains(&username.len()),
        ErrorCode::InvalidUsername
    );
    require!(
        username
            .bytes()
            .all(|b| (b'a'..=b'z').contains(&b) || (b'0'..=b'9').contains(&b) || b == b'_'),
        ErrorCode::InvalidUsername
    );
    Ok(())
}

#[derive(Clone, Copy)]
struct KaminoReserveConfig {
    lending_market: Pubkey,
    reserve: Pubkey,
}

fn supported_kamino_config(token_mint: &Pubkey) -> Result<KaminoReserveConfig> {
    if *token_mint == SOL_MINT {
        Ok(KaminoReserveConfig {
            lending_market: MAIN_MARKET,
            reserve: SOL_RESERVE,
        })
    } else if *token_mint == USDC_MINT {
        Ok(KaminoReserveConfig {
            lending_market: MAIN_ALT_MARKET,
            reserve: USDC_RESERVE,
        })
    } else if *token_mint == USDT_MINT {
        Ok(KaminoReserveConfig {
            lending_market: MAIN_MARKET,
            reserve: USDT_RESERVE,
        })
    } else {
        err!(ErrorCode::UnsupportedToken)
    }
}

fn initialize_vault_if_needed(
    vault: &mut Account<Vault>,
    token_mint: Pubkey,
    reserve_collateral_mint: Pubkey,
    kamino_config: &KaminoReserveConfig,
) -> Result<()> {
    if vault.token_mint == Pubkey::default() {
        vault.set_inner(Vault {
            token_mint,
            lending_market: kamino_config.lending_market,
            reserve: kamino_config.reserve,
            reserve_collateral_mint,
            total_shares: 0,
        });
    }

    require_keys_eq!(vault.token_mint, token_mint, ErrorCode::InvalidMint);
    require_keys_eq!(
        vault.lending_market,
        kamino_config.lending_market,
        ErrorCode::InvalidKaminoAccounts
    );
    require_keys_eq!(vault.reserve, kamino_config.reserve, ErrorCode::InvalidKaminoAccounts);
    require_keys_eq!(
        vault.reserve_collateral_mint,
        reserve_collateral_mint,
        ErrorCode::InvalidKaminoAccounts
    );

    Ok(())
}

fn validate_kamino_accounts(
    ctx: &Context<ModifyDeposit>,
    kamino_config: &KaminoReserveConfig,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.lending_market.key(),
        kamino_config.lending_market,
        ErrorCode::InvalidKaminoAccounts
    );
    require_keys_eq!(
        ctx.accounts.reserve.key(),
        kamino_config.reserve,
        ErrorCode::InvalidKaminoAccounts
    );
    require_keys_eq!(
        *ctx.accounts.reserve.owner,
        KLEND_PROGRAM_ID,
        ErrorCode::InvalidKaminoAccounts
    );
    require_keys_eq!(
        *ctx.accounts.lending_market.owner,
        KLEND_PROGRAM_ID,
        ErrorCode::InvalidKaminoAccounts
    );
    require_keys_eq!(
        ctx.accounts.reserve_liquidity_supply.mint,
        ctx.accounts.token_mint.key(),
        ErrorCode::InvalidKaminoAccounts
    );
    let expected_market_authority =
        Pubkey::find_program_address(&[b"lma", kamino_config.lending_market.as_ref()], &KLEND_PROGRAM_ID).0;
    require_keys_eq!(
        ctx.accounts.lending_market_authority.key(),
        expected_market_authority,
        ErrorCode::InvalidKaminoAccounts
    );
    Ok(())
}

fn invoke_klend_deposit(ctx: &Context<ModifyDeposit>, liquidity_amount: u64) -> Result<()> {
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
            AccountMeta::new_readonly(ctx.accounts.token_mint.key(), false),
            AccountMeta::new(ctx.accounts.reserve_liquidity_supply.key(), false),
            AccountMeta::new(ctx.accounts.reserve_collateral_mint.key(), false),
            AccountMeta::new(ctx.accounts.vault_token_account.key(), false),
            AccountMeta::new(ctx.accounts.vault_collateral_account.key(), false),
            AccountMeta::new_readonly(ctx.accounts.token_program.key(), false),
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
            ctx.accounts.reserve.to_account_info(),
            ctx.accounts.lending_market.to_account_info(),
            ctx.accounts.lending_market_authority.to_account_info(),
            ctx.accounts.token_mint.to_account_info(),
            ctx.accounts.reserve_liquidity_supply.to_account_info(),
            ctx.accounts.reserve_collateral_mint.to_account_info(),
            ctx.accounts.vault_token_account.to_account_info(),
            ctx.accounts.vault_collateral_account.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.instruction_sysvar_account.to_account_info(),
            ctx.accounts.klend_program.to_account_info(),
        ],
        &[vault_signer_seeds],
    )?;

    Ok(())
}

fn invoke_klend_redeem(ctx: &Context<ModifyDeposit>, share_amount: u64) -> Result<()> {
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
            AccountMeta::new(ctx.accounts.vault_collateral_account.key(), false),
            AccountMeta::new(ctx.accounts.vault_token_account.key(), false),
            AccountMeta::new_readonly(ctx.accounts.token_program.key(), false),
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
            ctx.accounts.vault_collateral_account.to_account_info(),
            ctx.accounts.vault_token_account.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.instruction_sysvar_account.to_account_info(),
            ctx.accounts.klend_program.to_account_info(),
        ],
        &[vault_signer_seeds],
    )?;

    Ok(())
}
