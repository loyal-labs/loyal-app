use anyhow::Result;
use clap::{CommandFactory, Parser};

mod cli;
mod commands;
mod config;
mod identity;
mod squads;
mod transaction_diagnostics;
mod transfers;

use cli::{Cli, Command};
use config::resolve_config;

fn main() -> Result<()> {
    let cli = Cli::parse();
    init_logging(cli.debug);

    let Some(command) = &cli.command else {
        Cli::command().print_help()?;
        println!();
        return Ok(());
    };

    let config = resolve_config(&cli)?;

    match command {
        Command::Auth(args) => commands::cmd_auth(&config, cli.output, args),
        Command::Pubkey => commands::cmd_pubkey(&config, cli.output),
        Command::Show => commands::cmd_show(&config, cli.output),
        Command::Propose(args) => commands::cmd_propose(&config, cli.output, args),
    }
}

fn init_logging(debug: bool) {
    if debug && std::env::var("RUST_LOG").is_err() {
        std::env::set_var("RUST_LOG", "debug");
    }

    let env = env_logger::Env::default().filter_or("RUST_LOG", "warn");
    let _ = env_logger::Builder::from_env(env)
        .format_timestamp_millis()
        .try_init();
}
