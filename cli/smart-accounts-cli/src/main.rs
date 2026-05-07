use anyhow::Result;
use clap::Parser;

mod cli;
mod commands;
mod identity;

use cli::{Cli, Command};

fn main() -> Result<()> {
    let cli = Cli::parse();
    init_logging(cli.debug);

    match &cli.command {
        Command::Init(args) => commands::cmd_init(cli.output, cli.keypair.as_deref(), args),
        Command::Pubkey => commands::cmd_pubkey(cli.output, cli.keypair.as_deref()),
        Command::Show => commands::cmd_show(cli.output, cli.keypair.as_deref()),
        Command::SignMessage(args) => {
            commands::cmd_sign_message(cli.output, cli.keypair.as_deref(), args)
        }
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
