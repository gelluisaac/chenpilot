#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::Address as _,
    token, Address, Env,
    contract, contractimpl,
};

// ---------------------------------------------------------------------------
// Mock oracle
// ---------------------------------------------------------------------------
#[contract]
pub struct MockOracle;

#[contractimpl]
impl MockOracle {
    pub fn get_price(env: Env, asset: Address) -> i128 {
        // collateral (wBTC) = $60,000 → 60_000 * 1e8
        // debt (USDC)       = $1      → 1 * 1e8
        // We distinguish by checking which address was stored first.
        // Simpler: store prices keyed by asset in instance storage.
        env.storage().instance().get(&asset).unwrap_or(100_000_000i128)
    }

    pub fn set_price(env: Env, asset: Address, price: i128) {
        env.storage().instance().set(&asset, &price);
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn create_token<'a>(
    env: &Env,
    admin: &Address,
) -> (Address, token::Client<'a>, token::StellarAssetClient<'a>) {
    let id = env.register_stellar_asset_contract(admin.clone());
    (
        id.clone(),
        token::Client::new(env, &id),
        token::StellarAssetClient::new(env, &id),
    )
}

struct TestCtx<'a> {
    borrower: Address,
    liquidator: Address,
    col_token: Address,
    debt_token: Address,
    col_client: token::Client<'a>,
    debt_client: token::Client<'a>,
    oracle: Address,
    oracle_client: MockOracleClient<'a>,
    contract: LendingLiquidationContractClient<'a>,
}

fn setup(env: &Env) -> TestCtx {
    let admin = Address::generate(env);
    let borrower = Address::generate(env);
    let liquidator = Address::generate(env);

    let (col_token, col_client, col_asset) = create_token(env, &admin);
    let (debt_token, debt_client, debt_asset) = create_token(env, &admin);

    // Mint collateral to borrower, debt to contract (simulating protocol reserves)
    col_asset.mint(&borrower, &1_000_000i128);   // 1,000,000 col units
    debt_asset.mint(&liquidator, &1_000_000i128); // 1,000,000 debt units for liquidator

    let oracle_id = env.register(MockOracle, ());
    let oracle_client = MockOracleClient::new(env, &oracle_id);

    // collateral price = 60,000 (scaled 1e8) → 6_000_000_000_000
    oracle_client.set_price(&col_token, &6_000_000_000_000i128);
    // debt price = 1 (scaled 1e8) → 100_000_000
    oracle_client.set_price(&debt_token, &100_000_000i128);

    let contract_id = env.register(LendingLiquidationContract, ());
    let contract = LendingLiquidationContractClient::new(env, &contract_id);

    // Seed the contract with debt tokens (protocol reserves)
    debt_asset.mint(&contract_id, &10_000_000i128);

    contract.initialize(&Config {
        admin: admin.clone(),
        oracle: oracle_id.clone(),
        collateral_token: col_token.clone(),
        debt_token: debt_token.clone(),
        min_health_factor: 10_000, // 1.0
        liquidation_bonus_bps: 500, // 5%
        ltv_bps: 7_500,            // 75%
    });

    TestCtx {
        borrower,
        liquidator,
        col_token,
        debt_token,
        col_client,
        debt_client,
        oracle: oracle_id,
        oracle_client,
        contract,
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn test_deposit_and_borrow() {
    let env = Env::default();
    env.mock_all_auths();
    let ctx = setup(&env);

    // Deposit 100 col units, borrow 400 debt units
    // col_value = 100 * 6e12 / 1e8 = 6_000_000 USD (scaled 1e8)
    // max_borrow at 75% LTV = 4_500_000 USD → 4_500_000 * 1e8 / 1e8 = 4_500_000 debt units
    ctx.contract.deposit_and_borrow(&ctx.borrower, &100i128, &400i128);

    let pos = ctx.contract.get_position(&ctx.borrower).unwrap();
    assert_eq!(pos.collateral_amount, 100);
    assert_eq!(pos.debt_amount, 400);
}

#[test]
fn test_health_factor_healthy() {
    let env = Env::default();
    env.mock_all_auths();
    let ctx = setup(&env);

    ctx.contract.deposit_and_borrow(&ctx.borrower, &100i128, &400i128);

    let hf = ctx.contract.health_factor(&ctx.borrower);
    // hf = 100 * 6e12 * 7500 / (400 * 1e8) = 6e14 * 7500 / 4e10 = 112_500
    assert!(hf > 10_000, "expected healthy position");
}

#[test]
#[should_panic]
fn test_liquidate_healthy_position_blocked() {
    let env = Env::default();
    env.mock_all_auths();
    let ctx = setup(&env);

    ctx.contract.deposit_and_borrow(&ctx.borrower, &100i128, &400i128);

    // Position is healthy — liquidation must panic
    ctx.contract.liquidate(&ctx.liquidator, &ctx.borrower, &100i128);
}

#[test]
fn test_liquidate_underwater_position() {
    let env = Env::default();
    env.mock_all_auths();
    let ctx = setup(&env);

    // Borrow close to max LTV: 100 col, 400 debt
    ctx.contract.deposit_and_borrow(&ctx.borrower, &100i128, &400i128);

    // Crash collateral price so position goes underwater
    // new hf = 100 * 1e8 * 7500 / (400 * 1e8) = 7500/4 = 1875 < 10_000
    ctx.oracle_client.set_price(&ctx.col_token, &100_000_000i128); // same price as debt now

    let hf_before = ctx.contract.health_factor(&ctx.borrower);
    assert!(hf_before < 10_000, "position should be underwater");

    let liquidator_debt_before = ctx.debt_client.balance(&ctx.liquidator);

    // Liquidator repays 50 debt units (partial liquidation)
    ctx.contract.liquidate(&ctx.liquidator, &ctx.borrower, &50i128);

    let pos = ctx.contract.get_position(&ctx.borrower).unwrap();
    assert!(pos.debt_amount < 400i128, "debt should decrease");
    assert!(pos.collateral_amount < 100i128, "collateral should decrease");

    // Liquidator spent debt tokens
    assert!(ctx.debt_client.balance(&ctx.liquidator) < liquidator_debt_before);
    // Liquidator received collateral
    assert!(ctx.col_client.balance(&ctx.liquidator) > 0);
}

#[test]
fn test_liquidation_bonus_applied() {
    let env = Env::default();
    env.mock_all_auths();
    let ctx = setup(&env);

    ctx.contract.deposit_and_borrow(&ctx.borrower, &100i128, &400i128);
    // Drop price to make position liquidatable (same as debt price)
    ctx.oracle_client.set_price(&ctx.col_token, &100_000_000i128);

    let repay = 10i128;
    ctx.contract.liquidate(&ctx.liquidator, &ctx.borrower, &repay);

    let col_received = ctx.col_client.balance(&ctx.liquidator);
    // repay_value = 10 * 1e8 / 1e8 = 10 USD
    // with 5% bonus: 10 * 10500 / 10000 = 10.5 → 10 (integer)
    // col_seized = 10.5 * 1e8 / 1e8 = 10 (or 10 with rounding)
    assert!(col_received >= repay, "liquidator should receive at least repay amount in collateral");
}

#[test]
#[should_panic]
fn test_double_initialize() {
    let env = Env::default();
    env.mock_all_auths();
    let ctx = setup(&env);
    ctx.contract.initialize(&Config {
        admin: Address::generate(&env),
        oracle: ctx.oracle.clone(),
        collateral_token: ctx.col_token.clone(),
        debt_token: ctx.debt_token.clone(),
        min_health_factor: 10_000,
        liquidation_bonus_bps: 500,
        ltv_bps: 7_500,
    });
}
