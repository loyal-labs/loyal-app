use anyhow::{anyhow, bail, Context, Result};
use log::debug;
use serde_json::json;
use spl_associated_token_account_client::address::get_associated_token_address_with_program_id;
use spl_token::native_mint::id as native_mint_id;
use std::time::Duration;

use crate::{
    auth::get_delegation_status,
    cli::{AmountArgs, TargetArgs, TransferUsernameArgs, UndelegateArgs, WaitArgs},
    constants::{
        DEFAULT_OWNER_WAIT_INTERVAL_SECONDS, DEFAULT_OWNER_WAIT_TIMEOUT_SECONDS,
        USERNAME_INIT_WAIT_ATTEMPTS, USERNAME_INIT_WAIT_INTERVAL_MS,
    },
    context::{parse_pubkey, resolve_target},
    pda::{
        build_create_permission_ix, build_delegate_deposit_ix, build_delegate_username_deposit_ix,
        build_initialize_deposit_ix, build_initialize_username_deposit_ix, build_modify_balance_ix,
        build_transfer_to_username_deposit_ix, build_undelegate_deposit_ix,
        build_undelegate_username_deposit_ix, delegation_program_id, find_deposit_pda,
        find_permission_pda, find_username_deposit_pda, permission_program_id, program_id,
        validate_username,
    },
    solana_ops::{
        account_owner_is, close_wsol_ata, ensure_ata_exists, fetch_deposit_amount,
        fetch_deposit_amount_allow_not_found, fetch_username_deposit_amount,
        fetch_username_deposit_amount_allow_not_found, get_account_opt,
        get_account_opt_allow_not_found, print_signature, send_ix, send_ix_with_opts,
        wait_for_account_exists, wait_for_owner, wrap_sol_to_wsol,
    },
    types::{AppContext, DisplayResult, Target},
};

pub(crate) fn cmd_display(ctx: &AppContext, args: &TargetArgs) -> Result<()> {
    debug!("running command: display with args {:?}", args);
    let target = resolve_target(args, ctx.signer_pubkey)?;
    let (target_type, account, base_amount, per_amount) = match &target {
        Target::Deposit { deposit, .. } => {
            let base = fetch_deposit_amount(&ctx.base_client, deposit, ctx.commitment)?;
            let per =
                fetch_deposit_amount_allow_not_found(&ctx.per_client, deposit, ctx.commitment)?;
            ("deposit".to_string(), *deposit, base, per)
        }
        Target::UsernameDeposit { deposit, .. } => {
            let base = fetch_username_deposit_amount(&ctx.base_client, deposit, ctx.commitment)?;
            let per = fetch_username_deposit_amount_allow_not_found(
                &ctx.per_client,
                deposit,
                ctx.commitment,
            )?;
            ("username_deposit".to_string(), *deposit, base, per)
        }
    };

    let base_account = get_account_opt(&ctx.base_client, &account, ctx.commitment)?;
    let per_account = get_account_opt_allow_not_found(&ctx.per_client, &account, ctx.commitment)?;

    let base_owner = base_account.as_ref().map(|a| a.owner.to_string());
    let per_owner = per_account.as_ref().map(|a| a.owner.to_string());
    let delegated_on_base = base_account
        .as_ref()
        .map(|a| a.owner == delegation_program_id())
        .unwrap_or(false);

    let delegation_status = get_delegation_status(
        &ctx.http_client,
        &ctx.per_rpc_url,
        &ctx.router_url,
        &account,
        &ctx.validator.to_string(),
    )?;

    let result = DisplayResult {
        target_type,
        account: account.to_string(),
        base_owner,
        per_owner,
        base_amount,
        per_amount,
        delegated_on_base,
        delegation_status,
    };

    match ctx.output {
        crate::cli::OutputFormat::Display => {
            println!("Config File: {}", ctx.solana_config.config_path);
            println!("RPC URL: {}", ctx.solana_config.rpc_url);
            println!("WebSocket URL: {}", ctx.solana_config.websocket_url);
            println!("Keypair Path: {}", ctx.solana_config.keypair_path);
            println!("PER RPC URL: {}", ctx.per_rpc_url);
            println!("PER WS URL: {}", ctx.per_ws_url);
            println!("Target Type: {}", result.target_type);
            println!("Target Account: {}", result.account);
            println!(
                "Base Owner: {}",
                result.base_owner.as_deref().unwrap_or("<missing>")
            );
            println!(
                "PER Owner: {}",
                result.per_owner.as_deref().unwrap_or("<missing>")
            );
            println!(
                "Delegated On Base: {}",
                if result.delegated_on_base {
                    "yes"
                } else {
                    "no"
                }
            );
            if let Some(amount) = result.base_amount {
                println!("Base Amount: {}", amount);
            }
            if let Some(amount) = result.per_amount {
                println!("PER Amount: {}", amount);
            }
            if let Some(status) = &result.delegation_status {
                println!("Router Delegated: {}", status.is_delegated);
                if let Some(record) = &status.delegation_record {
                    println!("Router Authority: {}", record.authority);
                    if record.authority != ctx.validator.to_string() {
                        eprintln!(
                            "Warning: delegation authority {} differs from selected validator {}",
                            record.authority, ctx.validator
                        );
                    }
                    println!(
                        "Router Delegation Owner: {}",
                        record.owner.as_deref().unwrap_or("<missing>")
                    );
                    println!(
                        "Router Delegation Slot: {}",
                        record
                            .delegation_slot
                            .map_or("<missing>".to_string(), |v| v.to_string())
                    );
                    println!(
                        "Router Delegation Lamports: {}",
                        record
                            .lamports
                            .map_or("<missing>".to_string(), |v| v.to_string())
                    );
                } else {
                    println!("Router Authority: <missing delegationRecord>");
                }
                if let Some(fqdn) = &status.fqdn {
                    println!("Router FQDN: {}", fqdn);
                }
            }
        }
        crate::cli::OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&result)?),
        crate::cli::OutputFormat::JsonCompact => println!("{}", serde_json::to_string(&result)?),
    }

    Ok(())
}

pub(crate) fn cmd_delegate(ctx: &mut AppContext, args: &TargetArgs) -> Result<()> {
    debug!("running command: delegate with args {:?}", args);
    let target = resolve_target(args, ctx.signer_pubkey)?;
    let signature = match target {
        Target::Deposit {
            user,
            mint,
            deposit,
        } => {
            let ix =
                build_delegate_deposit_ix(ctx.signer_pubkey, user, mint, deposit, ctx.validator);
            send_ix_with_opts(
                &ctx.base_client,
                &ctx.signer,
                ix,
                ctx.simulate,
                ctx.simulate_only,
            )?
        }
        Target::UsernameDeposit {
            username,
            mint,
            deposit,
        } => {
            let ix = build_delegate_username_deposit_ix(
                ctx.signer_pubkey,
                &username,
                mint,
                deposit,
                ctx.validator,
            );
            send_ix_with_opts(
                &ctx.base_client,
                &ctx.signer,
                ix,
                ctx.simulate,
                ctx.simulate_only,
            )?
        }
    };

    print_signature(ctx.output, signature)
}

pub(crate) fn cmd_undelegate(ctx: &mut AppContext, args: &UndelegateArgs) -> Result<()> {
    debug!("running command: undelegate with args {:?}", args);
    let target = resolve_target(&args.target, ctx.signer_pubkey)?;

    let signature = match target {
        Target::Deposit {
            user,
            mint: _,
            deposit,
        } => {
            let ix = build_undelegate_deposit_ix(ctx.signer_pubkey, user, deposit);
            send_ix_with_opts(
                &ctx.per_client,
                &ctx.signer,
                ix,
                ctx.simulate,
                ctx.simulate_only,
            )?
        }
        Target::UsernameDeposit {
            username,
            mint,
            deposit,
        } => {
            let session = args
                .session
                .as_ref()
                .ok_or_else(|| anyhow!("--session is required for username undelegation"))
                .and_then(|s| parse_pubkey(s, "session"))?;
            let ix = build_undelegate_username_deposit_ix(
                ctx.signer_pubkey,
                session,
                &username,
                mint,
                deposit,
            );
            send_ix_with_opts(
                &ctx.per_client,
                &ctx.signer,
                ix,
                ctx.simulate,
                ctx.simulate_only,
            )?
        }
    };

    print_signature(ctx.output, signature)
}

pub(crate) fn cmd_wait_state(ctx: &AppContext, args: &WaitArgs, delegated: bool) -> Result<()> {
    debug!(
        "running command: wait_state delegated={} with args {:?}",
        delegated, args
    );
    let target = resolve_target(&args.target, ctx.signer_pubkey)?;
    let account = match target {
        Target::Deposit { deposit, .. } | Target::UsernameDeposit { deposit, .. } => deposit,
    };

    let expected_owner = if delegated {
        delegation_program_id()
    } else {
        program_id()
    };
    wait_for_owner(
        &ctx.base_client,
        &account,
        &expected_owner,
        Duration::from_secs(args.timeout_seconds),
        Duration::from_secs(args.interval_seconds),
        ctx.commitment,
    )?;

    let result = json!({
        "account": account.to_string(),
        "delegated": delegated,
        "owner": expected_owner.to_string()
    });

    match ctx.output {
        crate::cli::OutputFormat::Display => {
            println!("Account: {}", account);
            println!(
                "State: {}",
                if delegated {
                    "delegated"
                } else {
                    "undelegated"
                }
            );
            println!("Owner: {}", expected_owner);
        }
        crate::cli::OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&result)?),
        crate::cli::OutputFormat::JsonCompact => println!("{}", serde_json::to_string(&result)?),
    }

    Ok(())
}

pub(crate) fn cmd_shield(ctx: &mut AppContext, args: &AmountArgs) -> Result<()> {
    debug!("running command: shield with args {:?}", args);
    let mint = parse_pubkey(&args.mint, "mint")?;
    let user = ctx.signer_pubkey;
    let deposit = find_deposit_pda(&user, &mint);

    if get_account_opt(&ctx.base_client, &deposit, ctx.commitment)?.is_none() {
        let init_ix = build_initialize_deposit_ix(user, user, mint, deposit);
        let _ = send_ix(&ctx.base_client, &ctx.signer, init_ix)?;
    }

    let is_native = mint == native_mint_id();
    let user_token_account =
        get_associated_token_address_with_program_id(&user, &mint, &spl_token::id());

    let mut created_ata = false;
    if is_native {
        created_ata = wrap_sol_to_wsol(
            &ctx.base_client,
            &ctx.signer,
            &user_token_account,
            args.amount,
        )?;
    }

    if account_owner_is(
        &ctx.base_client,
        &deposit,
        &delegation_program_id(),
        ctx.commitment,
    )? {
        let undelegate_ix = build_undelegate_deposit_ix(user, user, deposit);
        let _ = send_ix(&ctx.per_client, &ctx.signer, undelegate_ix)?;
        wait_for_owner(
            &ctx.base_client,
            &deposit,
            &program_id(),
            Duration::from_secs(DEFAULT_OWNER_WAIT_TIMEOUT_SECONDS),
            Duration::from_secs(DEFAULT_OWNER_WAIT_INTERVAL_SECONDS),
            ctx.commitment,
        )?;
    }

    let modify_ix = build_modify_balance_ix(
        user,
        user,
        mint,
        deposit,
        user_token_account,
        args.amount,
        true,
    );
    let modify_sig = send_ix(&ctx.base_client, &ctx.signer, modify_ix)?;

    if is_native && created_ata {
        close_wsol_ata(&ctx.base_client, &ctx.signer, &user_token_account)?;
    }

    let permission = find_permission_pda(&deposit);
    if !account_owner_is(
        &ctx.base_client,
        &permission,
        &permission_program_id(),
        ctx.commitment,
    )? {
        let create_permission_ix = build_create_permission_ix(user, user, deposit, permission);
        let _ = send_ix(&ctx.base_client, &ctx.signer, create_permission_ix)?;
    }

    if !account_owner_is(
        &ctx.base_client,
        &deposit,
        &delegation_program_id(),
        ctx.commitment,
    )? {
        let delegate_ix = build_delegate_deposit_ix(user, user, mint, deposit, ctx.validator);
        let _ = send_ix(&ctx.base_client, &ctx.signer, delegate_ix)?;
    }

    print_signature(ctx.output, modify_sig)
}

pub(crate) fn cmd_unshield(ctx: &mut AppContext, args: &AmountArgs) -> Result<()> {
    debug!("running command: unshield with args {:?}", args);
    let mint = parse_pubkey(&args.mint, "mint")?;
    let user = ctx.signer_pubkey;
    let deposit = find_deposit_pda(&user, &mint);

    if account_owner_is(
        &ctx.base_client,
        &deposit,
        &delegation_program_id(),
        ctx.commitment,
    )? {
        let undelegate_ix = build_undelegate_deposit_ix(user, user, deposit);
        let _ = send_ix(&ctx.per_client, &ctx.signer, undelegate_ix)?;
        wait_for_owner(
            &ctx.base_client,
            &deposit,
            &program_id(),
            Duration::from_secs(DEFAULT_OWNER_WAIT_TIMEOUT_SECONDS),
            Duration::from_secs(DEFAULT_OWNER_WAIT_INTERVAL_SECONDS),
            ctx.commitment,
        )?;
    } else {
        debug!(
            "unshield: deposit {} is not delegated; skipping undelegate",
            deposit
        );
    }

    let user_token_account =
        get_associated_token_address_with_program_id(&user, &mint, &spl_token::id());
    ensure_ata_exists(&ctx.base_client, &ctx.signer, &mint, &user)?;

    let modify_ix = build_modify_balance_ix(
        user,
        user,
        mint,
        deposit,
        user_token_account,
        args.amount,
        false,
    );
    let modify_sig = send_ix(&ctx.base_client, &ctx.signer, modify_ix)?;

    let is_native = mint == native_mint_id();
    if is_native {
        close_wsol_ata(&ctx.base_client, &ctx.signer, &user_token_account)?;
    }

    if let Some(remaining) = fetch_deposit_amount(&ctx.base_client, &deposit, ctx.commitment)? {
        if remaining > 0 {
            let delegate_ix = build_delegate_deposit_ix(user, user, mint, deposit, ctx.validator);
            let _ = send_ix(&ctx.base_client, &ctx.signer, delegate_ix)?;
        }
    }

    print_signature(ctx.output, modify_sig)
}

pub(crate) fn cmd_transfer_username(
    ctx: &mut AppContext,
    args: &TransferUsernameArgs,
) -> Result<()> {
    debug!("running command: transfer_username with args {:?}", args);
    validate_username(&args.username)?;

    let mint = parse_pubkey(&args.mint, "mint")?;
    let user = ctx.signer_pubkey;

    let source_deposit = find_deposit_pda(&user, &mint);
    if !account_owner_is(
        &ctx.base_client,
        &source_deposit,
        &delegation_program_id(),
        ctx.commitment,
    )? {
        bail!("source deposit is not delegated; run `loyal shield` or `loyal delegate` first");
    }

    let destination = find_username_deposit_pda(&args.username, &mint);

    let base_exists = get_account_opt(&ctx.base_client, &destination, ctx.commitment)?.is_some();
    let per_exists = get_account_opt(&ctx.per_client, &destination, ctx.commitment)?.is_some();

    if !base_exists && !per_exists {
        let init_ix = build_initialize_username_deposit_ix(user, mint, &args.username, destination);
        let _ = send_ix(&ctx.base_client, &ctx.signer, init_ix)?;
        wait_for_account_exists(
            &ctx.base_client,
            &destination,
            Duration::from_millis(USERNAME_INIT_WAIT_ATTEMPTS * USERNAME_INIT_WAIT_INTERVAL_MS),
            Duration::from_millis(USERNAME_INIT_WAIT_INTERVAL_MS),
            ctx.commitment,
        )
        .with_context(|| {
            format!(
                "username deposit {} was initialized but did not become visible on base RPC",
                destination
            )
        })?;
    }

    if !account_owner_is(
        &ctx.base_client,
        &destination,
        &delegation_program_id(),
        ctx.commitment,
    )? {
        let delegate_ix = build_delegate_username_deposit_ix(
            user,
            &args.username,
            mint,
            destination,
            ctx.validator,
        );
        let _ = send_ix(&ctx.base_client, &ctx.signer, delegate_ix)?;
    }

    let transfer_ix = build_transfer_to_username_deposit_ix(
        user,
        ctx.signer_pubkey,
        mint,
        source_deposit,
        destination,
        args.amount,
    );
    let sig = send_ix(&ctx.per_client, &ctx.signer, transfer_ix)?;

    print_signature(ctx.output, sig)
}
