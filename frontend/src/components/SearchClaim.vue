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
const showSecondaryActions = ref(false);
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

type PrimaryActionKind = "claimOrOpen" | "transfer" | "reclaim" | null;

const primaryAction = computed<PrimaryActionKind>(() => {
  if (canOpenOrClaim.value) return "claimOrOpen";
  if (canTransfer.value) return "transfer";
  if (canReclaim.value) return "reclaim";
  return null;
});

const primaryActionLabel = computed(() => {
  switch (primaryAction.value) {
    case "claimOrOpen":
      return envelope.value?.envelopeType === 1
        ? (claiming.value ? t("claiming") : t("claimButton"))
        : t("openEnvelope");
    case "transfer":
      return t("transferEnvelope");
    case "reclaim":
      return reclaimingSearch.value ? t("reclaiming") : t("reclaimEnvelope");
    default:
      return "";
  }
});

const primaryActionDisabled = computed(() => {
  if (primaryAction.value === "claimOrOpen") return claiming.value;
  if (primaryAction.value === "reclaim") return reclaimingSearch.value;
  return false;
});

const primaryActionClass = computed(() => {
  if (primaryAction.value === "transfer") return "btn-transfer";
  if (primaryAction.value === "reclaim") return "btn-reclaim";
  return "btn-open";
});

const showTransferSecondary = computed(() => canTransfer.value && primaryAction.value !== "transfer");
const showReclaimSecondary = computed(() => canReclaim.value && primaryAction.value !== "reclaim");
const hasSecondaryActions = computed(() => showTransferSecondary.value || showReclaimSecondary.value);

type ActionFlowPhase = "idle" | "loading" | "success" | "error";

const actionFlowPhase = computed<ActionFlowPhase>(() => {
  if (searching.value || claiming.value || reclaimingSearch.value || showOpenModal.value || showTransferModal.value) return "loading";
  if (status.value?.type === "error") return "error";
  if (status.value?.type === "success") return "success";
  return "idle";
});

const actionFlowTitle = computed(() => {
  if (actionFlowPhase.value === "error") return t("flowStatusError");
  if (actionFlowPhase.value === "success") return t("flowStatusSuccess");
  if (actionFlowPhase.value === "loading") return t("flowStatusLoading");
  return t("flowStatusReady");
});

const actionFlowMessage = computed(() => {
  if (searching.value) return t("flowHintLoadingEnvelope");
  if (claiming.value) return t("flowHintClaimingOnChain");
  if (reclaimingSearch.value) return t("flowHintReclaimingOnChain");
  if (showOpenModal.value) return t("flowHintOpeningEnvelope");
  if (showTransferModal.value) return t("flowHintTransferringEnvelope");
  if (status.value?.msg) return status.value.msg;
  if (!urlEnvelopeId.value) return t("flowHintWaitingUrl");
  if (!envelope.value) return t("flowHintLoadingEnvelope");
  if (!primaryAction.value) return t("flowHintNoAction");
  return t("flowHintReadyAction");
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
  showSecondaryActions.value = false;
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
  showSecondaryActions.value = false;
  autoOpenClaimAfterClaim.value = false;
  try {
    const res = await claimFromPool(envelope.value.id);
    status.value = { msg: t("claimedTx", res.txid.slice(0, 12) + "..."), type: "success" };
    // Wait for TX confirmation before refreshing state (BUG-4 fix)
    const appLog = await waitForConfirmation(res.txid);
    const claimId = extractEnvelopeCreatedId(appLog, CONTRACT_HASH);

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

const handlePrimaryAction = async () => {
  if (!envelope.value) return;
  showSecondaryActions.value = false;

  if (primaryAction.value === "claimOrOpen") {
    await handleOpen();
    return;
  }

  if (primaryAction.value === "transfer") {
    await handleTransfer();
    return;
  }

  if (primaryAction.value === "reclaim") {
    await handleReclaim();
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
  showSecondaryActions.value = false;
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
  showSecondaryActions.value = false;
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

      <div :class="['action-flow-card', `flow-${actionFlowPhase}`]" role="status" aria-live="polite">
        <div class="action-flow-head">
          <span class="action-flow-dot" aria-hidden="true"></span>
          <span>{{ actionFlowTitle }}</span>
        </div>
        <div class="action-flow-text">{{ actionFlowMessage }}</div>
        <div v-if="actionFlowPhase === 'loading'" class="action-flow-progress" aria-hidden="true">
          <div class="action-flow-progress-fill"></div>
        </div>
      </div>

      <!-- Action buttons (only when envelope loaded) -->
      <div v-if="envelope && primaryAction" class="action-card">
        <button :class="['btn', primaryActionClass, 'action-primary-btn']" :disabled="primaryActionDisabled" @click="handlePrimaryAction">
          {{ primaryActionLabel }}
        </button>
        <button
          v-if="hasSecondaryActions"
          class="btn btn-sm action-secondary-toggle"
          :aria-expanded="showSecondaryActions"
          @click="showSecondaryActions = !showSecondaryActions"
        >
          {{ showSecondaryActions ? t("hideActions") : t("moreActions") }}
        </button>
        <div v-if="showSecondaryActions && hasSecondaryActions" class="action-secondary-list">
          <button v-if="showTransferSecondary" class="btn btn-transfer" @click="handleTransfer">
            {{ t("transferEnvelope") }}
          </button>
          <button v-if="showReclaimSecondary" class="btn btn-reclaim" :disabled="reclaimingSearch" @click="handleReclaim">
            {{ reclaimingSearch ? t("reclaiming") : t("reclaimEnvelope") }}
          </button>
        </div>
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
