use anchor_lang::prelude::*;

mod context;
use context::*;

mod state;
use state::*;

declare_id!("45C1bSkFCbjrqiQHqm8oS6J88jirW8rC46Qiu6TvoY6x");

#[program]
pub mod gifter_escrow {


    use super::*;

    pub fn create_escrow(ctx: Context<Create>,escrow_id:u64,deposit_amount:u64,maker_expected_price:u64) -> Result<()> {
        // init escrow (initing accounts)

        ctx.accounts.initialize_gifter_escrow(escrow_id, maker_expected_price,deposit_amount, ctx.bumps.gifter_escrow_state)?;
        // A zero deposit would create an escrow whose vault holds nothing, so take_and_close
        // would move zero mint_a and still emit CompleteEvent. Require a nonzero deposit.
        anchor_lang::require_neq!(deposit_amount, 0);

        // deposit to vault
        ctx.accounts.deposit_to_escrow_vault(deposit_amount)?;
        msg!("You have initialized and deposit tokens succesfully. {}", ctx.program_id.to_string());
        Ok(())
    }

    pub fn refund(ctx:Context<Refund>)-> Result<()>{
        ctx.accounts.withdraw_from_vault()?;
        msg!("You have refunded all funds in the vault, and vault is closed {}", ctx.program_id.to_string());
        Ok(())
    }
    

    pub fn take_and_close(ctx:Context<Take>)-> Result<()>{
        ctx.accounts.send_to_maker()?;
        msg!("Taker sent tokens to the maker succesfully {}", ctx.program_id.to_string());
        ctx.accounts.take_from_vault()?;
        msg!("Taker get tokens from the vault succesfully {}", ctx.program_id.to_string());
        Ok(())
    }


}



