use clap::{Args, Parser, Subcommand, ValueEnum};

use crate::constants::{
    DEFAULT_OWNER_WAIT_INTERVAL_SECONDS, DEFAULT_OWNER_WAIT_TIMEOUT_SECONDS, NATIVE_MINT_STR,
};

#[derive(Parser, Debug)]
#[command(name = "loyal", version, about = "Loyal private transfer CLI")]
pub(crate) struct Cli {
    #[arg(long, short = 'C', global = true)]
    pub(crate) config: Option<String>,

    #[arg(long, short = 'u', global = true)]
    pub(crate) url: Option<String>,

    #[arg(long, global = true)]
    pub(crate) ws: Option<String>,

    #[arg(long, short = 'k', global = true)]
    pub(crate) keypair: Option<String>,

    #[arg(long, global = true)]
    pub(crate) commitment: Option<String>,

    #[arg(long, global = true)]
    pub(crate) per_rpc: Option<String>,

    #[arg(long, global = true)]
    pub(crate) per_ws: Option<String>,

    #[arg(long, global = true)]
    pub(crate) per_auth_token: Option<String>,

    #[arg(long, global = true)]
    pub(crate) router_url: Option<String>,

    #[arg(long, global = true)]
    pub(crate) validator: Option<String>,

    #[arg(long, global = true, default_value = "display")]
    pub(crate) output: OutputFormat,

    #[arg(long, global = true)]
    pub(crate) debug: bool,

    /// Simulate the transaction before sending.
    #[arg(long, global = true, conflicts_with = "simulate_only")]
    pub(crate) simulate: bool,

    /// Simulate only — do not send the transaction.
    #[arg(long, global = true, conflicts_with = "simulate")]
    pub(crate) simulate_only: bool,

    #[command(subcommand)]
    pub(crate) command: Command,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub(crate) enum OutputFormat {
    Display,
    Json,
    JsonCompact,
}

#[derive(Subcommand, Debug)]
pub(crate) enum Command {
    Display(TargetArgs),
    Delegate(TargetArgs),
    Undelegate(UndelegateArgs),
    WaitDelegate(WaitArgs),
    WaitUndelegate(WaitArgs),
    Shield(AmountArgs),
    Unshield(AmountArgs),
    TransferUsername(TransferUsernameArgs),
}

#[derive(Args, Debug, Clone)]
pub(crate) struct TargetArgs {
    #[arg(long, default_value = NATIVE_MINT_STR)]
    pub(crate) mint: String,

    #[arg(long, conflicts_with = "username")]
    pub(crate) user: Option<String>,

    #[arg(long, conflicts_with = "user")]
    pub(crate) username: Option<String>,
}

#[derive(Args, Debug)]
pub(crate) struct UndelegateArgs {
    #[command(flatten)]
    pub(crate) target: TargetArgs,

    #[arg(long)]
    pub(crate) session: Option<String>,
}

#[derive(Args, Debug)]
pub(crate) struct WaitArgs {
    #[command(flatten)]
    pub(crate) target: TargetArgs,

    #[arg(long, default_value_t = DEFAULT_OWNER_WAIT_TIMEOUT_SECONDS)]
    pub(crate) timeout_seconds: u64,

    #[arg(long, default_value_t = DEFAULT_OWNER_WAIT_INTERVAL_SECONDS)]
    pub(crate) interval_seconds: u64,
}

#[derive(Args, Debug)]
pub(crate) struct AmountArgs {
    #[arg(long, default_value = NATIVE_MINT_STR)]
    pub(crate) mint: String,

    #[arg(long)]
    pub(crate) amount: u64,
}

#[derive(Args, Debug)]
pub(crate) struct TransferUsernameArgs {
    #[arg(long, default_value = NATIVE_MINT_STR)]
    pub(crate) mint: String,

    #[arg(long)]
    pub(crate) username: String,

    #[arg(long)]
    pub(crate) amount: u64,
}
