<script setup lang="ts">
import type { EnvelopeItem } from "@/composables/useRedEnvelope";
import { useI18n } from "@/composables/useI18n";
import { formatGas } from "@/utils/format";

export type EnrichedEnvelope = EnvelopeItem & {
  isActive: boolean;
  progress: number;
  status: string;
  role: { text: string; cls: string } | null;
  countdown: { text: string; urgent: boolean } | null;
  showOpen: boolean;
  showTransfer: boolean;
  showReclaim: boolean;
  holdDays: number;
};

const props = defineProps<{
  env: EnrichedEnvelope;
  spreading?: boolean;
}>();

const emit = defineEmits<{
  open: [env: EnrichedEnvelope];
  transfer: [env: EnrichedEnvelope];
  reclaim: [env: EnrichedEnvelope];
}>();

const { t } = useI18n();
</script>

<template>
  <div :class="['envelope-card', { 'spreading-card': spreading, 'card-inactive': !env.isActive }]">
    <div class="card-header">
      <div style="display: flex; align-items: center; gap: 0.5rem">
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
      <div class="card-meta text-muted">
        {{ t("neoGate", env.minNeoRequired, env.holdDays) }}
      </div>
    </div>

    <div class="card-actions">
      <button v-if="env.showOpen" class="btn btn-open" @click="emit('open', env)">
        {{ t("openEnvelope") }}
      </button>
      <button
        v-if="env.showTransfer"
        :class="['btn', spreading ? 'btn-send-friend' : 'btn-transfer']"
        @click="emit('transfer', env)"
      >
        {{ spreading ? t("sendToFriend") : t("transferEnvelope") }}
      </button>
      <button v-if="env.showReclaim" class="btn btn-reclaim" @click="emit('reclaim', env)">
        {{ t("reclaimEnvelope") }}
      </button>
    </div>
  </div>
</template>
