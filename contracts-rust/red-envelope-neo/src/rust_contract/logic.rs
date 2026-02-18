fn create_envelope(
    from: i64,
    amount: i64,
    packet_count: i64,
    expiry_ms: i64,
    envelope_type: i64,
    update_totals: bool,
) -> i64 {
    if from == 0
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

    let id = alloc_id();
    set_env(P_CREATOR, id, from);
    set_env(P_TOTAL, id, amount);
    set_env(P_PACKET, id, packet_count);
    set_env(P_TYPE, id, envelope_type);
    set_env(P_PARENT, id, 0);
    set_env(P_OPENED, id, 0);
    set_env(P_REMAINING, id, amount);
    set_env(P_ACTIVE, id, 1);
    set_env(P_EXPIRY, id, now_ms().saturating_add(expiry_ms));

    if envelope_type == ENVELOPE_TYPE_SPREADING {
        mint_token(id, from);
    }

    if update_totals {
        put_key_i64(
            K_TOTAL_ENVELOPES,
            get_key_i64(K_TOTAL_ENVELOPES).saturating_add(1),
        );
        put_key_i64(
            K_TOTAL_DISTRIBUTED,
            get_key_i64(K_TOTAL_DISTRIBUTED).saturating_add(amount),
        );
    }

    id
}

fn eligibility_status(envelope_id: i64, user: i64, include_action_checks: bool) -> i64 {
    if !exists(envelope_id) {
        return E_NOT_FOUND;
    }

    if env(P_ACTIVE, envelope_id) == 0 {
        return E_NOT_ACTIVE;
    }

    if include_action_checks {
        if now_ms() > env(P_EXPIRY, envelope_id) {
            return E_EXPIRED;
        }

        if env(P_OPENED, envelope_id) >= env(P_PACKET, envelope_id)
            || env(P_REMAINING, envelope_id) <= 0
        {
            return E_DEPLETED;
        }

        let t = env(P_TYPE, envelope_id);
        if t == ENVELOPE_TYPE_POOL {
            if get_i64(k3(P_POOL_CLAIMED, envelope_id, user)) > 0 {
                return E_ALREADY_CLAIMED;
            }
        } else if t == ENVELOPE_TYPE_SPREADING || t == ENVELOPE_TYPE_CLAIM {
            if get_i64(k2(P_TOKEN_OWNER, envelope_id)) != user {
                return E_NOT_HOLDER;
            }

            if t == ENVELOPE_TYPE_SPREADING && get_i64(k3(P_OPENED_AMOUNT, envelope_id, user)) > 0 {
                return E_ALREADY_OPENED;
            }

            if t == ENVELOPE_TYPE_CLAIM && env(P_OPENED, envelope_id) > 0 {
                return E_ALREADY_OPENED;
            }
        } else {
            return E_INVALID_TYPE;
        }
    }

    ELIGIBILITY_OK
}

fn mint_token(token_id: i64, owner: i64) {
    put_i64(k2(P_TOKEN_OWNER, token_id), owner);

    let bal_key = k2(P_OWNER_BALANCE, owner);
    let bal = get_i64(bal_key);
    put_i64(bal_key, bal.saturating_add(1));

    put_key_i64(
        K_TOTAL_SUPPLY,
        get_key_i64(K_TOTAL_SUPPLY).saturating_add(1),
    );
}

fn transfer_token(token_id: i64, from: i64, to: i64) -> bool {
    if from == 0 || to == 0 {
        return false;
    }
    if get_i64(k2(P_TOKEN_OWNER, token_id)) != from {
        return false;
    }

    put_i64(k2(P_TOKEN_OWNER, token_id), to);

    let from_key = k2(P_OWNER_BALANCE, from);
    let to_key = k2(P_OWNER_BALANCE, to);

    let from_bal = get_i64(from_key);
    if from_bal > 0 {
        put_i64(from_key, from_bal - 1);
    }

    let to_bal = get_i64(to_key);
    put_i64(to_key, to_bal.saturating_add(1));

    true
}

fn ctx() -> i64 {
    unsafe { neo_storage_get_context() }
}

#[inline(always)]
fn key(prefix: u8) -> i64 {
    prefix as i64
}

#[inline(always)]
fn mix64(mut x: u64) -> u64 {
    x ^= x >> 30;
    x = x.wrapping_mul(0xbf58_476d_1ce4_e5b9);
    x ^= x >> 27;
    x = x.wrapping_mul(0x94d0_49bb_1331_11eb);
    x ^ (x >> 31)
}

#[inline(always)]
fn positive_key(x: u64) -> i64 {
    let v = (x & 0x7fff_ffff_ffff_ffff) as i64;
    if v == 0 {
        1
    } else {
        v
    }
}

#[inline(always)]
fn k2(prefix: u8, a: i64) -> i64 {
    let seed = ((prefix as u64) << 56) ^ (a as u64);
    positive_key(mix64(seed))
}

#[inline(always)]
fn k3(prefix: u8, a: i64, b: i64) -> i64 {
    let seed = ((prefix as u64) << 56) ^ mix64(a as u64) ^ mix64((b as u64).rotate_left(17));
    positive_key(mix64(seed))
}

fn put_key_i64(prefix: u8, v: i64) {
    put_i64(key(prefix), v);
}

fn get_key_i64(prefix: u8) -> i64 {
    get_i64(key(prefix))
}

fn put_i64(key: i64, v: i64) {
    let ctx = ctx();
    unsafe {
        neo_storage_put(key, v, ctx);
    }
}

fn get_i64(key: i64) -> i64 {
    let ctx = ctx();
    let raw = unsafe { neo_storage_get(key, ctx) };
    let null_probe = unsafe { neo_storage_get(NULL_PROBE_KEY, ctx) };
    // Missing keys materialize as Null stack items; compare against a guaranteed-missing probe.
    if raw == null_probe {
        0
    } else {
        add1(raw) - 1
    }
}

fn exists(id: i64) -> bool {
    env(P_CREATOR, id) != 0
}

fn token_exists(token_id: i64) -> bool {
    get_i64(k2(P_TOKEN_OWNER, token_id)) != 0
}

fn env(prefix: u8, id: i64) -> i64 {
    get_i64(k2(prefix, id))
}

fn set_env(prefix: u8, id: i64, v: i64) {
    put_i64(k2(prefix, id), v)
}

fn alloc_id() -> i64 {
    let id = get_key_i64(K_NEXT_ID).saturating_add(1);
    put_key_i64(K_NEXT_ID, id);
    id
}

fn now_ms() -> i64 {
    let t = get_key_i64(K_TIME_OVERRIDE);
    if t > 0 {
        return t;
    }

    #[cfg(target_arch = "wasm32")]
    {
        unsafe { neo_get_time() }
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        0
    }
}

fn is_paused_flag() -> bool {
    get_key_i64(K_PAUSED) != 0
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
    let feasible_max =
        remaining_amount.saturating_sub((packets_left - 1).saturating_mul(min_per_packet));
    if feasible_max <= min_per_packet {
        return min_per_packet;
    }

    let dynamic_average = ceiling_div(remaining_amount, packets_left);
    let lower_band_bps = volatility_lower_bps(total_packets);
    let upper_band_bps = volatility_upper_bps(total_packets);

    let mut min_for_this = dynamic_average.saturating_mul(lower_band_bps) / PERCENT_BASE;
    if min_for_this < min_per_packet {
        min_for_this = min_per_packet;
    }

    let mut max_for_this =
        ceiling_div(dynamic_average.saturating_mul(upper_band_bps), PERCENT_BASE);

    let cap_by_percent = ceiling_div(
        total_amount.saturating_mul(MAX_SINGLE_PACKET_BPS),
        PERCENT_BASE,
    );
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
        let random = unsafe { neo_get_random() };

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
