use clap::{Args, Parser, Subcommand, ValueEnum};

pub(crate) const DEFAULT_AUTH_TIMEOUT_SECONDS: u64 = 300;
pub(crate) const DEFAULT_AUTH_INTERVAL_SECONDS: u64 = 2;
pub(crate) const DEFAULT_AUTH_TO_INDEX: usize = 2;

#[derive(Parser, Debug)]
#[command(name = "loyal", version, about = "Loyal agent CLI")]
pub(crate) struct Cli {
    #[arg(long, short = 'C', global = true)]
    pub(crate) config: Option<String>,

    #[arg(long, short = 'u', global = true)]
    pub(crate) url: Option<String>,

    #[arg(long, global = true)]
    pub(crate) rpc_url: Option<String>,

    #[arg(long, global = true)]
    pub(crate) ws_url: Option<String>,

    #[arg(long, global = true)]
    pub(crate) smart_accounts_program_id: Option<String>,

    #[arg(long, global = true)]
    pub(crate) settings_pda: Option<String>,

    #[arg(long, global = true)]
    pub(crate) policy_pda: Option<String>,

    #[arg(long, short = 'k', global = true)]
    pub(crate) keypair: Option<String>,

    #[arg(long, global = true)]
    pub(crate) commitment: Option<String>,

    #[arg(long, global = true, default_value = "display")]
    pub(crate) output: OutputFormat,

    #[arg(long, global = true)]
    pub(crate) debug: bool,

    #[command(subcommand)]
    pub(crate) command: Option<Command>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
pub(crate) enum OutputFormat {
    Display,
    Json,
    JsonCompact,
}

#[derive(Subcommand, Debug)]
pub(crate) enum Command {
    Auth(AuthArgs),
    Pubkey,
    Show,
    Propose(ProposeArgs),
}

#[derive(Args, Debug)]
pub(crate) struct AuthArgs {
    #[arg(long)]
    pub(crate) force: bool,

    #[arg(long)]
    pub(crate) no_open: bool,

    #[arg(long, default_value_t = DEFAULT_AUTH_TIMEOUT_SECONDS)]
    pub(crate) timeout_seconds: u64,

    #[arg(long, default_value_t = DEFAULT_AUTH_INTERVAL_SECONDS)]
    pub(crate) interval_seconds: u64,

    #[arg(long, default_value_t = 0)]
    pub(crate) from_index: usize,

    #[arg(long, default_value_t = DEFAULT_AUTH_TO_INDEX)]
    pub(crate) to_index: usize,
}

#[derive(Args, Debug)]
pub(crate) struct ProposeArgs {
    #[command(subcommand)]
    pub(crate) command: ProposeCommand,
}

#[derive(Subcommand, Debug)]
pub(crate) enum ProposeCommand {
    Raw(RawProposeArgs),
    Transfer(TransferProposeArgs),
}

#[derive(Args, Debug)]
pub(crate) struct TransferProposeArgs {
    #[command(subcommand)]
    pub(crate) command: TransferCommand,
}

#[derive(Subcommand, Debug)]
pub(crate) enum TransferCommand {
    Sol(SolTransferArgs),
    Token(TokenTransferArgs),
}

#[derive(Args, Debug)]
pub(crate) struct RawProposeArgs {
    pub(crate) encoded_transaction: String,

    #[command(flatten)]
    pub(crate) common: ProposeCommonArgs,
}

#[derive(Args, Debug, Clone)]
pub(crate) struct ProposeCommonArgs {
    #[arg(long)]
    pub(crate) settings_pda: Option<String>,

    #[arg(long)]
    pub(crate) policy_pda: Option<String>,

    #[arg(long)]
    pub(crate) account_index: Option<u8>,

    #[arg(long)]
    pub(crate) memo: Option<String>,

    #[arg(long)]
    pub(crate) instruction_constraint_indices: Option<String>,

    #[arg(long)]
    pub(crate) no_confirm: bool,
}

#[derive(Args, Debug)]
pub(crate) struct SolTransferArgs {
    pub(crate) recipient_address: String,

    pub(crate) amount: String,

    #[arg(long)]
    pub(crate) allow_unfunded_recipient: bool,

    #[arg(long)]
    pub(crate) from: Option<String>,

    #[arg(long)]
    pub(crate) with_memo: Option<String>,

    #[arg(long)]
    pub(crate) with_compute_unit_price: Option<u64>,

    #[arg(long)]
    pub(crate) no_wait: bool,

    #[command(flatten)]
    pub(crate) common: ProposeCommonArgs,
}

#[derive(Args, Debug)]
pub(crate) struct TokenTransferArgs {
    pub(crate) token_mint_address: String,

    pub(crate) token_amount: String,

    pub(crate) recipient_address: String,

    #[arg(long)]
    pub(crate) from: Option<String>,

    #[arg(long)]
    pub(crate) owner: Option<String>,

    #[arg(long)]
    pub(crate) fund_recipient: bool,

    #[arg(long)]
    pub(crate) allow_unfunded_recipient: bool,

    #[arg(long)]
    pub(crate) allow_non_system_account_recipient: bool,

    #[arg(long, conflicts_with = "program_2022")]
    pub(crate) token_program_id: Option<String>,

    #[arg(long, conflicts_with = "token_program_id")]
    pub(crate) program_2022: bool,

    #[arg(long)]
    pub(crate) mint_decimals: Option<u8>,

    #[arg(long)]
    pub(crate) with_memo: Option<String>,

    #[arg(long)]
    pub(crate) with_compute_unit_limit: Option<u32>,

    #[arg(long)]
    pub(crate) with_compute_unit_price: Option<u64>,

    #[arg(long)]
    pub(crate) transfer_hook_account: Vec<String>,

    #[arg(long)]
    pub(crate) no_wait: bool,

    #[command(flatten)]
    pub(crate) common: ProposeCommonArgs,
}
