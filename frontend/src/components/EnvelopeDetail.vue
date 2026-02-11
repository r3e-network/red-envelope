<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from "vue";
import type { EnvelopeItem } from "@/composables/useRedEnvelope";
import { useI18n } from "@/composables/useI18n";
import { formatGas } from "@/utils/format";
import { msUntilExpiry } from "@/utils/time";

const props = defineProps<{ envelope: EnvelopeItem }>();
const { t } = useI18n();

// Reactive clock — ticks every second so countdown stays live
const now = ref(Date.now());
let tickTimer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  tickTimer = setInterval(() => {
    now.value = Date.now();
  }, 1000);
});
onUnmounted(() => {
  if (tickTimer) clearInterval(tickTimer);
});

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

const countdown = computed(() => {
  const env = props.envelope;
  if (env.expired) return { text: t("expiredLabel"), urgent: true };
  if (!env.expiryTime) return null;
  const diff = msUntilExpiry(env.expiryTime, now.value);
  if (diff <= 0) return { text: t("expiredLabel"), urgent: true };
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (days > 0) return { text: t("daysRemaining", days, hours), urgent: false };
  if (hours > 0) return { text: t("hoursMinutes", hours, mins), urgent: hours < 6 };
  return { text: t("minutesOnly", mins), urgent: true };
});

const typeLabel = computed(() => {
  switch (props.envelope.envelopeType) {
    case 1:
      return t("detailTypePool");
    case 2:
      return t("detailTypeNft");
    default:
      return t("detailTypeSpreading");
  }
});

const holdDays = computed(() => Math.floor(props.envelope.minHoldSeconds / 86400));

const creatorShort = computed(() => {
  const c = props.envelope.creator;
  return c ? `${c.slice(0, 8)}...${c.slice(-6)}` : "—";
});
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
      <span class="detail-value" style="font-family: monospace; font-size: 0.8rem">
        {{ creatorShort }}
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
        <template v-if="envelope.minNeoRequired > 0">
          {{ t("detailNeoGateValue", envelope.minNeoRequired, holdDays) }}
        </template>
        <template v-else>{{ t("detailNoGate") }}</template>
      </span>
    </div>
  </div>
</template>
