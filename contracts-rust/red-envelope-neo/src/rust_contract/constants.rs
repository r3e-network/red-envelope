use neo_devpack::prelude::*;

neo_manifest_overlay!(
    r#"{
  "name": "RedEnvelopeRust",
  "features": { "storage": true },
  "supportedstandards": ["NEP-11"]
}"#
);

const MIN_AMOUNT: i64 = 100_000_000;
const MAX_PACKETS: i64 = 100;
const MIN_PER_PACKET: i64 = 10_000_000;
const PERCENT_BASE: i64 = 10_000;
const MAX_SINGLE_PACKET_BPS: i64 = 2_000;
const MAX_SINGLE_PACKET_AVG_BPS: i64 = 18_000;
const DENSE_PACKET_THRESHOLD: i64 = 50;
const MEDIUM_PACKET_THRESHOLD: i64 = 20;
const DENSE_VOLATILITY_LOW_BPS: i64 = 7_000;
const DENSE_VOLATILITY_HIGH_BPS: i64 = 13_000;
const MEDIUM_VOLATILITY_LOW_BPS: i64 = 5_000;
const MEDIUM_VOLATILITY_HIGH_BPS: i64 = 17_000;
const SPARSE_VOLATILITY_LOW_BPS: i64 = 3_000;
const SPARSE_VOLATILITY_HIGH_BPS: i64 = 23_000;
const DEFAULT_EXPIRY_MS: i64 = 604_800_000;
const MAX_EXPIRY_MS: i64 = 604_800_000;

const ENVELOPE_TYPE_SPREADING: i64 = 0;
const ENVELOPE_TYPE_POOL: i64 = 1;
const ENVELOPE_TYPE_CLAIM: i64 = 2;
const ON_NEP17_ADAPTER_BASE: i64 = 1_000_000_000_000;
const ON_NEP17_ADAPTER_TYPE_MULTIPLIER: i64 = 1_000_000_000_000;
const ON_NEP17_ADAPTER_EXPIRY_MULTIPLIER: i64 = 1_000;
const ON_NEP17_LEGACY_PACK_BASE: i64 = 10;

const ELIGIBILITY_OK: i64 = 0;
const E_NOT_FOUND: i64 = 1;
const E_NOT_ACTIVE: i64 = 2;
const E_EXPIRED: i64 = 3;
const E_DEPLETED: i64 = 4;
const E_ALREADY_OPENED: i64 = 5;
const E_ALREADY_CLAIMED: i64 = 6;
const E_NOT_HOLDER: i64 = 7;
const E_INVALID_TYPE: i64 = 10;

const K_OWNER: u8 = 0x01;
const K_NEXT_ID: u8 = 0x02;
const K_TOTAL_ENVELOPES: u8 = 0x03;
const K_TOTAL_DISTRIBUTED: u8 = 0x04;
const K_TIME_OVERRIDE: u8 = 0x05;
const K_TOTAL_SUPPLY: u8 = 0x06;
const K_PAUSED: u8 = 0x07;

const P_CREATOR: u8 = 0x10;
const P_TOTAL: u8 = 0x11;
const P_PACKET: u8 = 0x12;
const P_TYPE: u8 = 0x13;
const P_PARENT: u8 = 0x14;
const P_OPENED: u8 = 0x15;
const P_REMAINING: u8 = 0x16;
const P_ACTIVE: u8 = 0x17;
const P_EXPIRY: u8 = 0x18;

const P_TOKEN_OWNER: u8 = 0x20;
const P_OPENED_AMOUNT: u8 = 0x21;
const P_POOL_CLAIMED: u8 = 0x22;
const P_POOL_CLAIM_INDEX: u8 = 0x23;
const P_OWNER_BALANCE: u8 = 0x24;
const NULL_PROBE_KEY: i64 = -9_223_372_036_854_775_000i64;

#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "neo")]
extern "C" {
    #[link_name = "storage_get_context"]
    fn neo_storage_get_context() -> i64;

    // NOTE: argument order is reversed so NeoVM pops (ctx, key) in syscall order.
    #[link_name = "storage_get"]
    fn neo_storage_get(key: i64, ctx: i64) -> i64;

    // NOTE: argument order is reversed so NeoVM pops (ctx, value, key) in syscall order.
    #[link_name = "storage_put"]
    fn neo_storage_put(key: i64, value: i64, ctx: i64);

    #[link_name = "runtime_get_time"]
    fn neo_get_time() -> i64;

    #[link_name = "runtime_get_random"]
    fn neo_get_random() -> i64;
}

#[cfg(not(target_arch = "wasm32"))]
unsafe fn neo_storage_get_context() -> i64 {
    0
}

#[cfg(not(target_arch = "wasm32"))]
unsafe fn neo_storage_get(_key: i64, _ctx: i64) -> i64 {
    0
}

#[cfg(not(target_arch = "wasm32"))]
unsafe fn neo_storage_put(_key: i64, _value: i64, _ctx: i64) {}

#[cfg(not(target_arch = "wasm32"))]
unsafe fn neo_get_time() -> i64 {
    0
}

#[cfg(not(target_arch = "wasm32"))]
unsafe fn neo_get_random() -> i64 {
    1
}

#[inline(never)]
fn add1(v: i64) -> i64 {
    v + 1
}
