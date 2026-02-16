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

#[neo_contract]
pub struct RedEnvelopeRustContract;

#[neo_contract]
impl RedEnvelopeRustContract {
    #[neo_method(name = "symbol")]
    pub fn symbol() -> i64 {
        1
    }

    #[neo_method(name = "decimals")]
    pub fn decimals() -> i64 {
        0
    }

    #[neo_method(name = "totalSupply")]
    pub fn total_supply() -> i64 {
        let Some(ctx) = ctx() else {
            return 0;
        };
        get_key_i64(&ctx, K_TOTAL_SUPPLY)
    }

    #[neo_method(name = "balanceOf")]
    pub fn balance_of(account: i64) -> i64 {
        if account <= 0 {
            return 0;
        }
        let Some(ctx) = ctx() else {
            return 0;
        };
        get_i64(&ctx, k2(P_OWNER_BALANCE, account))
    }

    #[neo_method(name = "ownerOf")]
    pub fn owner_of(token_id: i64) -> i64 {
        let Some(ctx) = ctx() else {
            return 0;
        };
        get_i64(&ctx, k2(P_TOKEN_OWNER, token_id))
    }

    #[neo_method(name = "properties")]
    pub fn properties(token_id: i64) -> i64 {
        let Some(ctx) = ctx() else {
            return 0;
        };
        if !token_exists(&ctx, token_id) {
            return 0;
        }
        env(&ctx, P_TYPE, token_id)
    }

    #[neo_method(name = "tokens")]
    pub fn tokens() -> i64 {
        Self::total_supply()
    }

    #[neo_method(name = "tokensOf")]
    pub fn tokens_of(owner: i64) -> i64 {
        Self::balance_of(owner)
    }

    #[neo_method(name = "getOwner")]
    pub fn get_owner() -> i64 {
        let Some(ctx) = ctx() else {
            return 0;
        };
        get_key_i64(&ctx, K_OWNER)
    }

    #[neo_method(name = "setOwner")]
    pub fn set_owner(new_owner: i64) {
        if new_owner <= 0 {
            return;
        }
        let Some(ctx) = ctx() else {
            return;
        };
        put_key_i64(&ctx, K_OWNER, new_owner);
    }

    #[neo_method(name = "isOwner")]
    pub fn is_owner() -> bool {
        let Some(ctx) = ctx() else {
            return false;
        };
        get_key_i64(&ctx, K_OWNER) > 0
    }

    #[neo_method(name = "verify")]
    pub fn verify() -> bool {
        Self::is_owner()
    }

    #[neo_method(name = "pause")]
    pub fn pause() {
        let Some(ctx) = ctx() else {
            return;
        };
        put_key_i64(&ctx, K_PAUSED, 1);
    }

    #[neo_method(name = "resume")]
    pub fn resume() {
        let Some(ctx) = ctx() else {
            return;
        };
        put_key_i64(&ctx, K_PAUSED, 0);
    }

    #[neo_method(name = "isPaused")]
    pub fn is_paused() -> bool {
        let Some(ctx) = ctx() else {
            return false;
        };
        get_key_i64(&ctx, K_PAUSED) != 0
    }

    #[neo_method(name = "update")]
    pub fn update(_nef: i64, _manifest: i64) {}

    #[neo_method(name = "destroy")]
    pub fn destroy() {}

    #[neo_method(name = "_deploy")]
    pub fn contract_deploy(data: i64, update: bool) {
        let Some(ctx) = ctx() else {
            return;
        };

        if !update {
            put_key_i64(&ctx, K_OWNER, data);
            put_key_i64(&ctx, K_NEXT_ID, 0);
            put_key_i64(&ctx, K_TOTAL_ENVELOPES, 0);
            put_key_i64(&ctx, K_TOTAL_DISTRIBUTED, 0);
            put_key_i64(&ctx, K_TIME_OVERRIDE, 0);
            put_key_i64(&ctx, K_TOTAL_SUPPLY, 0);
            put_key_i64(&ctx, K_PAUSED, 0);
        } else if get_key_i64(&ctx, K_OWNER) == 0 {
            put_key_i64(&ctx, K_OWNER, data);
        }
    }

    #[neo_method(name = "onNEP17Payment")]
    pub fn on_nep17_payment(from: i64, amount: i64, data: i64) {
        let Some(ctx) = ctx() else {
            return;
        };

        if is_paused_flag(&ctx) || from <= 0 || amount < MIN_AMOUNT {
            return;
        }

        let mut packet_count = 1;
        let mut envelope_type = ENVELOPE_TYPE_SPREADING;

        if data > 0 {
            let packed_packets = data / 10;
            if packed_packets > 0 {
                packet_count = packed_packets;
            }
            let packed_type = data % 10;
            if packed_type == ENVELOPE_TYPE_POOL {
                envelope_type = ENVELOPE_TYPE_POOL;
            }
        }

        if packet_count <= 0
            || packet_count > MAX_PACKETS
            || amount < packet_count * MIN_PER_PACKET
            || !(envelope_type == ENVELOPE_TYPE_SPREADING || envelope_type == ENVELOPE_TYPE_POOL)
        {
            return;
        }

        let _ = create_envelope(
            &ctx,
            from,
            amount,
            packet_count,
            DEFAULT_EXPIRY_MS,
            envelope_type,
            true,
        );
    }

    #[neo_method(name = "tokenURI")]
    pub fn token_uri(token_id: i64) -> i64 {
        let Some(ctx) = ctx() else {
            return 0;
        };
        if token_exists(&ctx, token_id) {
            token_id
        } else {
            0
        }
    }

    #[neo_method(name = "calculatePacketAmount")]
    pub fn calculate_packet_amount(envelope_id: i64, packet_index: i64) -> i64 {
        let Some(ctx) = ctx() else {
            return 0;
        };
        if !exists(&ctx, envelope_id) {
            return 0;
        }

        let packet = env(&ctx, P_PACKET, envelope_id);
        let remaining = env(&ctx, P_REMAINING, envelope_id);
        let remaining_packets = packet.saturating_sub(packet_index);

        if remaining <= 0 || remaining_packets <= 0 {
            return 0;
        }

        calc_packet(
            remaining,
            remaining_packets,
            0,
            env(&ctx, P_TOTAL, envelope_id),
            packet,
        )
    }

    #[neo_method(name = "claimFromPool")]
    pub fn claim_from_pool(pool_id: i64, claimer: i64) -> i64 {
        let Some(ctx) = ctx() else {
            return 0;
        };

        if is_paused_flag(&ctx)
            || claimer <= 0
            || !exists(&ctx, pool_id)
            || env(&ctx, P_TYPE, pool_id) != ENVELOPE_TYPE_POOL
            || env(&ctx, P_ACTIVE, pool_id) == 0
            || env(&ctx, P_OPENED, pool_id) >= env(&ctx, P_PACKET, pool_id)
            || now_ms(&ctx) > env(&ctx, P_EXPIRY, pool_id)
            || get_i64(&ctx, k3(P_POOL_CLAIMED, pool_id, claimer)) > 0
        {
            return 0;
        }

        let opened = env(&ctx, P_OPENED, pool_id);
        let packet = env(&ctx, P_PACKET, pool_id);
        let remaining = env(&ctx, P_REMAINING, pool_id);
        let amount = calc_packet(
            remaining,
            packet.saturating_sub(opened),
            0,
            env(&ctx, P_TOTAL, pool_id),
            packet,
        );
        if amount <= 0 || amount > remaining {
            return 0;
        }

        put_i64(&ctx, k3(P_POOL_CLAIMED, pool_id, claimer), amount);

        let opened2 = opened.saturating_add(1);
        set_env(&ctx, P_OPENED, pool_id, opened2);

        let rem2 = remaining.saturating_sub(amount);
        set_env(&ctx, P_REMAINING, pool_id, rem2);
        if rem2 == 0 || opened2 >= packet {
            set_env(&ctx, P_ACTIVE, pool_id, 0);
        }

        let claim_id = alloc_id(&ctx);
        set_env(&ctx, P_CREATOR, claim_id, env(&ctx, P_CREATOR, pool_id));
        set_env(&ctx, P_TOTAL, claim_id, amount);
        set_env(&ctx, P_PACKET, claim_id, 1);
        set_env(&ctx, P_TYPE, claim_id, ENVELOPE_TYPE_CLAIM);
        set_env(&ctx, P_PARENT, claim_id, pool_id);
        set_env(&ctx, P_OPENED, claim_id, 0);
        set_env(&ctx, P_REMAINING, claim_id, amount);
        set_env(&ctx, P_ACTIVE, claim_id, 1);
        set_env(&ctx, P_EXPIRY, claim_id, env(&ctx, P_EXPIRY, pool_id));

        mint_token(&ctx, claim_id, claimer);
        put_i64(&ctx, k3(P_POOL_CLAIM_INDEX, pool_id, opened2), claim_id);

        claim_id
    }

    #[neo_method(name = "openClaim")]
    pub fn open_claim(claim_id: i64, opener: i64) -> i64 {
        let Some(ctx) = ctx() else {
            return 0;
        };

        if is_paused_flag(&ctx)
            || opener <= 0
            || !exists(&ctx, claim_id)
            || env(&ctx, P_TYPE, claim_id) != ENVELOPE_TYPE_CLAIM
            || get_i64(&ctx, k2(P_TOKEN_OWNER, claim_id)) != opener
            || env(&ctx, P_ACTIVE, claim_id) == 0
            || env(&ctx, P_OPENED, claim_id) > 0
            || env(&ctx, P_REMAINING, claim_id) <= 0
            || now_ms(&ctx) > env(&ctx, P_EXPIRY, claim_id)
        {
            return 0;
        }

        let amount = env(&ctx, P_REMAINING, claim_id);
        set_env(&ctx, P_OPENED, claim_id, 1);
        set_env(&ctx, P_REMAINING, claim_id, 0);
        set_env(&ctx, P_ACTIVE, claim_id, 0);
        amount
    }

    #[neo_method(name = "transferClaim")]
    pub fn transfer_claim(claim_id: i64, from: i64, to: i64) {
        let Some(ctx) = ctx() else {
            return;
        };

        if is_paused_flag(&ctx)
            || from <= 0
            || to <= 0
            || !exists(&ctx, claim_id)
            || env(&ctx, P_TYPE, claim_id) != ENVELOPE_TYPE_CLAIM
            || get_i64(&ctx, k2(P_TOKEN_OWNER, claim_id)) != from
        {
            return;
        }

        transfer_token(&ctx, claim_id, from, to);
    }

    #[neo_method(name = "reclaimPool")]
    pub fn reclaim_pool(pool_id: i64, creator: i64) -> i64 {
        let Some(ctx) = ctx() else {
            return 0;
        };

        if is_paused_flag(&ctx)
            || creator <= 0
            || !exists(&ctx, pool_id)
            || env(&ctx, P_TYPE, pool_id) != ENVELOPE_TYPE_POOL
            || env(&ctx, P_CREATOR, pool_id) != creator
            || now_ms(&ctx) <= env(&ctx, P_EXPIRY, pool_id)
        {
            return 0;
        }

        let mut refund = env(&ctx, P_REMAINING, pool_id);
        let opened = env(&ctx, P_OPENED, pool_id);
        let mut i = 1;
        while i <= opened {
            let claim_id = get_i64(&ctx, k3(P_POOL_CLAIM_INDEX, pool_id, i));
            if claim_id > 0
                && env(&ctx, P_TYPE, claim_id) == ENVELOPE_TYPE_CLAIM
                && env(&ctx, P_ACTIVE, claim_id) != 0
            {
                let rem = env(&ctx, P_REMAINING, claim_id);
                if rem > 0 {
                    refund = refund.saturating_add(rem);
                    set_env(&ctx, P_REMAINING, claim_id, 0);
                    set_env(&ctx, P_ACTIVE, claim_id, 0);
                }
            }
            i += 1;
        }

        if refund <= 0 {
            return 0;
        }

        set_env(&ctx, P_REMAINING, pool_id, 0);
        set_env(&ctx, P_ACTIVE, pool_id, 0);
        refund
    }

    #[neo_method(name = "getEnvelopeState")]
    pub fn get_envelope_state(envelope_id: i64) -> i64 {
        let Some(ctx) = ctx() else {
            return 0;
        };
        if !exists(&ctx, envelope_id) {
            return 0;
        }
        env(&ctx, P_REMAINING, envelope_id)
    }

    #[neo_method(name = "getClaimState")]
    pub fn get_claim_state(claim_id: i64) -> i64 {
        let Some(ctx) = ctx() else {
            return 0;
        };
        if !exists(&ctx, claim_id) || env(&ctx, P_TYPE, claim_id) != ENVELOPE_TYPE_CLAIM {
            return 0;
        }
        env(&ctx, P_REMAINING, claim_id)
    }

    #[neo_method(name = "checkEligibility")]
    pub fn check_eligibility(envelope_id: i64, user: i64) -> i64 {
        let Some(ctx) = ctx() else {
            return E_NOT_FOUND;
        };
        eligibility_status(&ctx, envelope_id, user, false)
    }

    #[neo_method(name = "checkOpenEligibility")]
    pub fn check_open_eligibility(envelope_id: i64, user: i64) -> i64 {
        let Some(ctx) = ctx() else {
            return E_NOT_FOUND;
        };
        eligibility_status(&ctx, envelope_id, user, true)
    }

    #[neo_method(name = "hasOpened")]
    pub fn has_opened(envelope_id: i64, opener: i64) -> bool {
        let Some(ctx) = ctx() else {
            return false;
        };
        get_i64(&ctx, k3(P_OPENED_AMOUNT, envelope_id, opener)) > 0
    }

    #[neo_method(name = "getOpenedAmount")]
    pub fn get_opened_amount(envelope_id: i64, opener: i64) -> i64 {
        let Some(ctx) = ctx() else {
            return 0;
        };
        get_i64(&ctx, k3(P_OPENED_AMOUNT, envelope_id, opener))
    }

    #[neo_method(name = "hasClaimedFromPool")]
    pub fn has_claimed_from_pool(pool_id: i64, claimer: i64) -> bool {
        let Some(ctx) = ctx() else {
            return false;
        };
        get_i64(&ctx, k3(P_POOL_CLAIMED, pool_id, claimer)) > 0
    }

    #[neo_method(name = "getPoolClaimedAmount")]
    pub fn get_pool_claimed_amount(pool_id: i64, claimer: i64) -> i64 {
        let Some(ctx) = ctx() else {
            return 0;
        };
        get_i64(&ctx, k3(P_POOL_CLAIMED, pool_id, claimer))
    }

    #[neo_method(name = "getCalculationConstants")]
    pub fn get_calculation_constants() -> i64 {
        MIN_AMOUNT
    }

    #[neo_method(name = "getTotalEnvelopes")]
    pub fn get_total_envelopes() -> i64 {
        let Some(ctx) = ctx() else {
            return 0;
        };
        get_key_i64(&ctx, K_TOTAL_ENVELOPES)
    }

    #[neo_method(name = "getTotalDistributed")]
    pub fn get_total_distributed() -> i64 {
        let Some(ctx) = ctx() else {
            return 0;
        };
        get_key_i64(&ctx, K_TOTAL_DISTRIBUTED)
    }

    #[neo_method(name = "getPoolClaimIdByIndex")]
    pub fn get_pool_claim_id_by_index(pool_id: i64, claim_index: i64) -> i64 {
        let Some(ctx) = ctx() else {
            return 0;
        };
        get_i64(&ctx, k3(P_POOL_CLAIM_INDEX, pool_id, claim_index))
    }

    #[neo_method(name = "transfer")]
    pub fn transfer(to: i64, token_id: i64, _data: i64) -> bool {
        let Some(ctx) = ctx() else {
            return false;
        };

        if is_paused_flag(&ctx) || to <= 0 || !token_exists(&ctx, token_id) {
            return false;
        }

        let t = env(&ctx, P_TYPE, token_id);
        if !(t == ENVELOPE_TYPE_SPREADING || t == ENVELOPE_TYPE_CLAIM) {
            return false;
        }

        let from = get_i64(&ctx, k2(P_TOKEN_OWNER, token_id));
        if from <= 0 {
            return false;
        }

        transfer_token(&ctx, token_id, from, to)
    }

    #[neo_method(name = "openEnvelope")]
    pub fn open_envelope(envelope_id: i64, opener: i64) -> i64 {
        let Some(ctx) = ctx() else {
            return 0;
        };

        if is_paused_flag(&ctx)
            || opener <= 0
            || !exists(&ctx, envelope_id)
            || env(&ctx, P_TYPE, envelope_id) != ENVELOPE_TYPE_SPREADING
            || env(&ctx, P_ACTIVE, envelope_id) == 0
            || env(&ctx, P_OPENED, envelope_id) >= env(&ctx, P_PACKET, envelope_id)
            || now_ms(&ctx) > env(&ctx, P_EXPIRY, envelope_id)
            || get_i64(&ctx, k2(P_TOKEN_OWNER, envelope_id)) != opener
            || get_i64(&ctx, k3(P_OPENED_AMOUNT, envelope_id, opener)) > 0
        {
            return 0;
        }

        let remaining = env(&ctx, P_REMAINING, envelope_id);
        let opened = env(&ctx, P_OPENED, envelope_id);
        let packet = env(&ctx, P_PACKET, envelope_id);
        let total_amount = env(&ctx, P_TOTAL, envelope_id);
        let amount = calc_packet(
            remaining,
            packet.saturating_sub(opened),
            0,
            total_amount,
            packet,
        );
        if amount <= 0 || amount > remaining {
            return 0;
        }

        put_i64(&ctx, k3(P_OPENED_AMOUNT, envelope_id, opener), amount);
        set_env(&ctx, P_OPENED, envelope_id, opened.saturating_add(1));

        let rem2 = remaining.saturating_sub(amount);
        set_env(&ctx, P_REMAINING, envelope_id, rem2);
        if rem2 == 0 || opened.saturating_add(1) >= packet {
            set_env(&ctx, P_ACTIVE, envelope_id, 0);
        }

        amount
    }

    #[neo_method(name = "transferEnvelope")]
    pub fn transfer_envelope(envelope_id: i64, from: i64, to: i64, _data: i64) {
        let Some(ctx) = ctx() else {
            return;
        };

        if is_paused_flag(&ctx)
            || from <= 0
            || to <= 0
            || !exists(&ctx, envelope_id)
            || env(&ctx, P_TYPE, envelope_id) != ENVELOPE_TYPE_SPREADING
            || get_i64(&ctx, k2(P_TOKEN_OWNER, envelope_id)) != from
        {
            return;
        }

        let _ = transfer_token(&ctx, envelope_id, from, to);
    }

    #[neo_method(name = "reclaimEnvelope")]
    pub fn reclaim_envelope(envelope_id: i64, creator: i64) -> i64 {
        let Some(ctx) = ctx() else {
            return 0;
        };

        if is_paused_flag(&ctx)
            || creator <= 0
            || !exists(&ctx, envelope_id)
            || env(&ctx, P_TYPE, envelope_id) != ENVELOPE_TYPE_SPREADING
            || env(&ctx, P_CREATOR, envelope_id) != creator
            || env(&ctx, P_ACTIVE, envelope_id) == 0
            || now_ms(&ctx) <= env(&ctx, P_EXPIRY, envelope_id)
        {
            return 0;
        }

        let refund = env(&ctx, P_REMAINING, envelope_id);
        if refund <= 0 {
            return 0;
        }

        set_env(&ctx, P_REMAINING, envelope_id, 0);
        set_env(&ctx, P_ACTIVE, envelope_id, 0);
        refund
    }

    #[neo_method(name = "_initialize")]
    pub fn initialize() {}
}

fn create_envelope(
    ctx: &NeoStorageContext,
    from: i64,
    amount: i64,
    packet_count: i64,
    expiry_ms: i64,
    envelope_type: i64,
    update_totals: bool,
) -> i64 {
    if from <= 0
        || amount < MIN_AMOUNT
        || packet_count <= 0
        || packet_count > MAX_PACKETS
        || amount < packet_count.saturating_mul(MIN_PER_PACKET)
        || expiry_ms <= 0
        || expiry_ms > MAX_EXPIRY_MS
        || !(envelope_type == ENVELOPE_TYPE_SPREADING || envelope_type == ENVELOPE_TYPE_POOL)
    {
        return 0;
    }

    let id = alloc_id(ctx);
    set_env(ctx, P_CREATOR, id, from);
    set_env(ctx, P_TOTAL, id, amount);
    set_env(ctx, P_PACKET, id, packet_count);
    set_env(ctx, P_TYPE, id, envelope_type);
    set_env(ctx, P_PARENT, id, 0);
    set_env(ctx, P_OPENED, id, 0);
    set_env(ctx, P_REMAINING, id, amount);
    set_env(ctx, P_ACTIVE, id, 1);
    set_env(ctx, P_EXPIRY, id, now_ms(ctx).saturating_add(expiry_ms));

    if envelope_type == ENVELOPE_TYPE_SPREADING {
        mint_token(ctx, id, from);
    }

    if update_totals {
        put_key_i64(
            ctx,
            K_TOTAL_ENVELOPES,
            get_key_i64(ctx, K_TOTAL_ENVELOPES).saturating_add(1),
        );
        put_key_i64(
            ctx,
            K_TOTAL_DISTRIBUTED,
            get_key_i64(ctx, K_TOTAL_DISTRIBUTED).saturating_add(amount),
        );
    }

    id
}

fn eligibility_status(ctx: &NeoStorageContext, envelope_id: i64, user: i64, include_action_checks: bool) -> i64 {
    if !exists(ctx, envelope_id) {
        return E_NOT_FOUND;
    }

    if env(ctx, P_ACTIVE, envelope_id) == 0 {
        return E_NOT_ACTIVE;
    }

    if include_action_checks {
        if now_ms(ctx) > env(ctx, P_EXPIRY, envelope_id) {
            return E_EXPIRED;
        }

        if env(ctx, P_OPENED, envelope_id) >= env(ctx, P_PACKET, envelope_id)
            || env(ctx, P_REMAINING, envelope_id) <= 0
        {
            return E_DEPLETED;
        }

        let t = env(ctx, P_TYPE, envelope_id);
        if t == ENVELOPE_TYPE_POOL {
            if get_i64(ctx, k3(P_POOL_CLAIMED, envelope_id, user)) > 0 {
                return E_ALREADY_CLAIMED;
            }
        } else if t == ENVELOPE_TYPE_SPREADING || t == ENVELOPE_TYPE_CLAIM {
            if get_i64(ctx, k2(P_TOKEN_OWNER, envelope_id)) != user {
                return E_NOT_HOLDER;
            }

            if t == ENVELOPE_TYPE_SPREADING && get_i64(ctx, k3(P_OPENED_AMOUNT, envelope_id, user)) > 0 {
                return E_ALREADY_OPENED;
            }

            if t == ENVELOPE_TYPE_CLAIM && env(ctx, P_OPENED, envelope_id) > 0 {
                return E_ALREADY_OPENED;
            }
        } else {
            return E_INVALID_TYPE;
        }
    }

    ELIGIBILITY_OK
}

fn mint_token(ctx: &NeoStorageContext, token_id: i64, owner: i64) {
    put_i64(ctx, k2(P_TOKEN_OWNER, token_id), owner);

    let bal_key = k2(P_OWNER_BALANCE, owner);
    let bal = get_i64(ctx, bal_key.clone());
    put_i64(ctx, bal_key, bal.saturating_add(1));

    put_key_i64(
        ctx,
        K_TOTAL_SUPPLY,
        get_key_i64(ctx, K_TOTAL_SUPPLY).saturating_add(1),
    );
}

fn transfer_token(ctx: &NeoStorageContext, token_id: i64, from: i64, to: i64) -> bool {
    if from <= 0 || to <= 0 {
        return false;
    }
    if get_i64(ctx, k2(P_TOKEN_OWNER, token_id)) != from {
        return false;
    }

    put_i64(ctx, k2(P_TOKEN_OWNER, token_id), to);

    let from_key = k2(P_OWNER_BALANCE, from);
    let to_key = k2(P_OWNER_BALANCE, to);

    let from_bal = get_i64(ctx, from_key.clone());
    if from_bal > 0 {
        put_i64(ctx, from_key, from_bal - 1);
    }

    let to_bal = get_i64(ctx, to_key.clone());
    put_i64(ctx, to_key, to_bal.saturating_add(1));

    true
}

fn ctx() -> Option<NeoStorageContext> {
    NeoRuntime::get_storage_context().ok()
}

fn key(prefix: u8) -> NeoByteString {
    NeoByteString::from_slice(&[prefix])
}

fn k2(prefix: u8, a: i64) -> NeoByteString {
    let mut out = [0u8; 9];
    out[0] = prefix;
    out[1..9].copy_from_slice(&a.to_le_bytes());
    NeoByteString::from_slice(&out)
}

fn k3(prefix: u8, a: i64, b: i64) -> NeoByteString {
    let mut out = [0u8; 17];
    out[0] = prefix;
    out[1..9].copy_from_slice(&a.to_le_bytes());
    out[9..17].copy_from_slice(&b.to_le_bytes());
    NeoByteString::from_slice(&out)
}

fn put_key_i64(ctx: &NeoStorageContext, prefix: u8, v: i64) {
    let _ = NeoStorage::put(ctx, &key(prefix), &NeoByteString::from_slice(&v.to_le_bytes()));
}

fn get_key_i64(ctx: &NeoStorageContext, prefix: u8) -> i64 {
    get_i64(ctx, key(prefix))
}

fn put_i64(ctx: &NeoStorageContext, key: NeoByteString, v: i64) {
    let _ = NeoStorage::put(ctx, &key, &NeoByteString::from_slice(&v.to_le_bytes()));
}

fn get_i64(ctx: &NeoStorageContext, key: NeoByteString) -> i64 {
    let Ok(bytes) = NeoStorage::get(ctx, &key) else {
        return 0;
    };
    let s = bytes.as_slice();
    if s.is_empty() {
        return 0;
    }

    let mut buf = [0u8; 8];
    let mut i = 0;
    while i < 8 && i < s.len() {
        buf[i] = s[i];
        i += 1;
    }
    i64::from_le_bytes(buf)
}

fn exists(ctx: &NeoStorageContext, id: i64) -> bool {
    env(ctx, P_CREATOR, id) > 0
}

fn token_exists(ctx: &NeoStorageContext, token_id: i64) -> bool {
    get_i64(ctx, k2(P_TOKEN_OWNER, token_id)) > 0
}

fn env(ctx: &NeoStorageContext, prefix: u8, id: i64) -> i64 {
    get_i64(ctx, k2(prefix, id))
}

fn set_env(ctx: &NeoStorageContext, prefix: u8, id: i64, v: i64) {
    put_i64(ctx, k2(prefix, id), v)
}

fn alloc_id(ctx: &NeoStorageContext) -> i64 {
    let id = get_key_i64(ctx, K_NEXT_ID).saturating_add(1);
    put_key_i64(ctx, K_NEXT_ID, id);
    id
}

fn now_ms(ctx: &NeoStorageContext) -> i64 {
    let t = get_key_i64(ctx, K_TIME_OVERRIDE);
    if t > 0 {
        return t;
    }

    #[cfg(target_arch = "wasm32")]
    {
        NeoRuntime::get_time()
            .map(|x| x.as_i64_saturating())
            .unwrap_or(0)
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = ctx;
        0
    }
}

fn is_paused_flag(ctx: &NeoStorageContext) -> bool {
    get_key_i64(ctx, K_PAUSED) != 0
}

fn calc_packet(
    remaining_amount: i64,
    packets_left: i64,
    neo_balance: i64,
    total_amount: i64,
    total_packets: i64,
) -> i64 {
    if remaining_amount <= 0 || packets_left <= 0 || total_amount <= 0 || total_packets <= 0 {
        return 0;
    }

    if packets_left == 1 {
        return remaining_amount;
    }

    let min_per_packet = MIN_PER_PACKET;
    let feasible_max = remaining_amount.saturating_sub((packets_left - 1).saturating_mul(min_per_packet));
    if feasible_max <= min_per_packet {
        return min_per_packet;
    }

    let dynamic_average = ceiling_div(remaining_amount, packets_left);
    let lower_band_bps = volatility_lower_bps(total_packets);
    let upper_band_bps = volatility_upper_bps(total_packets);

    let mut min_for_this = dynamic_average
        .saturating_mul(lower_band_bps)
        / PERCENT_BASE;
    if min_for_this < min_per_packet {
        min_for_this = min_per_packet;
    }

    let mut max_for_this = ceiling_div(dynamic_average.saturating_mul(upper_band_bps), PERCENT_BASE);

    let cap_by_percent = ceiling_div(total_amount.saturating_mul(MAX_SINGLE_PACKET_BPS), PERCENT_BASE);
    let cap_by_average = ceiling_div(
        dynamic_average.saturating_mul(MAX_SINGLE_PACKET_AVG_BPS),
        PERCENT_BASE,
    );
    let mut hard_cap = cap_by_percent.max(cap_by_average);
    if hard_cap < min_per_packet {
        hard_cap = min_per_packet;
    }

    if max_for_this > hard_cap {
        max_for_this = hard_cap;
    }
    if max_for_this > feasible_max {
        max_for_this = feasible_max;
    }

    if min_for_this > max_for_this {
        min_for_this = min_per_packet;
        max_for_this = feasible_max;
    }

    let range = max_for_this.saturating_sub(min_for_this).saturating_add(1);
    if range <= 0 {
        return min_per_packet.min(feasible_max);
    }

    let entropy = runtime_entropy();
    let mut divisor = 1i64;

    let roll1 = (entropy / divisor).rem_euclid(range);
    divisor = mul_clamp_max(divisor, range);
    let roll2 = (entropy / divisor).rem_euclid(range);
    divisor = mul_clamp_max(divisor, range);
    let mut best_roll = roll1.saturating_add(roll2) / 2;

    let mut extra_trials = 0;
    if neo_balance >= 1000 {
        extra_trials = 2;
    } else if neo_balance >= 100 {
        extra_trials = 1;
    }

    let mut i = 0;
    while i < extra_trials {
        let candidate1 = (entropy / divisor).rem_euclid(range);
        divisor = mul_clamp_max(divisor, range);
        let candidate2 = (entropy / divisor).rem_euclid(range);
        divisor = mul_clamp_max(divisor, range);

        let candidate_roll = candidate1.saturating_add(candidate2) / 2;
        if candidate_roll > best_roll {
            best_roll = candidate_roll;
        }
        i += 1;
    }

    let mut amount = min_for_this.saturating_add(best_roll);
    if amount < min_per_packet {
        amount = min_per_packet;
    }
    if amount > feasible_max {
        amount = feasible_max;
    }
    amount
}

fn runtime_entropy() -> i64 {
    #[cfg(target_arch = "wasm32")]
    {
        let random = NeoRuntime::get_random()
            .map(|x| x.as_i64_saturating())
            .unwrap_or(1);

        let mut entropy = if random < 0 {
            if random == i64::MIN {
                i64::MAX
            } else {
                random.abs()
            }
        } else {
            random
        };

        if entropy == 0 {
            entropy = 1;
        }
        return entropy;
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        1
    }
}

fn mul_clamp_max(a: i64, b: i64) -> i64 {
    if a <= 0 || b <= 0 {
        return 0;
    }
    if a > i64::MAX / b {
        i64::MAX
    } else {
        a * b
    }
}

fn ceiling_div(numerator: i64, denominator: i64) -> i64 {
    if denominator <= 0 || numerator <= 0 {
        return 0;
    }
    numerator.saturating_add(denominator.saturating_sub(1)) / denominator
}

fn volatility_lower_bps(total_packets: i64) -> i64 {
    if total_packets >= DENSE_PACKET_THRESHOLD {
        DENSE_VOLATILITY_LOW_BPS
    } else if total_packets >= MEDIUM_PACKET_THRESHOLD {
        MEDIUM_VOLATILITY_LOW_BPS
    } else {
        SPARSE_VOLATILITY_LOW_BPS
    }
}

fn volatility_upper_bps(total_packets: i64) -> i64 {
    if total_packets >= DENSE_PACKET_THRESHOLD {
        DENSE_VOLATILITY_HIGH_BPS
    } else if total_packets >= MEDIUM_PACKET_THRESHOLD {
        MEDIUM_VOLATILITY_HIGH_BPS
    } else {
        SPARSE_VOLATILITY_HIGH_BPS
    }
}
