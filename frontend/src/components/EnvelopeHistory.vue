<script setup lang="ts">
import { computed } from "vue";
import type { EnvelopeItem } from "@/composables/useRedEnvelope";
import type { HistoryData } from "@/composables/useEnvelopeHistory";
import { useI18n } from "@/composables/useI18n";
import { formatGas } from "@/utils/format";

const props = defineProps<{
  envelope: EnvelopeItem;
  history: HistoryData | null;
  loading: boolean;
}>();

const { t } = useI18n();

const isPool = computed(() => props.envelope.envelopeType === 1);
const isNft = computed(() => props.envelope.envelopeType === 0 || props.envelope.envelopeType === 2);

const holderShort = computed(() => {
  const h = props.envelope.currentHolder;
  if (!h || h === "0x" + "0".repeat(40)) return "";
  return `${h.slice(0, 8)}...${h.slice(-6)}`;
});

const nftOpened = computed(() => {
  const env = props.envelope;
  return env.openedCount > 0 || !env.active || env.remainingAmount === 0;
});

const claimedGas = computed(() => {
  const env = props.envelope;
  return env.totalAmount - env.remainingAmount;
});

const truncAddr = (addr: string) => {
  if (!addr || addr.length < 14) return addr || "—";
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
};
</script>

<template>
  <div class="history-panel">
    <!-- Loading -->
    <div v-if="loading" class="history-loading">
      {{ t("historyLoading") }}
    </div>

    <!-- Pool type: claim records table -->
    <template v-else-if="isPool">
      <div class="history-header">{{ t("historyPoolTitle") }}</div>

      <div v-if="!history || history.claims.length === 0" class="history-empty">
        {{ t("historyNoClaims") }}
      </div>

      <template v-else>
        <div class="history-table">
          <div class="history-table-head">
            <span>{{ t("historyHolder") }}</span>
            <span>{{ t("historyAmount") }}</span>
            <span>{{ t("historyStatus") }}</span>
          </div>
          <div v-for="claim in history.claims" :key="claim.claimId" class="history-table-row">
            <span class="history-addr" :title="claim.holder">
              {{ truncAddr(claim.holder) }}
            </span>
            <span class="history-amount"> {{ formatGas(claim.amount) }} GAS </span>
            <span :class="claim.opened ? 'text-ok' : 'text-muted'">
              {{ claim.opened ? t("historyOpened") : t("historySealed") }}
            </span>
          </div>
        </div>

        <div class="history-total">
          <span>{{ t("historyTotalClaimed") }}</span>
          <span class="history-total-value"> {{ formatGas(history.totalClaimed) }} GAS </span>
        </div>
      </template>
    </template>

    <!-- NFT / Spreading type: single holder info -->
    <template v-else-if="isNft">
      <div class="history-header">{{ t("historyNftTitle") }}</div>

      <div class="history-nft-info">
        <div class="detail-row">
          <span class="detail-label">{{ t("historyCurrentHolder") }}</span>
          <span class="detail-value" style="font-family: monospace; font-size: 0.8rem">
            {{ holderShort || t("historyNoHolder") }}
          </span>
        </div>

        <div class="detail-row">
          <span class="detail-label">{{ t("historyStatus") }}</span>
          <span :class="nftOpened ? 'text-ok' : 'text-muted'">
            {{ nftOpened ? t("historyOpened") : t("historySealed") }}
          </span>
        </div>

        <div v-if="nftOpened" class="detail-row">
          <span class="detail-label">{{ t("historyClaimedGas") }}</span>
          <span class="detail-value">{{ formatGas(claimedGas) }} GAS</span>
        </div>

        <div v-else class="detail-row">
          <span class="detail-label">{{ t("historyClaimedGas") }}</span>
          <span class="text-muted">{{ t("historyNotOpened") }}</span>
        </div>
      </div>
    </template>
  </div>
</template>
