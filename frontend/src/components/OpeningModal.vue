<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useRedEnvelope, type EnvelopeItem } from "@/composables/useRedEnvelope";
import { useWallet } from "@/composables/useWallet";
import { useNeoEligibility } from "@/composables/useNeoEligibility";
import { useI18n } from "@/composables/useI18n";
import { extractError, formatGas } from "@/utils/format";
import { waitForConfirmation } from "@/utils/rpc";
import LuckyOverlay from "./LuckyOverlay.vue";
import ShareCard from "./ShareCard.vue";

const props = defineProps<{ envelope: EnvelopeItem }>();
const emit = defineEmits<{
  close: [];
  opened: [amount: number];
}>();

const { t } = useI18n();
const { address } = useWallet();
const { openEnvelope, getOpenedAmount } = useRedEnvelope();
const { checking, result: eligibility, checkEligibility } = useNeoEligibility();

const opening = ref(false);
const confirming = ref(false);
const opened = ref(false);
const openResult = ref<number | null>(null);
const error = ref("");
const showShare = ref(false);

const isLocked = computed(() => eligibility.value != null && !eligibility.value.eligible);
const requiredHoldDays = computed(() => (eligibility.value ? Math.floor(eligibility.value.minHoldSeconds / 86400) : 0));

onMounted(async () => {
  try {
    await checkEligibility(props.envelope.id);
  } catch {
    // Eligibility check failed — user can still attempt to open
  }
});

const handleOpen = async () => {
  if (props.envelope.envelopeType === 1) {
    error.value = "Pool envelopes use Claim, not Open";
    return;
  }
  opening.value = true;
  error.value = "";
  try {
    const { txid } = await openEnvelope(props.envelope);

    if (props.envelope.envelopeType === 2) {
      // Claim envelopes: amount is known upfront, no need to wait
      openResult.value = props.envelope.remainingAmount;
    } else {
      // Spreading envelopes: wait for TX confirmation before reading amount
      confirming.value = true;
      await waitForConfirmation(txid);
      confirming.value = false;
      openResult.value = await getOpenedAmount(props.envelope.id);
    }

    opened.value = true;
    emit("opened", openResult.value);
  } catch (e: unknown) {
    error.value = extractError(e);
  } finally {
    opening.value = false;
  }
};
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal opening-modal">
      <div class="modal-header">
        <h3>{{ t("openEnvelope") }}</h3>
        <button class="btn-close" @click="emit('close')">&times;</button>
      </div>

      <div class="modal-body">
        <!-- CSS Envelope Shape -->
        <div :class="['envelope-shape', { 'envelope-opened': opened, 'envelope-locked': isLocked }]">
          <div class="envelope-back"></div>
          <div class="envelope-flap"></div>
          <div class="envelope-seal">🧧</div>
          <div class="envelope-content">
            <div v-if="openResult !== null" style="color: var(--color-gold); font-weight: 700">
              ~{{ formatGas(openResult) }} GAS
            </div>
          </div>
        </div>

        <!-- Message preview -->
        <div class="envelope-preview">
          <div class="preview-msg">{{ envelope.message || "🧧" }}</div>
          <div class="preview-meta">
            {{ t("packets", envelope.openedCount, envelope.packetCount) }}
          </div>
        </div>

        <!-- Eligibility checklist -->
        <div v-if="checking" class="eligibility-check loading">...</div>

        <div v-else-if="eligibility" class="eligibility-check">
          <div class="eligibility-row">
            <span>{{ t("neoBalance") }}</span>
            <span :class="eligibility.neoBalance >= eligibility.minNeoRequired ? 'text-ok' : 'text-fail'">
              {{ eligibility.neoBalance >= eligibility.minNeoRequired ? "✅" : "❌" }}
              {{ eligibility.neoBalance }} NEO
            </span>
          </div>
          <div class="eligibility-row">
            <span>{{ t("holdingDays") }}</span>
            <span :class="eligibility.holdDays >= requiredHoldDays ? 'text-ok' : 'text-fail'">
              {{ eligibility.holdDays >= requiredHoldDays ? "✅" : "❌" }}
              {{ eligibility.holdDays }}d
            </span>
          </div>
          <div class="eligibility-row">
            <span>{{ t("neoRequirement") }}</span>
            <span>≥{{ eligibility.minNeoRequired }} NEO, ≥{{ requiredHoldDays }}d</span>
          </div>
          <div v-if="!eligibility.eligible" class="status error">
            {{ eligibility.reason === "insufficient NEO" ? t("insufficientNeo") : t("holdNotMet") }}
          </div>
        </div>

        <!-- Lucky result -->
        <div v-if="openResult !== null" class="open-result">
          <LuckyOverlay :amount="openResult" />
        </div>

        <div v-else-if="error" class="status error">{{ error }}</div>

        <!-- Actions -->
        <button
          v-if="openResult === null"
          class="btn btn-open btn-lg"
          :disabled="opening || isLocked"
          @click="handleOpen"
        >
          {{ confirming ? t("confirming") : opening ? t("opening") : t("openEnvelope") }}
        </button>

        <div v-else class="modal-actions">
          <button class="btn btn-open" @click="showShare = true">🎉 {{ t("shareYourLuck") }}</button>
          <button class="btn btn-primary" @click="emit('close')">
            {{ t("close") }}
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- Share Card overlay -->
  <ShareCard
    v-if="showShare && openResult !== null"
    :amount="openResult"
    :envelope-id="props.envelope.id"
    :address="address"
    @close="showShare = false"
  />
</template>
