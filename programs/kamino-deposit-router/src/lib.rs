pub mod constants;
pub mod error;
pub mod instructions;

use anchor_lang::prelude::*;

pub use constants::*;
pub use error::*;
#[doc(hidden)]
pub(crate) use instructions::route_deposit::__client_accounts_route_deposit;
pub use instructions::{RouteDeposit, RouteDepositArgs};

declare_id!("4MDtYRz8fbRfk3AbxdDJ2nCejQrSxcemAyZW9EEZDrtX");

#[program]
pub mod kamino_deposit_router {
    use super::*;

    pub fn route_deposit(ctx: Context<RouteDeposit>, args: RouteDepositArgs) -> Result<()> {
        instructions::route_deposit::handler(ctx, args)
    }
}
