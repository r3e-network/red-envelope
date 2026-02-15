<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useRedEnvelope, type EnvelopeItem } from "@/composables/useRedEnvelope";
import { useWallet } from "@/composables/useWallet";
import { useNeoEligibility } from "@/composables/useNeoEligibility";
import { useI18n } from "@/composables/useI18n";
import { useAudio } from "@/composables/useAudio";
import { useFocusTrap } from "@/composables/useFocusTrap";
import { extractError, formatGas } from "@/utils/format";
import { waitForConfirmation } from "@/utils/rpc";
import LuckyOverlay from "./LuckyOverlay.vue";
import ShareCard from "./ShareCard.vue";

const props = defineProps<{
  envelope: EnvelopeItem;
  autoOpen?: boolean;
}>();
const emit = defineEmits<{
  close: [];
  opened: [amount: number];
  transfer: [];
}>();

const { t } = useI18n();
const { address } = useWallet();
const { openEnvelope, getOpenedAmount } = useRedEnvelope();
const { checking, result: eligibility, checkEligibility } = useNeoEligibility();
const { playOpenSound } = useAudio();

const modalRef = ref<HTMLElement | null>(null);
useFocusTrap(modalRef);

const opening = ref(false);
const confirming = ref(false);
const opened = ref(false);
const openResult = ref<number | null>(null);
const error = ref("");
const showShare = ref(false);
const eligibilityWarning = ref("");
const resultHint = computed(() => (props.envelope.envelopeType === 0 ? t("openResultHintSpreading") : t("openResultHintClaim")));

const isLocked = computed(() => eligibility.value != null && !eligibility.value.eligible);
const requiredHoldDays = computed(() => (eligibility.value ? Math.floor(eligibility.value.minHoldSeconds / 86400) : 0));
const hasGate = computed(
  () => eligibility.value != null && (eligibility.value.minNeoRequired > 0 || requiredHoldDays.value > 0),
);

onMounted(async () => {
  try {
    await checkEligibility(props.envelope.id);
  } catch {
    eligibilityWarning.value = t("eligibilityCheckFailed");
  }

  // Pool flow can pass a claim NFT here with auto-open enabled
  // so user finishes claim + open in one guided sequence.
  if (props.autoOpen && props.envelope.envelopeType !== 1) {
    void handleOpen();
  }
});

const handleOpen = async () => {
  if (props.envelope.envelopeType === 1) {
    error.value = t("poolUseClaimNotOpen");
    return;
  }
  error.value = "";

  // Contract rule: each address can open the same spreading envelope only once.
  if (props.envelope.envelopeType === 0) {
    try {
      const openedAmount = await getOpenedAmount(props.envelope.id);
      if (openedAmount > 0) {
        error.value = t("alreadyOpenedByYou");
        return;
      }
    } catch {
      // Non-blocking: proceed and let contract enforce if the check call fails.
    }
  }

  opening.value = true;
  try {
    const { txid } = await openEnvelope(props.envelope);

    // Wait for on-chain confirmation for both spreading and claim NFTs,
    // so VM FAULTs are surfaced consistently before showing success UI.
    confirming.value = true;
    try {
      await waitForConfirmation(txid);
    } finally {
      confirming.value = false;
    }

    if (props.envelope.envelopeType === 2) {
      // Claim envelopes: amount equals the claim NFT's remaining amount.
      openResult.value = props.envelope.remainingAmount;
    } else {
      // Spreading envelopes: query exact opened amount after confirmation
      try {
        openResult.value = await getOpenedAmount(props.envelope.id);
      } catch {
        openResult.value = 0; // fallback — TX succeeded but amount query failed
      }
    }

    opened.value = true;
    showShare.value = (openResult.value ?? 0) > 0;
    playOpenSound();
    emit("opened", openResult.value ?? 0);
  } catch (e: unknown) {
    error.value = extractError(e);
  } finally {
    opening.value = false;
  }
};
</script>

<template>
  <div
    ref="modalRef"
    class="modal-overlay"
    role="dialog"
    aria-modal="true"
    @click.self="emit('close')"
    @keydown.escape="emit('close')"
  >
    <div class="modal opening-modal" aria-labelledby="opening-modal-title">
      <div class="modal-header">
        <h3 id="opening-modal-title">{{ t("openEnvelope") }}</h3>
        <button class="btn-close" :aria-label="t('close')" @click="emit('close')">&times;</button>
      </div>

      <div class="modal-body">
        <!-- CSS Envelope Shape -->
        <div :class="['envelope-shape', { 'envelope-opened': opened, 'envelope-locked': isLocked }]">
          <div class="envelope-back" aria-hidden="true"></div>
          <div class="envelope-flap"></div>
          <div class="envelope-seal" aria-hidden="true">🧧</div>
          <div class="envelope-characters" aria-hidden="true">恭喜發財</div>
          <div class="envelope-content">
            <div v-if="openResult !== null" class="open-amount-text">~{{ formatGas(openResult) }} GAS</div>
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
        <div v-if="checking" class="eligibility-check loading">{{ t("searching") }}</div>

        <div v-else-if="eligibility" class="eligibility-check">
          <template v-if="hasGate">
            <div class="eligibility-row">
              <span>{{ t("neoBalance") }}</span>
              <span
                :class="eligibility.neoBalance >= eligibility.minNeoRequired ? 'text-ok' : 'text-fail'"
                :aria-label="eligibility.neoBalance >= eligibility.minNeoRequired ? t('active') : t('insufficientNeo')"
              >
                {{ eligibility.neoBalance >= eligibility.minNeoRequired ? "✅" : "❌" }}
                {{ eligibility.neoBalance }} NEO
              </span>
            </div>
            <div class="eligibility-row">
              <span>{{ t("holdingDays") }}</span>
              <span
                :class="eligibility.holdDays >= requiredHoldDays ? 'text-ok' : 'text-fail'"
                :aria-label="eligibility.holdDays >= requiredHoldDays ? t('active') : t('holdNotMet')"
              >
                {{ eligibility.holdDays >= requiredHoldDays ? "✅" : "❌" }}
                {{ eligibility.holdDays }}d
              </span>
            </div>
            <div class="eligibility-row">
              <span>{{ t("neoRequirement") }}</span>
              <span>≥{{ eligibility.minNeoRequired }} NEO, ≥{{ requiredHoldDays }}d</span>
            </div>
            <div v-if="!eligibility.eligible" class="status error">
              {{
                eligibility.reason === "insufficient NEO"
                  ? t("insufficientNeo")
                  : eligibility.reason === "hold duration not met"
                    ? t("holdNotMet")
                    : eligibility.reason
              }}
            </div>
          </template>
          <div v-else class="eligibility-row">
            <span>{{ t("neoRequirement") }}</span>
            <span>{{ t("detailNoGate") }}</span>
          </div>
        </div>

        <div v-if="eligibilityWarning" class="status text-subtle-sm">
          {{ eligibilityWarning }}
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

        <div v-if="openResult !== null" class="open-result-hint">
          {{ resultHint }}
        </div>

        <div v-if="openResult !== null" class="modal-actions">
          <button v-if="openResult > 0" class="btn btn-open" @click="showShare = true">
            🎉 {{ t("shareYourLuck") }}
          </button>
          <button v-if="props.envelope.envelopeType === 0" class="btn btn-transfer" @click="emit('transfer')">
            {{ t("sendToFriend") }}
          </button>
          <button class="btn btn-primary" @click="emit('close')">
            {{ t("close") }}
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- Share Card overlay -->
  <ShareCard
    v-if="showShare && openResult !== null && address"
    :amount="openResult"
    :envelope-id="props.envelope.id"
    :address="address"
    :message="props.envelope.message"
    :creator-script-hash="props.envelope.creator"
    :min-neo-required="props.envelope.minNeoRequired"
    :min-hold-days="Math.floor(props.envelope.minHoldSeconds / 86400)"
    :envelope-type="props.envelope.envelopeType"
    @close="showShare = false"
  />
</template>
