pub mod constants;
pub mod error;
pub mod instructions;

use anchor_lang::prelude::*;

pub use constants::*;
pub use error::*;
#[doc(hidden)]
pub(crate) use instructions::crank_route::__client_accounts_crank_route;
pub use instructions::{CrankRoute, CrankRouteArgs};

declare_id!("4RVMhCMFzQGwtKZFdowuMzChpsHhHFWvt8a7tVb4hqa6");

#[program]
pub mod kamino_route_crank {
    use super::*;

    pub fn crank_route<'info>(
        ctx: Context<'_, '_, '_, 'info, CrankRoute<'info>>,
        args: CrankRouteArgs,
    ) -> Result<()> {
        instructions::crank_route::handler(ctx, args)
    }
}
