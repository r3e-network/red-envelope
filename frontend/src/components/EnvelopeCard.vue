<script setup lang="ts">
import type { EnvelopeItem } from "@/composables/useRedEnvelope";
import { useI18n } from "@/composables/useI18n";
import { formatGas, formatHash } from "@/utils/format";
import type { CountdownDisplay } from "@/utils/time";

export type EnrichedEnvelope = EnvelopeItem & {
  isActive: boolean;
  progress: number;
  status: string;
  role: { text: string; cls: string } | null;
  countdown: CountdownDisplay | null;
  showOpen: boolean;
  showTransfer: boolean;
  showReclaim: boolean;
  holdDays: number;
};

defineProps<{
  env: EnrichedEnvelope;
  spreading?: boolean;
  reclaiming?: boolean;
}>();

const emit = defineEmits<{
  open: [env: EnrichedEnvelope];
  transfer: [env: EnrichedEnvelope];
  reclaim: [env: EnrichedEnvelope];
  inspectWallet: [walletHash: string];
  viewNft: [env: EnrichedEnvelope];
}>();

const { t } = useI18n();
</script>

<template>
  <div
    :class="['envelope-card', 'envelope-card-clickable', { 'spreading-card': spreading, 'card-inactive': !env.isActive }]"
    role="article"
    :aria-label="t('detailEnvelopeId', env.id)"
    :title="t('viewNftHint')"
    tabindex="0"
    @click="emit('viewNft', env)"
    @keydown.enter.prevent="emit('viewNft', env)"
    @keydown.space.prevent="emit('viewNft', env)"
  >
    <div class="card-header">
      <div class="card-header-left">
        <span class="envelope-id">#{{ env.id }}</span>
        <span v-if="env.role" :class="['role-badge', env.role.cls]">
          {{ env.role.text }}
        </span>
      </div>
      <span :class="['badge', env.isActive ? 'active' : 'inactive']">
        {{ env.status }}
      </span>
    </div>

    <div class="card-body">
      <div class="card-msg">{{ env.message || "🧧" }}</div>
      <div class="wallet-chip-row">
        <button
          class="wallet-chip"
          type="button"
          :title="env.creator"
          :aria-label="t('detailCreator') + ': ' + env.creator"
          @click.stop="emit('inspectWallet', env.creator)"
        >
          {{ t("detailCreator") }} · {{ formatHash(env.creator) }}
        </button>
        <button
          v-if="env.currentHolder && env.currentHolder !== env.creator"
          class="wallet-chip wallet-chip-holder"
          type="button"
          :title="env.currentHolder"
          :aria-label="t('historyHolder') + ': ' + env.currentHolder"
          @click.stop="emit('inspectWallet', env.currentHolder)"
        >
          {{ t("historyHolder") }} · {{ formatHash(env.currentHolder) }}
        </button>
      </div>
      <div class="card-gas-remaining">
        {{ t("gasRemaining", formatGas(env.remainingAmount)) }}
      </div>
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: env.progress + '%' }"></div>
      </div>
      <div class="progress-label">
        <span>{{ t("packets", env.openedCount, env.packetCount) }}</span>
        <span>{{ env.progress }}%</span>
      </div>
      <div v-if="env.countdown" :class="['countdown', { 'countdown-urgent': env.countdown.urgent }]">
        {{ env.countdown.text }}
      </div>
      <div v-if="env.minNeoRequired > 0 || env.holdDays > 0" class="card-meta text-muted">
        {{ t("neoGate", env.minNeoRequired, env.holdDays) }}
      </div>
    </div>

    <div v-if="env.showOpen || env.showTransfer || env.showReclaim" class="card-actions">
      <button
        v-if="env.showOpen"
        class="btn btn-open"
        :aria-label="t('openEnvelope') + ' #' + env.id"
        @click.stop="emit('open', env)"
      >
        {{ t("openEnvelope") }}
      </button>
      <button
        v-if="env.showTransfer"
        :class="['btn', spreading ? 'btn-send-friend' : 'btn-transfer']"
        :aria-label="(spreading ? t('sendToFriend') : t('transferEnvelope')) + ' #' + env.id"
        @click.stop="emit('transfer', env)"
      >
        {{ spreading ? t("sendToFriend") : t("transferEnvelope") }}
      </button>
      <button
        v-if="env.showReclaim"
        class="btn btn-reclaim"
        :disabled="reclaiming"
        :aria-label="t('reclaimEnvelope') + ' #' + env.id"
        @click.stop="emit('reclaim', env)"
      >
        {{ reclaiming ? t("reclaiming") : t("reclaimEnvelope") }}
      </button>
    </div>
  </div>
</template>
