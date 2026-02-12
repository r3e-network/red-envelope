<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useWallet } from "@/composables/useWallet";
import { useRedEnvelope, type EnvelopeItem } from "@/composables/useRedEnvelope";
import { useEnvelopeHistory } from "@/composables/useEnvelopeHistory";
import { useI18n } from "@/composables/useI18n";
import { useAudio } from "@/composables/useAudio";
import { extractError, formatGas } from "@/utils/format";
import { addressToScriptHashHex } from "@/utils/neo";
import { waitForConfirmation } from "@/utils/rpc";
import { msUntilExpiry } from "@/utils/time";
import EnvelopeDetail from "./EnvelopeDetail.vue";
import EnvelopeHistory from "./EnvelopeHistory.vue";
import OpeningModal from "./OpeningModal.vue";
import TransferModal from "./TransferModal.vue";
import ShareCard from "./ShareCard.vue";

const { t } = useI18n();
const { playCoinSound } = useAudio();
const { address, connected, connect } = useWallet();
const {
  envelopes,
  loadingEnvelopes,
  loadEnvelopes,
  fetchEnvelopeState,
  claimFromPool,
  getPoolClaimedAmount,
  reclaimEnvelope,
} = useRedEnvelope();
const { loading: historyLoading, history, loadHistory, clearHistory } = useEnvelopeHistory();

const searchId = ref("");
const searching = ref(false);
const envelope = ref<EnvelopeItem | null>(null);
const notFound = ref(false);
const status = ref<{ msg: string; type: "success" | "error" } | null>(null);

// Modals
const showOpenModal = ref(false);
const showTransferModal = ref(false);
const showShareCard = ref(false);
const claimedAmount = ref(0);
const claiming = ref(false);
const reclaimingSearch = ref(false);
const openTargetEnvelope = ref<EnvelopeItem | null>(null);

const currentAddressHash = computed(() => (address.value ? addressToScriptHashHex(address.value) : ""));

const isHolder = computed(() => {
  if (!envelope.value || !currentAddressHash.value) return false;
  return envelope.value.currentHolder === currentAddressHash.value;
});

const isCreator = computed(() => {
  if (!envelope.value || !currentAddressHash.value) return false;
  return envelope.value.creator === currentAddressHash.value;
});

const canOpenOrClaim = computed(() => {
  const env = envelope.value;
  if (!env) return false;
  return env.active && !env.expired && !env.depleted && (env.envelopeType === 1 || isHolder.value);
});

const canTransfer = computed(() => {
  const env = envelope.value;
  if (!env) return false;
  return env.active && !env.expired && env.envelopeType !== 1 && isHolder.value;
});

const canReclaim = computed(() => {
  const env = envelope.value;
  if (!env) return false;
  return env.active && env.expired && env.remainingAmount > 0 && isCreator.value;
});

const walletSpreadingEnvelopes = computed(() => {
  if (!currentAddressHash.value) return [];

  return envelopes.value
    .filter((env) => env.envelopeType === 0 && env.currentHolder === currentAddressHash.value)
    .slice()
    .sort((a, b) => {
      const aClaimable = a.active && !a.expired && !a.depleted;
      const bClaimable = b.active && !b.expired && !b.depleted;

      if (aClaimable !== bClaimable) return aClaimable ? -1 : 1;

      if (aClaimable && bClaimable) {
        const aExpiry = a.expiryTime > 0 ? a.expiryTime : Number.MAX_SAFE_INTEGER;
        const bExpiry = b.expiryTime > 0 ? b.expiryTime : Number.MAX_SAFE_INTEGER;
        if (aExpiry !== bExpiry) return aExpiry - bExpiry;
      }

      return Number(b.id) - Number(a.id);
    });
});

const refreshWalletSpreadingList = async () => {
  if (!connected.value) return;
  await loadEnvelopes();
};

const isExpiringSoon = (env: EnvelopeItem): boolean => {
  if (!env.active || env.expired || env.depleted) return false;
  const remainingMs = msUntilExpiry(env.expiryTime);
  return remainingMs > 0 && remainingMs <= 6 * 60 * 60 * 1000;
};

const isValidSearchId = (val: string) => /^\d+$/.test(val) && Number(val) > 0;

const handleSearch = async () => {
  const id = searchId.value.trim();
  if (!id || !isValidSearchId(id)) return;

  searching.value = true;
  notFound.value = false;
  envelope.value = null;
  status.value = null;
  clearHistory();

  try {
    const result = await fetchEnvelopeState(id);
    if (result) {
      envelope.value = result;
      // Sync URL so the link is shareable
      const url = new URL(window.location.href);
      url.searchParams.set("id", id);
      window.history.replaceState({}, "", url.toString());
      // Auto-load claim history for pool envelopes (use claimedCount, not openedCount)
      loadHistory(id, result.envelopeType, result.claimedCount);
    } else {
      notFound.value = true;
    }
  } catch (e: unknown) {
    status.value = { msg: extractError(e), type: "error" };
  } finally {
    searching.value = false;
  }
};

const handleOpen = () => {
  if (!connected.value) {
    connect();
    return;
  }
  // Pool envelopes use claimFromPool directly (no modal needed for claiming a slot)
  if (envelope.value?.envelopeType === 1) {
    handlePoolClaim();
    return;
  }
  status.value = null;
  openTargetEnvelope.value = envelope.value;
  showOpenModal.value = true;
};

const handleWalletSpreadingClaim = async (target: EnvelopeItem) => {
  if (!connected.value) {
    await connect();
    await refreshWalletSpreadingList();
    return;
  }

  openTargetEnvelope.value = target;
  showOpenModal.value = true;
};

const handlePoolClaim = async () => {
  if (!envelope.value) return;
  status.value = null;
  claiming.value = true;
  claimedAmount.value = 0;
  try {
    const res = await claimFromPool(envelope.value.id);
    status.value = { msg: t("claimedTx", res.txid.slice(0, 12) + "..."), type: "success" };
    // Wait for TX confirmation before refreshing state (BUG-4 fix)
    await waitForConfirmation(res.txid);

    try {
      claimedAmount.value = await getPoolClaimedAmount(envelope.value.id);
    } catch {
      // Non-critical: claim succeeded but amount query failed; leave claimedAmount at 0
    }

    const refreshed = await fetchEnvelopeState(envelope.value.id);
    if (refreshed) {
      envelope.value = refreshed;
      loadHistory(refreshed.id, refreshed.envelopeType, refreshed.claimedCount);
    }
    // Show celebration share card only if we know the amount
    playCoinSound();
    if (claimedAmount.value > 0) {
      showShareCard.value = true;
    }
  } catch (e: unknown) {
    status.value = { msg: extractError(e), type: "error" };
  } finally {
    claiming.value = false;
  }
};

const handleTransfer = () => {
  if (!connected.value) {
    connect();
    return;
  }
  showTransferModal.value = true;
};

const handleReclaim = async () => {
  if (!envelope.value || !connected.value) {
    if (!connected.value) await connect();
    return;
  }
  status.value = null;
  reclaimingSearch.value = true;
  try {
    const reclaimAmount = formatGas(envelope.value.remainingAmount);
    const res = await reclaimEnvelope(envelope.value);
    status.value = { msg: t("reclaimSuccess", reclaimAmount), type: "success" };
    // Wait for TX confirmation before refreshing state (BUG-4 fix)
    await waitForConfirmation(res.txid);
    const refreshed = await fetchEnvelopeState(envelope.value.id);
    if (refreshed) {
      envelope.value = refreshed;
      loadHistory(refreshed.id, refreshed.envelopeType, refreshed.claimedCount);
    }
  } catch (e: unknown) {
    status.value = { msg: extractError(e), type: "error" };
  } finally {
    reclaimingSearch.value = false;
  }
};

const onOpened = async () => {
  showOpenModal.value = false;
  openTargetEnvelope.value = null;
  if (envelope.value) {
    const refreshed = await fetchEnvelopeState(envelope.value.id);
    if (refreshed) {
      envelope.value = refreshed;
      loadHistory(refreshed.id, refreshed.envelopeType, refreshed.claimedCount);
    }
  }
  await refreshWalletSpreadingList();
};

const onTransferred = async () => {
  showTransferModal.value = false;
  if (envelope.value) {
    const refreshed = await fetchEnvelopeState(envelope.value.id);
    if (refreshed) envelope.value = refreshed;
  }
  await refreshWalletSpreadingList();
};

// Auto-search if URL contains ?id=
onMounted(() => {
  const params = new URLSearchParams(window.location.search);
  const urlId = params.get("id")?.trim();
  if (urlId) {
    searchId.value = urlId;
    handleSearch();
  }

  if (connected.value) {
    refreshWalletSpreadingList();
  }
});

watch(connected, (isConnected) => {
  if (isConnected) {
    refreshWalletSpreadingList();
  }
});
</script>

<template>
  <div class="layout-two-col">
    <!-- LEFT PANEL: Detail or empty state -->
    <div class="panel-left">
      <div v-if="searching" class="loading">{{ t("searching") }}</div>

      <div v-else-if="notFound" class="search-not-found">
        <div class="not-found-icon">🔍</div>
        <div>{{ t("notFound") }}</div>
        <div class="not-found-hint">{{ t("notFoundHint") }}</div>
      </div>

      <template v-else-if="envelope">
        <EnvelopeDetail :envelope="envelope" />
        <EnvelopeHistory :envelope="envelope" :history="history" :loading="historyLoading" />
      </template>

      <div v-else class="search-empty">
        <div class="search-empty-icon">🧧</div>
        <div class="search-empty-text">{{ t("searchPrompt") }}</div>
      </div>
    </div>

    <!-- RIGHT PANEL: Search + Actions -->
    <div class="panel-right">
      <!-- Search bar -->
      <div class="search-bar" role="search">
        <input
          v-model="searchId"
          type="text"
          inputmode="numeric"
          :placeholder="t('searchPlaceholder')"
          :aria-label="t('searchPlaceholder')"
          class="input"
          @keyup.enter="handleSearch"
        />
        <button
          class="btn btn-primary"
          :disabled="!searchId.trim() || !isValidSearchId(searchId.trim()) || searching"
          @click="handleSearch"
        >
          {{ t("searchButton") }}
        </button>
      </div>

      <div class="wallet-spreading-card">
        <div class="wallet-spreading-header">
          <span>{{ t("searchWalletSpreadingTitle") }}</span>
          <button class="btn btn-sm" :aria-label="t('refresh')" @click="refreshWalletSpreadingList">↻</button>
        </div>

        <div v-if="!connected" class="text-muted wallet-spreading-empty">
          {{ t("searchWalletSpreadingConnectHint") }}
        </div>

        <div v-else-if="loadingEnvelopes" class="text-muted wallet-spreading-empty">
          {{ t("searching") }}
        </div>

        <div v-else-if="walletSpreadingEnvelopes.length === 0" class="text-muted wallet-spreading-empty">
          {{ t("searchWalletSpreadingEmpty") }}
        </div>

        <div v-else class="wallet-spreading-list">
          <div
            v-for="env in walletSpreadingEnvelopes"
            :key="env.id"
            :class="['wallet-spreading-item', { 'wallet-spreading-item-urgent': isExpiringSoon(env) }]"
          >
            <div class="wallet-spreading-meta">
              <div class="wallet-spreading-id-row">
                <div class="wallet-spreading-id">#{{ env.id }}</div>
                <span v-if="isExpiringSoon(env)" class="wallet-spreading-badge-urgent">
                  {{ t("expiringSoon") }}
                </span>
              </div>
              <div class="wallet-spreading-info">
                {{ t("packets", env.openedCount, env.packetCount) }} · {{ formatGas(env.remainingAmount) }} GAS
              </div>
            </div>

            <button
              class="btn btn-open wallet-spreading-open"
              :disabled="!env.active || env.expired || env.depleted"
              :aria-label="t('openEnvelope') + ' #' + env.id"
              @click="handleWalletSpreadingClaim(env)"
            >
              {{ t("openEnvelope") }}
            </button>
          </div>
        </div>
      </div>

      <!-- Action buttons (only when envelope loaded) -->
      <template v-if="envelope">
        <button v-if="canOpenOrClaim" class="btn btn-open" :disabled="claiming" @click="handleOpen">
          {{ claiming ? t("claiming") : envelope.envelopeType === 1 ? t("claimButton") : t("openEnvelope") }}
        </button>

        <button v-if="canTransfer" class="btn btn-transfer" @click="handleTransfer">
          {{ t("transferEnvelope") }}
        </button>

        <button v-if="canReclaim" class="btn btn-reclaim" :disabled="reclaimingSearch" @click="handleReclaim">
          {{ reclaimingSearch ? t("reclaiming") : t("reclaimEnvelope") }}
        </button>
      </template>

      <!-- Status message -->
      <div v-if="status" :class="['status', status.type]" role="status">
        {{ status.msg }}
      </div>
    </div>
  </div>

  <!-- Modals -->
  <OpeningModal
    v-if="showOpenModal && openTargetEnvelope"
    :envelope="openTargetEnvelope"
    @close="
      showOpenModal = false;
      openTargetEnvelope = null;
    "
    @opened="onOpened"
  />

  <TransferModal
    v-if="showTransferModal && envelope"
    :envelope="envelope"
    @close="showTransferModal = false"
    @transferred="onTransferred"
  />

  <ShareCard
    v-if="showShareCard && envelope && address"
    :amount="claimedAmount"
    :envelope-id="envelope.id"
    :address="address"
    @close="showShareCard = false"
  />
</template>
