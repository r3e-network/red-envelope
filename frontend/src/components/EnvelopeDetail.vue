<script setup lang="ts">
import { computed } from "vue";
import type { EnvelopeItem } from "@/composables/useRedEnvelope";
import { useI18n } from "@/composables/useI18n";
import { useReactiveClock } from "@/composables/useReactiveClock";
import { formatGas, formatHash } from "@/utils/format";
import { computeCountdown, formatCountdownDisplay } from "@/utils/time";

const props = defineProps<{ envelope: EnvelopeItem }>();
const { t } = useI18n();
const { now } = useReactiveClock();

const progress = computed(() => {
  const { packetCount, openedCount } = props.envelope;
  return packetCount > 0 ? Math.round((openedCount / packetCount) * 100) : 0;
});

const statusLabel = computed(() => {
  const env = props.envelope;
  if (!env.active || env.depleted) return t("depleted");
  if (env.expired) return t("expired");
  return t("active");
});

const isActive = computed(() => {
  const env = props.envelope;
  return env.active && !env.expired && !env.depleted;
});

const countdown = computed(() =>
  formatCountdownDisplay(computeCountdown(props.envelope.expiryTime, now.value, props.envelope.expired), t),
);

const typeLabel = computed(() => {
  switch (props.envelope.envelopeType) {
    case 1:
      return t("detailTypePool");
    case 2:
      return t("detailTypeClaim");
    default:
      return t("detailTypeSpreading");
  }
});

const holdDays = computed(() => Math.floor(props.envelope.minHoldSeconds / 86400));
</script>

<template>
  <div class="detail-panel">
    <!-- Header: ID + Status -->
    <div class="detail-header">
      <span class="detail-title">{{ t("detailEnvelopeId", envelope.id) }}</span>
      <span :class="['badge', isActive ? 'active' : 'inactive']">{{ statusLabel }}</span>
    </div>

    <!-- Blessing message -->
    <div v-if="envelope.message" class="detail-message">
      {{ envelope.message }}
    </div>

    <!-- GAS remaining (prominent) -->
    <div class="detail-gas-big">💎 {{ formatGas(envelope.remainingAmount) }} GAS</div>

    <!-- Progress bar -->
    <div class="progress-bar">
      <div class="progress-fill" :style="{ width: progress + '%' }"></div>
    </div>
    <div class="progress-label">
      <span>{{ t("packets", envelope.openedCount, envelope.packetCount) }}</span>
      <span>{{ progress }}%</span>
    </div>

    <!-- Detail rows -->
    <div class="detail-row">
      <span class="detail-label">{{ t("detailType") }}</span>
      <span class="detail-value">{{ typeLabel }}</span>
    </div>

    <div class="detail-row">
      <span class="detail-label">{{ t("detailCreator") }}</span>
      <span class="detail-value mono-sm">
        {{ formatHash(envelope.creator) }}
      </span>
    </div>

    <div class="detail-row">
      <span class="detail-label">{{ t("detailGasTotal") }}</span>
      <span class="detail-value">{{ formatGas(envelope.totalAmount) }} GAS</span>
    </div>

    <div class="detail-row">
      <span class="detail-label">{{ t("detailExpiry") }}</span>
      <span v-if="countdown" :class="{ 'text-fail': countdown.urgent }">
        {{ countdown.text }}
      </span>
      <span v-else class="detail-value">—</span>
    </div>

    <div class="detail-row">
      <span class="detail-label">{{ t("detailNeoGate") }}</span>
      <span class="detail-value">
        <template v-if="envelope.minNeoRequired > 0 || holdDays > 0">
          {{ t("detailNeoGateValue", envelope.minNeoRequired, holdDays) }}
        </template>
        <template v-else>{{ t("detailNoGate") }}</template>
      </span>
    </div>
  </div>
</template>
