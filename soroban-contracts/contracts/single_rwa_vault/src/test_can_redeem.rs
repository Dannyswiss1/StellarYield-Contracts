#![cfg(test)]

use crate::test_helpers::*;
use soroban_sdk::{testutils::Address as _, Address, String};

#[test]
fn test_can_redeem_success() {
    let ctx = setup_with_kyc_bypass();
    let vault = ctx.vault();
    let asset = ctx.asset();

    let user = Address::generate(&ctx.env);

    // Mint tokens and deposit the full funding target (100 USDC) to allow activation.
    asset.mint(&user, &200_000_000);
    vault.deposit(&user, &100_000_000, &user);

    // Activate vault
    vault.activate_vault(&ctx.admin);

    // Check if user can redeem
    let result = vault.can_redeem(&user, &10_000_000);
    assert!(result.ok);
    assert!(result.reason.is_none());
}

#[test]
fn test_can_redeem_insufficient_shares() {
    let ctx = setup_with_kyc_bypass();
    let vault = ctx.vault();
    let asset = ctx.asset();

    let user = Address::generate(&ctx.env);

    // Mint tokens and deposit the full funding target to allow activation.
    asset.mint(&user, &200_000_000);
    vault.deposit(&user, &100_000_000, &user);

    // Activate vault
    vault.activate_vault(&ctx.admin);

    // Try to redeem more than balance (user has 100M shares, requests 200M)
    let result = vault.can_redeem(&user, &200_000_000);
    assert!(!result.ok);
    assert!(result.reason.is_some());
    assert_eq!(
        result.reason.unwrap(),
        String::from_str(&ctx.env, "Insufficient shares")
    );
}

#[test]
fn test_can_redeem_vault_paused() {
    let ctx = setup_with_kyc_bypass();
    let vault = ctx.vault();
    let asset = ctx.asset();

    let user = Address::generate(&ctx.env);

    // Mint tokens and deposit the full funding target to allow activation.
    asset.mint(&user, &200_000_000);
    vault.deposit(&user, &100_000_000, &user);

    // Activate vault
    vault.activate_vault(&ctx.admin);

    // Pause vault
    vault.pause(&ctx.admin, &String::from_str(&ctx.env, "Testing"));

    // Try to redeem while paused
    let result = vault.can_redeem(&user, &10_000_000);
    assert!(!result.ok);
    assert!(result.reason.is_some());
    assert_eq!(
        result.reason.unwrap(),
        String::from_str(&ctx.env, "Vault is paused")
    );
}

#[test]
fn test_can_redeem_wrong_state() {
    let ctx = setup_with_kyc_bypass();
    let vault = ctx.vault();
    let asset = ctx.asset();

    let user = Address::generate(&ctx.env);

    // Mint and deposit less than the funding target — vault stays in Funding state.
    asset.mint(&user, &200_000_000);
    vault.deposit(&user, &50_000_000, &user);

    // Vault is still in Funding state (not activated)
    let result = vault.can_redeem(&user, &10_000_000);
    assert!(!result.ok);
    assert!(result.reason.is_some());
    assert_eq!(
        result.reason.unwrap(),
        String::from_str(&ctx.env, "Vault not active or matured")
    );
}

#[test]
fn test_can_redeem_blacklisted_user() {
    let ctx = setup_with_kyc_bypass();
    let vault = ctx.vault();
    let asset = ctx.asset();

    let user = Address::generate(&ctx.env);

    // Mint tokens and deposit the full funding target to allow activation.
    asset.mint(&user, &200_000_000);
    vault.deposit(&user, &100_000_000, &user);

    // Activate vault
    vault.activate_vault(&ctx.admin);

    // Blacklist user
    vault.set_blacklisted(&ctx.admin, &user, &true);

    // Try to redeem while blacklisted
    let result = vault.can_redeem(&user, &10_000_000);
    assert!(!result.ok);
    assert!(result.reason.is_some());
    assert_eq!(
        result.reason.unwrap(),
        String::from_str(&ctx.env, "User is blacklisted")
    );
}

#[test]
fn test_can_redeem_with_escrowed_shares() {
    let ctx = setup_with_kyc_bypass();
    let vault = ctx.vault();
    let asset = ctx.asset();

    let user = Address::generate(&ctx.env);

    // Mint tokens and deposit the full funding target to allow activation.
    asset.mint(&user, &200_000_000);
    vault.deposit(&user, &100_000_000, &user);

    // Activate vault
    vault.activate_vault(&ctx.admin);

    // Request early redemption (this escrows shares)
    // After this: balance = 20_000_000, escrowed = 80_000_000
    vault.request_early_redemption(&user, &80_000_000);

    // Try to redeem more than available balance (20M < 25M)
    let result = vault.can_redeem(&user, &25_000_000);
    assert!(!result.ok);
    assert!(result.reason.is_some());
    // Since balance (20M) < requested (25M), it's insufficient shares
    assert_eq!(
        result.reason.unwrap(),
        String::from_str(&ctx.env, "Insufficient shares")
    );

    // Try to redeem within available amount (balance = 20M)
    let result2 = vault.can_redeem(&user, &15_000_000);
    assert!(result2.ok);
    assert!(result2.reason.is_none());
}
