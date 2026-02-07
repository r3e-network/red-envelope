<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useWallet } from "@/composables/useWallet";
import { useRedEnvelope, type EnvelopeItem } from "@/composables/useRedEnvelope";
import { useEnvelopeHistory } from "@/composables/useEnvelopeHistory";
import { useI18n } from "@/composables/useI18n";
import { extractError } from "@/utils/format";
import EnvelopeDetail from "./EnvelopeDetail.vue";
import EnvelopeHistory from "./EnvelopeHistory.vue";
import OpeningModal from "./OpeningModal.vue";
import TransferModal from "./TransferModal.vue";

const { t } = useI18n();
const { connected, connect } = useWallet();
const { fetchEnvelopeState, openEnvelope, reclaimEnvelope } = useRedEnvelope();
const { loading: historyLoading, history, loadHistory, clearHistory } = useEnvelopeHistory();

const searchId = ref("");
const searching = ref(false);
const envelope = ref<EnvelopeItem | null>(null);
const notFound = ref(false);
const status = ref<{ msg: string; type: "success" | "error" } | null>(null);

// Modals
const showOpenModal = ref(false);
const showTransferModal = ref(false);

const handleSearch = async () => {
  const id = searchId.value.trim();
  if (!id) return;

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
      // Auto-load claim history for pool envelopes
      loadHistory(id, result.envelopeType, result.openedCount);
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
  showOpenModal.value = true;
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
  try {
    await reclaimEnvelope(envelope.value);
    status.value = { msg: "Reclaimed!", type: "success" };
    // Refresh envelope state
    const refreshed = await fetchEnvelopeState(envelope.value.id);
    if (refreshed) envelope.value = refreshed;
  } catch (e: unknown) {
    status.value = { msg: extractError(e), type: "error" };
  }
};

const onOpened = async () => {
  showOpenModal.value = false;
  if (envelope.value) {
    const refreshed = await fetchEnvelopeState(envelope.value.id);
    if (refreshed) envelope.value = refreshed;
  }
};

const onTransferred = async () => {
  showTransferModal.value = false;
  if (envelope.value) {
    const refreshed = await fetchEnvelopeState(envelope.value.id);
    if (refreshed) envelope.value = refreshed;
  }
};

// Auto-search if URL contains ?id=
onMounted(() => {
  const params = new URLSearchParams(window.location.search);
  const urlId = params.get("id")?.trim();
  if (urlId) {
    searchId.value = urlId;
    handleSearch();
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
      <div class="search-bar">
        <input
          v-model="searchId"
          type="text"
          :placeholder="t('searchPlaceholder')"
          class="input"
          @keyup.enter="handleSearch"
        />
        <button class="btn btn-primary" :disabled="!searchId.trim() || searching" @click="handleSearch">
          {{ t("searchButton") }}
        </button>
      </div>

      <!-- Action buttons (only when envelope loaded) -->
      <template v-if="envelope">
        <button
          v-if="envelope.active && !envelope.expired && !envelope.depleted"
          class="btn btn-open"
          @click="handleOpen"
        >
          {{ t("claimButton") }}
        </button>

        <button v-if="envelope.active && !envelope.expired" class="btn btn-transfer" @click="handleTransfer">
          {{ t("transferEnvelope") }}
        </button>

        <button
          v-if="envelope.active && envelope.expired && envelope.remainingAmount > 0"
          class="btn btn-reclaim"
          @click="handleReclaim"
        >
          {{ t("reclaimEnvelope") }}
        </button>
      </template>

      <!-- Status message -->
      <div v-if="status" :class="['status', status.type]">
        {{ status.msg }}
      </div>
    </div>
  </div>

  <!-- Modals -->
  <OpeningModal
    v-if="showOpenModal && envelope"
    :envelope="envelope"
    @close="showOpenModal = false"
    @opened="onOpened"
  />

  <TransferModal
    v-if="showTransferModal && envelope"
    :envelope="envelope"
    @close="showTransferModal = false"
    @transferred="onTransferred"
  />
</template>
