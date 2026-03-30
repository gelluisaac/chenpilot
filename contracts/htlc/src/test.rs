#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, Address, Bytes, BytesN, Env,
};

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

fn setup(env: &Env) -> (Address, Address, Address, token::Client, HtlcContractClient) {
    let initiator = Address::generate(env);
    let recipient = Address::generate(env);
    let (token_addr, token_client, stellar_asset) = create_token(env, &initiator);
    stellar_asset.mint(&initiator, &1_000_000);

    let contract_id = env.register(HtlcContract, ());
    let client = HtlcContractClient::new(env, &contract_id);
    (initiator, recipient, token_addr, token_client, client)
}

/// Build the key-bound secret hash: SHA-256( preimage || recipient_pubkey )
fn make_secret_hash(env: &Env, preimage: &[u8], recipient_pubkey: &[u8]) -> BytesN<32> {
    let mut combined = Bytes::new(env);
    combined.extend_from_slice(preimage);
    combined.extend_from_slice(recipient_pubkey);
    env.crypto().sha256(&combined).into()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn test_init_swap_and_get() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let (initiator, recipient, token_addr, token_client, client) = setup(&env);

    let preimage = b"super_secret_preimage";
    let pubkey_bytes = b"recipient_stellar_pubkey_bytes_32";
    let secret_hash = make_secret_hash(&env, preimage, pubkey_bytes);

    let swap_id = client.init_swap(
        &initiator,
        &recipient,
        &token_addr,
        &500_000i128,
        &secret_hash,
        &200u32,
    );

    let swap = client.get_swap(&swap_id).unwrap();
    assert_eq!(swap.initiator, initiator);
    assert_eq!(swap.recipient, recipient);
    assert_eq!(swap.amount, 500_000);
    assert_eq!(swap.status, SwapStatus::Active);
    // Funds should have moved out of initiator's account
    assert_eq!(token_client.balance(&initiator), 500_000); // 1_000_000 - 500_000
}

#[test]
fn test_claim_success() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let (initiator, recipient, token_addr, token_client, client) = setup(&env);

    let preimage = b"my_secret";
    let pubkey_bytes = b"recipient_pubkey_32_bytes_padding";
    let secret_hash = make_secret_hash(&env, preimage, pubkey_bytes);

    let swap_id = client.init_swap(
        &initiator,
        &recipient,
        &token_addr,
        &1_000_000i128,
        &secret_hash,
        &200u32,
    );

    client.claim(
        &swap_id,
        &Bytes::from_slice(&env, preimage),
        &Bytes::from_slice(&env, pubkey_bytes),
    );

    assert_eq!(token_client.balance(&recipient), 1_000_000);
    let swap = client.get_swap(&swap_id).unwrap();
    assert_eq!(swap.status, SwapStatus::Claimed);
}

#[test]
#[should_panic]
fn test_claim_wrong_preimage_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let (initiator, recipient, token_addr, _token_client, client) = setup(&env);

    let preimage = b"correct_secret";
    let pubkey_bytes = b"recipient_pubkey_32_bytes_padding";
    let secret_hash = make_secret_hash(&env, preimage, pubkey_bytes);

    let swap_id = client.init_swap(
        &initiator,
        &recipient,
        &token_addr,
        &500_000i128,
        &secret_hash,
        &200u32,
    );

    // Wrong preimage — must panic
    client.claim(
        &swap_id,
        &Bytes::from_slice(&env, b"wrong_secret"),
        &Bytes::from_slice(&env, pubkey_bytes),
    );
}

#[test]
#[should_panic]
fn test_intercept_attack_blocked() {
    // Attacker knows the preimage but uses their own pubkey — must fail
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let (initiator, recipient, token_addr, _token_client, client) = setup(&env);

    let preimage = b"leaked_secret";
    let real_pubkey = b"real_recipient_pubkey_32_padding_";
    let attacker_pubkey = b"attacker_pubkey_32_bytes_padding_";

    // Hash is bound to the real recipient's pubkey
    let secret_hash = make_secret_hash(&env, preimage, real_pubkey);

    let swap_id = client.init_swap(
        &initiator,
        &recipient,
        &token_addr,
        &500_000i128,
        &secret_hash,
        &200u32,
    );

    // Attacker tries to claim with correct preimage but their own pubkey
    client.claim(
        &swap_id,
        &Bytes::from_slice(&env, preimage),
        &Bytes::from_slice(&env, attacker_pubkey), // wrong pubkey → hash mismatch
    );
}

#[test]
fn test_refund_after_expiry() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let (initiator, recipient, token_addr, token_client, client) = setup(&env);

    let preimage = b"some_secret";
    let pubkey_bytes = b"recipient_pubkey_32_bytes_padding_";
    let secret_hash = make_secret_hash(&env, preimage, pubkey_bytes);

    let swap_id = client.init_swap(
        &initiator,
        &recipient,
        &token_addr,
        &1_000_000i128,
        &secret_hash,
        &150u32, // expires at ledger 150
    );

    // Advance past expiry
    env.ledger().set_sequence_number(200);
    client.refund(&swap_id);

    assert_eq!(token_client.balance(&initiator), 1_000_000);
    let swap = client.get_swap(&swap_id).unwrap();
    assert_eq!(swap.status, SwapStatus::Refunded);
}

#[test]
#[should_panic]
fn test_refund_before_expiry_blocked() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let (initiator, recipient, token_addr, _token_client, client) = setup(&env);

    let secret_hash = make_secret_hash(&env, b"s", b"p");
    let swap_id = client.init_swap(
        &initiator,
        &recipient,
        &token_addr,
        &500_000i128,
        &secret_hash,
        &200u32,
    );

    // Still before expiry — must panic
    client.refund(&swap_id);
}

#[test]
#[should_panic]
fn test_double_claim_blocked() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let (initiator, recipient, token_addr, _token_client, client) = setup(&env);

    let preimage = b"my_secret";
    let pubkey_bytes = b"recipient_pubkey_32_bytes_padding";
    let secret_hash = make_secret_hash(&env, preimage, pubkey_bytes);

    let swap_id = client.init_swap(
        &initiator,
        &recipient,
        &token_addr,
        &1_000_000i128,
        &secret_hash,
        &200u32,
    );

    let p = Bytes::from_slice(&env, preimage);
    let pk = Bytes::from_slice(&env, pubkey_bytes);

    client.claim(&swap_id, &p.clone(), &pk.clone());
    // Second claim must panic
    client.claim(&swap_id, &p, &pk);
}

#[test]
#[should_panic]
fn test_expired_claim_blocked() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let (initiator, recipient, token_addr, _token_client, client) = setup(&env);

    let preimage = b"my_secret";
    let pubkey_bytes = b"recipient_pubkey_32_bytes_padding";
    let secret_hash = make_secret_hash(&env, preimage, pubkey_bytes);

    let swap_id = client.init_swap(
        &initiator,
        &recipient,
        &token_addr,
        &500_000i128,
        &secret_hash,
        &150u32,
    );

    // Advance past expiry then try to claim
    env.ledger().set_sequence_number(200);
    client.claim(
        &swap_id,
        &Bytes::from_slice(&env, preimage),
        &Bytes::from_slice(&env, pubkey_bytes),
    );
}
