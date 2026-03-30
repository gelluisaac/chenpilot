#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    Address, Bytes, BytesN, Env, Vec,
};

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config,
    /// Tracks which tx_ids have already been claimed (replay protection)
    Claimed(BytesN<32>),
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    /// Contract admin (can update config / pause)
    pub admin: Address,
    /// Stellar token to mint/release when a valid BTC tx is proven
    pub wrapped_btc_token: Address,
    /// Minimum number of confirmations (merkle depth) required
    pub min_confirmations: u32,
}

// ---------------------------------------------------------------------------
// SPV proof submitted by the relayer
// ---------------------------------------------------------------------------
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SpvProof {
    /// Raw 80-byte Bitcoin block header
    pub block_header: Bytes,
    /// Bitcoin transaction id (little-endian, 32 bytes)
    pub tx_id: BytesN<32>,
    /// Merkle proof: ordered list of 32-byte sibling hashes
    pub merkle_proof: Vec<BytesN<32>>,
    /// Index of the transaction in the block (used to determine left/right)
    pub tx_index: u32,
    /// Amount of satoshis locked in the BTC transaction
    pub amount_sat: i128,
    /// Stellar recipient address that should receive the wrapped asset
    pub recipient: Address,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------
#[contract]
pub struct BtcRelayContract;

#[contractimpl]
impl BtcRelayContract {
    /// Initialize the relay with admin and wrapped-BTC token address.
    pub fn initialize(
        env: Env,
        admin: Address,
        wrapped_btc_token: Address,
        min_confirmations: u32,
    ) {
        if env.storage().instance().has(&DataKey::Config) {
            panic!("already initialized");
        }
        env.storage().instance().set(
            &DataKey::Config,
            &Config { admin, wrapped_btc_token, min_confirmations },
        );
    }

    /// Update configuration. Admin only.
    pub fn update_config(env: Env, config: Config) {
        let current: Config = env.storage().instance().get(&DataKey::Config).expect("not initialized");
        current.admin.require_auth();
        env.storage().instance().set(&DataKey::Config, &config);
    }

    /// Core SPV verification gate.
    ///
    /// Validates:
    ///   1. The block header has valid proof-of-work (hash ≤ target encoded in header).
    ///   2. The tx_id is committed to the block via the Merkle proof.
    ///   3. The proof depth meets `min_confirmations`.
    ///   4. The tx_id has not been claimed before (replay protection).
    ///
    /// On success, emits a `RelayOk` event and marks the tx as claimed.
    /// The caller is responsible for minting/releasing the wrapped asset using
    /// the returned (recipient, amount_sat) values.
    pub fn verify_and_claim(env: Env, proof: SpvProof) -> (Address, i128) {
        let config: Config = env.storage().instance().get(&DataKey::Config).expect("not initialized");

        // --- 1. Replay protection ---
        let claimed_key = DataKey::Claimed(proof.tx_id.clone());
        if env.storage().persistent().has(&claimed_key) {
            panic!("tx already claimed");
        }

        // --- 2. Validate block header length (must be exactly 80 bytes) ---
        if proof.block_header.len() != 80 {
            panic!("invalid block header length");
        }

        // --- 3. Proof-of-Work check: double-SHA256(header) must be ≤ target ---
        let header_hash = Self::double_sha256(&env, &proof.block_header);
        let target = Self::extract_target(&env, &proof.block_header);
        if !Self::hash_meets_target(&header_hash, &target) {
            panic!("block header fails proof-of-work check");
        }

        // --- 4. Merkle proof depth check ---
        if proof.merkle_proof.len() < config.min_confirmations {
            panic!("insufficient merkle proof depth");
        }

        // --- 5. Merkle inclusion proof ---
        let merkle_root = Self::extract_merkle_root(&env, &proof.block_header);
        let computed_root = Self::compute_merkle_root(
            &env,
            proof.tx_id.clone(),
            &proof.merkle_proof,
            proof.tx_index,
        );
        if merkle_root != computed_root {
            panic!("merkle proof invalid: tx not in block");
        }

        // --- 6. Mark as claimed ---
        env.storage().persistent().set(&claimed_key, &true);

        // --- 7. Emit success event ---
        env.events().publish(
            (symbol_short!("RelayOk"),),
            (proof.tx_id.clone(), proof.recipient.clone(), proof.amount_sat),
        );

        (proof.recipient, proof.amount_sat)
    }

    /// Returns whether a given tx_id has already been claimed.
    pub fn is_claimed(env: Env, tx_id: BytesN<32>) -> bool {
        env.storage().persistent().has(&DataKey::Claimed(tx_id))
    }

    /// Returns the current config.
    pub fn get_config(env: Env) -> Config {
        env.storage().instance().get(&DataKey::Config).expect("not initialized")
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    /// Double-SHA256 of arbitrary bytes (Bitcoin's standard hash function).
    fn double_sha256(env: &Env, data: &Bytes) -> BytesN<32> {
        let first: BytesN<32> = env.crypto().sha256(data).into();
        // Convert BytesN<32> → Bytes for second pass
        let first_bytes = Bytes::from_slice(env, first.to_array().as_ref());
        env.crypto().sha256(&first_bytes).into()
    }

    /// Extract the 32-byte Merkle root from a Bitcoin block header.
    /// Bytes 36–67 (0-indexed) of the 80-byte header.
    fn extract_merkle_root(env: &Env, header: &Bytes) -> BytesN<32> {
        let mut arr = [0u8; 32];
        for i in 0..32usize {
            arr[i] = header.get(36 + i as u32).unwrap();
        }
        BytesN::from_array(env, &arr)
    }

    /// Extract and decode the compact-format target from the block header.
    /// nBits field is at bytes 72–75 (little-endian u32).
    /// Returns a 32-byte big-endian target value.
    fn extract_target(env: &Env, header: &Bytes) -> BytesN<32> {
        let b0 = header.get(72).unwrap() as u32;
        let b1 = header.get(73).unwrap() as u32;
        let b2 = header.get(74).unwrap() as u32;
        let b3 = header.get(75).unwrap() as u32;
        // nBits is little-endian in the header
        let nbits: u32 = b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);

        // Bitcoin compact target: exponent = nbits >> 24, mantissa = nbits & 0x7fffff
        // target = mantissa * 256^(exponent - 3)
        let exponent = (nbits >> 24) as usize;
        let mantissa = nbits & 0x007f_ffff;

        let mut target = [0u8; 32];
        // Place the 3 mantissa bytes starting at position (32 - exponent) in big-endian
        if exponent >= 1 && exponent <= 32 {
            let base = 32usize.saturating_sub(exponent);
            if base < 32     { target[base]     = ((mantissa >> 16) & 0xff) as u8; }
            if base + 1 < 32 { target[base + 1] = ((mantissa >> 8)  & 0xff) as u8; }
            if base + 2 < 32 { target[base + 2] = (mantissa         & 0xff) as u8; }
        }
        BytesN::from_array(env, &target)
    }

    /// Returns true if hash (big-endian) ≤ target (big-endian).
    fn hash_meets_target(hash: &BytesN<32>, target: &BytesN<32>) -> bool {
        let h = hash.to_array();
        let t = target.to_array();
        for i in 0..32 {
            if h[i] < t[i] { return true; }
            if h[i] > t[i] { return false; }
        }
        true // equal
    }

    /// Compute the Merkle root by walking up the proof path.
    /// Uses Bitcoin's double-SHA256 at each step.
    fn compute_merkle_root(
        env: &Env,
        tx_id: BytesN<32>,
        proof: &Vec<BytesN<32>>,
        tx_index: u32,
    ) -> BytesN<32> {
        let mut current = tx_id;
        let mut index = tx_index;

        for i in 0..proof.len() {
            let sibling = proof.get(i).unwrap();
            let mut combined = Bytes::new(env);

            if index % 2 == 0 {
                // current is left child
                combined.extend_from_slice(current.to_array().as_ref());
                combined.extend_from_slice(sibling.to_array().as_ref());
            } else {
                // current is right child
                combined.extend_from_slice(sibling.to_array().as_ref());
                combined.extend_from_slice(current.to_array().as_ref());
            }

            current = Self::double_sha256(env, &combined);
            index /= 2;
        }

        current
    }
}

mod test;
