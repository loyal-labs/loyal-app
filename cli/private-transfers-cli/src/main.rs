use anyhow::Result;
use clap::Parser;

mod auth;
mod cli;
mod commands;
mod constants;
mod context;
mod pda;
mod solana_ops;
mod types;

use cli::{Cli, Command};
use commands::{
    cmd_delegate, cmd_display, cmd_shield, cmd_transfer_username, cmd_undelegate, cmd_unshield,
    cmd_wait_state,
};
use context::{build_context, init_logging};

fn main() -> Result<()> {
    let cli = Cli::parse();
    init_logging(&cli);
    let mut ctx = build_context(&cli)?;

    match &cli.command {
        Command::Display(args) => cmd_display(&ctx, args),
        Command::Delegate(args) => cmd_delegate(&mut ctx, args),
        Command::Undelegate(args) => cmd_undelegate(&mut ctx, args),
        Command::WaitDelegate(args) => cmd_wait_state(&ctx, args, true),
        Command::WaitUndelegate(args) => cmd_wait_state(&ctx, args, false),
        Command::Shield(args) => cmd_shield(&mut ctx, args),
        Command::Unshield(args) => cmd_unshield(&mut ctx, args),
        Command::TransferUsername(args) => cmd_transfer_username(&mut ctx, args),
    }
}
