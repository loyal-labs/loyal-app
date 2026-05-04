use clap::{Args, Parser, Subcommand, ValueEnum};

#[derive(Parser, Debug)]
#[command(
    name = "loyal-smart-accounts",
    version,
    about = "Loyal smart-account signer CLI"
)]
pub(crate) struct Cli {
    #[arg(long, short = 'k', global = true)]
    pub(crate) keypair: Option<String>,

    #[arg(long, global = true, default_value = "display")]
    pub(crate) output: OutputFormat,

    #[arg(long, global = true)]
    pub(crate) debug: bool,

    #[command(subcommand)]
    pub(crate) command: Command,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
pub(crate) enum OutputFormat {
    Display,
    Json,
    JsonCompact,
}

#[derive(Subcommand, Debug)]
pub(crate) enum Command {
    Init(InitArgs),
    Pubkey,
    Show,
    SignMessage(SignMessageArgs),
}

#[derive(Args, Debug)]
pub(crate) struct InitArgs {
    #[arg(long)]
    pub(crate) force: bool,
}

#[derive(Args, Debug)]
pub(crate) struct SignMessageArgs {
    #[arg(long)]
    pub(crate) message: String,
}
