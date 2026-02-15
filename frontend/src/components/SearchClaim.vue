<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useWallet } from "@/composables/useWallet";
import { useRedEnvelope, type EnvelopeItem } from "@/composables/useRedEnvelope";
import { useEnvelopeHistory } from "@/composables/useEnvelopeHistory";
import { useI18n } from "@/composables/useI18n";
import { useAudio } from "@/composables/useAudio";
import { extractError, formatGas } from "@/utils/format";
import { addressToScriptHashHex } from "@/utils/neo";
import { extractEnvelopeCreatedId, waitForConfirmation } from "@/utils/rpc";
import { CONTRACT_HASH } from "@/config/contract";
import EnvelopeDetail from "./EnvelopeDetail.vue";
import EnvelopeHistory from "./EnvelopeHistory.vue";
import OpeningModal from "./OpeningModal.vue";
import TransferModal from "./TransferModal.vue";
import { mapWalletConnectError } from "./searchClaim.logic";

const { t } = useI18n();
const { playCoinSound } = useAudio();
const { address, connected, connect } = useWallet();
const {
  fetchEnvelopeState,
  claimFromPool,
  getPoolClaimedAmount,
  reclaimEnvelope,
} = useRedEnvelope();
const { loading: historyLoading, history, loadHistory, clearHistory } = useEnvelopeHistory();

const urlEnvelopeId = ref("");
const searching = ref(false);
const envelope = ref<EnvelopeItem | null>(null);
const notFound = ref(false);
const status = ref<{ msg: string; type: "success" | "error" } | null>(null);

// Modals
const showOpenModal = ref(false);
const showTransferModal = ref(false);
const autoOpenClaimAfterClaim = ref(false);
const claimedAmount = ref(0);
const claiming = ref(false);
const reclaimingSearch = ref(false);
const openTargetEnvelope = ref<EnvelopeItem | null>(null);
const transferTargetEnvelope = ref<EnvelopeItem | null>(null);

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
  return env.envelopeType !== 1 && isHolder.value;
});

const canReclaim = computed(() => {
  const env = envelope.value;
  if (!env) return false;
  return env.envelopeType !== 2 && env.active && env.expired && env.remainingAmount > 0 && isCreator.value;
});

const isValidEnvelopeId = (val: string) => /^\d+$/.test(val) && Number(val) > 0;

const ensureConnected = async (): Promise<boolean> => {
  if (connected.value) return true;
  try {
    await connect();
    return true;
  } catch (e: unknown) {
    status.value = { msg: mapWalletConnectError(e, () => t("walletNotDetected")), type: "error" };
    return false;
  }
};

const readEnvelopeIdFromUrl = (): string => new URLSearchParams(window.location.search).get("id")?.trim() || "";

const loadEnvelopeFromUrl = async () => {
  const id = readEnvelopeIdFromUrl();
  urlEnvelopeId.value = id;
  notFound.value = false;
  envelope.value = null;
  status.value = null;
  clearHistory();

  if (!id) {
    return;
  }

  if (!isValidEnvelopeId(id)) {
    status.value = { msg: t("invalidUrlEnvelopeId"), type: "error" };
    return;
  }

  searching.value = true;
  try {
    const result = await fetchEnvelopeState(id);
    if (result) {
      envelope.value = result;
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

const handleOpen = async () => {
  if (!(await ensureConnected())) return;
  // Pool envelopes use claimFromPool directly (no modal needed for claiming a slot)
  if (envelope.value?.envelopeType === 1) {
    await handlePoolClaim();
    return;
  }
  status.value = null;
  autoOpenClaimAfterClaim.value = false;
  openTargetEnvelope.value = envelope.value;
  showOpenModal.value = true;
};

const handlePoolClaim = async () => {
  if (!envelope.value) return;
  status.value = null;
  claiming.value = true;
  claimedAmount.value = 0;
  autoOpenClaimAfterClaim.value = false;
  try {
    const res = await claimFromPool(envelope.value.id);
    status.value = { msg: t("claimedTx", res.txid.slice(0, 12) + "..."), type: "success" };
    // Wait for TX confirmation before refreshing state (BUG-4 fix)
    const appLog = await waitForConfirmation(res.txid);
    const claimId = extractEnvelopeCreatedId(appLog, CONTRACT_HASH);

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

    if (claimId) {
      try {
        const claimEnvelope = await fetchEnvelopeState(claimId);
        if (claimEnvelope?.envelopeType === 2) {
          openTargetEnvelope.value = claimEnvelope;
          autoOpenClaimAfterClaim.value = true;
          showOpenModal.value = true;
        }
      } catch {
        // non-blocking: fallback to status only
      }
    }

    playCoinSound();
  } catch (e: unknown) {
    status.value = { msg: extractError(e), type: "error" };
  } finally {
    claiming.value = false;
  }
};

const handleTransfer = async () => {
  if (!(await ensureConnected())) return;
  transferTargetEnvelope.value = envelope.value;
  showTransferModal.value = true;
};

const handleReclaim = async () => {
  if (!envelope.value) {
    return;
  }
  if (!(await ensureConnected())) {
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
  autoOpenClaimAfterClaim.value = false;
  openTargetEnvelope.value = null;
  if (envelope.value) {
    const refreshed = await fetchEnvelopeState(envelope.value.id);
    if (refreshed) {
      envelope.value = refreshed;
      loadHistory(refreshed.id, refreshed.envelopeType, refreshed.claimedCount);
    }
  }
};

const handleTransferAfterOpen = () => {
  if (!openTargetEnvelope.value) return;
  transferTargetEnvelope.value = openTargetEnvelope.value;
  showOpenModal.value = false;
  autoOpenClaimAfterClaim.value = false;
  showTransferModal.value = true;
};

const onTransferred = async () => {
  showTransferModal.value = false;
  transferTargetEnvelope.value = null;
  if (envelope.value) {
    const refreshed = await fetchEnvelopeState(envelope.value.id);
    if (refreshed) envelope.value = refreshed;
  }
};

const handlePopState = () => {
  void loadEnvelopeFromUrl();
};

onMounted(() => {
  loadEnvelopeFromUrl();
  window.addEventListener("popstate", handlePopState);
});

onUnmounted(() => {
  window.removeEventListener("popstate", handlePopState);
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
        <div class="search-empty-text">{{ t("urlEnvelopePrompt") }}</div>
      </div>
    </div>

    <!-- RIGHT PANEL: URL envelope + Actions -->
    <div class="panel-right">
      <div class="section-hint">
        {{ urlEnvelopeId ? t("urlEnvelopeId", urlEnvelopeId) : t("urlEnvelopePrompt") }}
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
    :auto-open="autoOpenClaimAfterClaim"
    @close="
      showOpenModal = false;
      autoOpenClaimAfterClaim = false;
      openTargetEnvelope = null;
    "
    @opened="onOpened"
    @transfer="handleTransferAfterOpen"
  />

  <TransferModal
    v-if="showTransferModal && transferTargetEnvelope"
    :envelope="transferTargetEnvelope"
    @close="
      showTransferModal = false;
      transferTargetEnvelope = null;
    "
    @transferred="onTransferred"
  />

</template>
