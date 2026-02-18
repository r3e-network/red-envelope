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
        get_key_i64(K_TOTAL_SUPPLY)
    }

    #[neo_method(name = "balanceOf")]
    pub fn balance_of(account: i64) -> i64 {
        if account == 0 {
            return 0;
        }
        get_i64(k2(P_OWNER_BALANCE, account))
    }

    #[neo_method(name = "ownerOf")]
    pub fn owner_of(token_id: i64) -> i64 {
        get_i64(k2(P_TOKEN_OWNER, token_id))
    }

    #[neo_method(name = "properties")]
    pub fn properties(token_id: i64) -> i64 {
        if !token_exists(token_id) {
            return 0;
        }
        env(P_TYPE, token_id)
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
        get_key_i64(K_OWNER)
    }

    #[neo_method(name = "setOwner")]
    pub fn set_owner(new_owner: i64) {
        if new_owner == 0 {
            return;
        }
        put_key_i64(K_OWNER, new_owner);
    }

    #[neo_method(name = "isOwner")]
    pub fn is_owner() -> bool {
        get_key_i64(K_OWNER) != 0
    }

    #[neo_method(name = "verify")]
    pub fn verify() -> bool {
        Self::is_owner()
    }

    #[neo_method(name = "pause")]
    pub fn pause() {
        put_key_i64(K_PAUSED, 1);
    }

    #[neo_method(name = "resume")]
    pub fn resume() {
        put_key_i64(K_PAUSED, 0);
    }

    #[neo_method(name = "isPaused")]
    pub fn is_paused() -> bool {
        get_key_i64(K_PAUSED) != 0
    }

    #[neo_method(name = "update")]
    pub fn update(_nef: i64, _manifest: i64) {}

    #[neo_method(name = "destroy")]
    pub fn destroy() {}

    #[neo_method(name = "_deploy")]
    pub fn contract_deploy(data: i64, update: bool) {
        if !update {
            put_key_i64(K_OWNER, data);
            put_key_i64(K_NEXT_ID, 0);
            put_key_i64(K_TOTAL_ENVELOPES, 0);
            put_key_i64(K_TOTAL_DISTRIBUTED, 0);
            put_key_i64(K_TIME_OVERRIDE, 0);
            put_key_i64(K_TOTAL_SUPPLY, 0);
            put_key_i64(K_PAUSED, 0);
        } else if get_key_i64(K_OWNER) == 0 {
            put_key_i64(K_OWNER, data);
        }
    }

    #[neo_method(name = "onNEP17Payment")]
    pub fn on_nep17_payment(from: i64, amount: i64, data: i64) {
        if is_paused_flag() || from == 0 || amount < MIN_AMOUNT {
            return;
        }

        let mut packet_count = 1;
        let mut envelope_type = ENVELOPE_TYPE_SPREADING;
        let mut expiry_ms = DEFAULT_EXPIRY_MS;

        // Adapter v3 object[] encoding:
        // spread => BASE + packetCount + expiryMs * MULTIPLIER
        // pool   => BASE + TYPE_MULTIPLIER + packetCount + expiryMs * MULTIPLIER
        if data >= ON_NEP17_ADAPTER_BASE {
            let mut packed = data - ON_NEP17_ADAPTER_BASE;
            if packed >= ON_NEP17_ADAPTER_TYPE_MULTIPLIER {
                packed -= ON_NEP17_ADAPTER_TYPE_MULTIPLIER;
                envelope_type = ENVELOPE_TYPE_POOL;
            }
            packet_count = packed % ON_NEP17_ADAPTER_EXPIRY_MULTIPLIER;
            let adapter_expiry = packed / ON_NEP17_ADAPTER_EXPIRY_MULTIPLIER;
            if adapter_expiry > 0 {
                expiry_ms = adapter_expiry;
            }
        // Backward-compat for older sign-based adapter payloads.
        } else if data <= -ON_NEP17_ADAPTER_BASE {
            let packed = data.saturating_abs() - ON_NEP17_ADAPTER_BASE;
            packet_count = packed % ON_NEP17_ADAPTER_EXPIRY_MULTIPLIER;
            let adapter_expiry = packed / ON_NEP17_ADAPTER_EXPIRY_MULTIPLIER;
            if adapter_expiry > 0 {
                expiry_ms = adapter_expiry;
            }
            envelope_type = ENVELOPE_TYPE_POOL;
        } else if data > 0 {
            // Legacy packed-integer path for backward compatibility.
            let packed_packets = data / ON_NEP17_LEGACY_PACK_BASE;
            if packed_packets > 0 {
                packet_count = packed_packets;
            }
            let packed_type = data - packed_packets * ON_NEP17_LEGACY_PACK_BASE;
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
            from,
            amount,
            packet_count,
            expiry_ms,
            envelope_type,
            true,
        );
    }

    #[neo_method(name = "tokenURI")]
    pub fn token_uri(token_id: i64) -> i64 {
        if token_exists(token_id) {
            token_id
        } else {
            0
        }
    }

    #[neo_method(name = "calculatePacketAmount")]
    pub fn calculate_packet_amount(envelope_id: i64, packet_index: i64) -> i64 {
        if !exists(envelope_id) {
            return 0;
        }

        let packet = env(P_PACKET, envelope_id);
        let remaining = env(P_REMAINING, envelope_id);
        let remaining_packets = packet.saturating_sub(packet_index);

        if remaining <= 0 || remaining_packets <= 0 {
            return 0;
        }

        calc_packet(
            remaining,
            remaining_packets,
            0,
            env(P_TOTAL, envelope_id),
            packet,
        )
    }

    #[neo_method(name = "claimFromPool")]
    pub fn claim_from_pool(pool_id: i64, claimer: i64) -> i64 {
        if is_paused_flag()
            || claimer == 0
            || !exists(pool_id)
            || env(P_TYPE, pool_id) != ENVELOPE_TYPE_POOL
            || env(P_ACTIVE, pool_id) == 0
            || env(P_OPENED, pool_id) >= env(P_PACKET, pool_id)
            || now_ms() > env(P_EXPIRY, pool_id)
            || get_i64(k3(P_POOL_CLAIMED, pool_id, claimer)) > 0
        {
            return 0;
        }

        let opened = env(P_OPENED, pool_id);
        let packet = env(P_PACKET, pool_id);
        let remaining = env(P_REMAINING, pool_id);
        let amount = calc_packet(
            remaining,
            packet.saturating_sub(opened),
            0,
            env(P_TOTAL, pool_id),
            packet,
        );
        if amount <= 0 || amount > remaining {
            return 0;
        }

        put_i64(k3(P_POOL_CLAIMED, pool_id, claimer), amount);

        let opened2 = opened.saturating_add(1);
        set_env(P_OPENED, pool_id, opened2);

        let rem2 = remaining.saturating_sub(amount);
        set_env(P_REMAINING, pool_id, rem2);
        if rem2 == 0 || opened2 >= packet {
            set_env(P_ACTIVE, pool_id, 0);
        }

        let claim_id = alloc_id();
        set_env(P_CREATOR, claim_id, env(P_CREATOR, pool_id));
        set_env(P_TOTAL, claim_id, amount);
        set_env(P_PACKET, claim_id, 1);
        set_env(P_TYPE, claim_id, ENVELOPE_TYPE_CLAIM);
        set_env(P_PARENT, claim_id, pool_id);
        set_env(P_OPENED, claim_id, 0);
        set_env(P_REMAINING, claim_id, amount);
        set_env(P_ACTIVE, claim_id, 1);
        set_env(P_EXPIRY, claim_id, env(P_EXPIRY, pool_id));

        mint_token(claim_id, claimer);
        put_i64(k3(P_POOL_CLAIM_INDEX, pool_id, opened2), claim_id);

        claim_id
    }

    #[neo_method(name = "openClaim")]
    pub fn open_claim(claim_id: i64, opener: i64) -> i64 {
        if is_paused_flag()
            || opener == 0
            || !exists(claim_id)
            || env(P_TYPE, claim_id) != ENVELOPE_TYPE_CLAIM
            || get_i64(k2(P_TOKEN_OWNER, claim_id)) != opener
            || env(P_ACTIVE, claim_id) == 0
            || env(P_OPENED, claim_id) > 0
            || env(P_REMAINING, claim_id) <= 0
            || now_ms() > env(P_EXPIRY, claim_id)
        {
            return 0;
        }

        let amount = env(P_REMAINING, claim_id);
        set_env(P_OPENED, claim_id, 1);
        set_env(P_REMAINING, claim_id, 0);
        set_env(P_ACTIVE, claim_id, 0);
        amount
    }

    #[neo_method(name = "transferClaim")]
    pub fn transfer_claim(claim_id: i64, from: i64, to: i64) {
        if is_paused_flag()
            || from == 0
            || to == 0
            || !exists(claim_id)
            || env(P_TYPE, claim_id) != ENVELOPE_TYPE_CLAIM
            || get_i64(k2(P_TOKEN_OWNER, claim_id)) != from
        {
            return;
        }

        transfer_token(claim_id, from, to);
    }

    #[neo_method(name = "reclaimPool")]
    pub fn reclaim_pool(pool_id: i64, creator: i64) -> i64 {
        if is_paused_flag()
            || creator == 0
            || !exists(pool_id)
            || env(P_TYPE, pool_id) != ENVELOPE_TYPE_POOL
            || env(P_CREATOR, pool_id) != creator
            || now_ms() <= env(P_EXPIRY, pool_id)
        {
            return 0;
        }

        let mut refund = env(P_REMAINING, pool_id);
        let opened = env(P_OPENED, pool_id);
        let mut i = 1;
        while i <= opened {
            let claim_id = get_i64(k3(P_POOL_CLAIM_INDEX, pool_id, i));
            if claim_id > 0
                && env(P_TYPE, claim_id) == ENVELOPE_TYPE_CLAIM
                && env(P_ACTIVE, claim_id) != 0
            {
                let rem = env(P_REMAINING, claim_id);
                if rem > 0 {
                    refund = refund.saturating_add(rem);
                    set_env(P_REMAINING, claim_id, 0);
                    set_env(P_ACTIVE, claim_id, 0);
                }
            }
            i += 1;
        }

        if refund <= 0 {
            return 0;
        }

        set_env(P_REMAINING, pool_id, 0);
        set_env(P_ACTIVE, pool_id, 0);
        refund
    }

    #[neo_method(name = "getEnvelopeState")]
    pub fn get_envelope_state(envelope_id: i64) -> i64 {
        if !exists(envelope_id) {
            return 0;
        }
        env(P_REMAINING, envelope_id)
    }

    #[neo_method(name = "getClaimState")]
    pub fn get_claim_state(claim_id: i64) -> i64 {
        if !exists(claim_id) || env(P_TYPE, claim_id) != ENVELOPE_TYPE_CLAIM {
            return 0;
        }
        env(P_REMAINING, claim_id)
    }

    #[neo_method(name = "checkEligibility")]
    pub fn check_eligibility(envelope_id: i64, user: i64) -> i64 {
        eligibility_status(envelope_id, user, false)
    }

    #[neo_method(name = "checkOpenEligibility")]
    pub fn check_open_eligibility(envelope_id: i64, user: i64) -> i64 {
        eligibility_status(envelope_id, user, true)
    }

    #[neo_method(name = "hasOpened")]
    pub fn has_opened(envelope_id: i64, opener: i64) -> bool {
        get_i64(k3(P_OPENED_AMOUNT, envelope_id, opener)) > 0
    }

    #[neo_method(name = "getOpenedAmount")]
    pub fn get_opened_amount(envelope_id: i64, opener: i64) -> i64 {
        get_i64(k3(P_OPENED_AMOUNT, envelope_id, opener))
    }

    #[neo_method(name = "hasClaimedFromPool")]
    pub fn has_claimed_from_pool(pool_id: i64, claimer: i64) -> bool {
        get_i64(k3(P_POOL_CLAIMED, pool_id, claimer)) > 0
    }

    #[neo_method(name = "getPoolClaimedAmount")]
    pub fn get_pool_claimed_amount(pool_id: i64, claimer: i64) -> i64 {
        get_i64(k3(P_POOL_CLAIMED, pool_id, claimer))
    }

    #[neo_method(name = "getCalculationConstants")]
    pub fn get_calculation_constants() -> i64 {
        MIN_AMOUNT
    }

    #[neo_method(name = "getTotalEnvelopes")]
    pub fn get_total_envelopes() -> i64 {
        get_key_i64(K_TOTAL_ENVELOPES)
    }

    #[neo_method(name = "getTotalDistributed")]
    pub fn get_total_distributed() -> i64 {
        get_key_i64(K_TOTAL_DISTRIBUTED)
    }

    #[neo_method(name = "getPoolClaimIdByIndex")]
    pub fn get_pool_claim_id_by_index(pool_id: i64, claim_index: i64) -> i64 {
        get_i64(k3(P_POOL_CLAIM_INDEX, pool_id, claim_index))
    }

    #[neo_method(name = "transfer")]
    pub fn transfer(to: i64, token_id: i64, _data: i64) -> bool {
        if is_paused_flag() || to == 0 || !token_exists(token_id) {
            return false;
        }

        let t = env(P_TYPE, token_id);
        if !(t == ENVELOPE_TYPE_SPREADING || t == ENVELOPE_TYPE_CLAIM) {
            return false;
        }

        let from = get_i64(k2(P_TOKEN_OWNER, token_id));
        if from == 0 {
            return false;
        }

        transfer_token(token_id, from, to)
    }

    #[neo_method(name = "openEnvelope")]
    pub fn open_envelope(envelope_id: i64, opener: i64) -> i64 {
        if is_paused_flag()
            || opener == 0
            || !exists(envelope_id)
            || env(P_TYPE, envelope_id) != ENVELOPE_TYPE_SPREADING
            || env(P_ACTIVE, envelope_id) == 0
            || env(P_OPENED, envelope_id) >= env(P_PACKET, envelope_id)
            || now_ms() > env(P_EXPIRY, envelope_id)
            || get_i64(k2(P_TOKEN_OWNER, envelope_id)) != opener
            || get_i64(k3(P_OPENED_AMOUNT, envelope_id, opener)) > 0
        {
            return 0;
        }

        let remaining = env(P_REMAINING, envelope_id);
        let opened = env(P_OPENED, envelope_id);
        let packet = env(P_PACKET, envelope_id);
        let total_amount = env(P_TOTAL, envelope_id);
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

        put_i64(k3(P_OPENED_AMOUNT, envelope_id, opener), amount);
        set_env(P_OPENED, envelope_id, opened.saturating_add(1));

        let rem2 = remaining.saturating_sub(amount);
        set_env(P_REMAINING, envelope_id, rem2);
        if rem2 == 0 || opened.saturating_add(1) >= packet {
            set_env(P_ACTIVE, envelope_id, 0);
        }

        amount
    }

    #[neo_method(name = "transferEnvelope")]
    pub fn transfer_envelope(envelope_id: i64, from: i64, to: i64, _data: i64) {
        if is_paused_flag()
            || from == 0
            || to == 0
            || !exists(envelope_id)
            || env(P_TYPE, envelope_id) != ENVELOPE_TYPE_SPREADING
            || get_i64(k2(P_TOKEN_OWNER, envelope_id)) != from
        {
            return;
        }

        let _ = transfer_token(envelope_id, from, to);
    }

    #[neo_method(name = "reclaimEnvelope")]
    pub fn reclaim_envelope(envelope_id: i64, creator: i64) -> i64 {
        if is_paused_flag()
            || creator == 0
            || !exists(envelope_id)
            || env(P_TYPE, envelope_id) != ENVELOPE_TYPE_SPREADING
            || env(P_CREATOR, envelope_id) != creator
            || env(P_ACTIVE, envelope_id) == 0
            || now_ms() <= env(P_EXPIRY, envelope_id)
        {
            return 0;
        }

        let refund = env(P_REMAINING, envelope_id);
        if refund <= 0 {
            return 0;
        }

        set_env(P_REMAINING, envelope_id, 0);
        set_env(P_ACTIVE, envelope_id, 0);
        refund
    }

    #[neo_method(name = "_initialize")]
    pub fn initialize() {}
}
