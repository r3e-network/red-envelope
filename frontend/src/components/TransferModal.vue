<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from "vue";
import { useRedEnvelope, type EnvelopeItem } from "@/composables/useRedEnvelope";
import { useNeoEligibility, type EligibilityResult } from "@/composables/useNeoEligibility";
import { useI18n } from "@/composables/useI18n";
import { useFocusTrap } from "@/composables/useFocusTrap";
import { extractError } from "@/utils/format";
import { waitForConfirmation } from "@/utils/rpc";

const props = defineProps<{ envelope: EnvelopeItem }>();
const emit = defineEmits<{
  close: [];
  transferred: [];
}>();

const { t } = useI18n();
const { transferEnvelope } = useRedEnvelope();
const { checkEligibilityForAddress } = useNeoEligibility();

const modalRef = ref<HTMLElement | null>(null);
useFocusTrap(modalRef);

const recipient = ref("");
const recipientRef = ref<HTMLInputElement | null>(null);
const sending = ref(false);
const confirming = ref(false);
const checkingRecipientEligibility = ref(false);
const error = ref("");
const success = ref(false);
const recipientEligibility = ref<EligibilityResult | null>(null);
const recipientEligibilityAddress = ref("");

let checkTimer: ReturnType<typeof setTimeout> | null = null;
let checkSeq = 0;

const isValidAddress = (addr: string) => /^N[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr);
const isSpreadingTransfer = computed(() => props.envelope.envelopeType === 0);
const recipientNormalized = computed(() => recipient.value.trim());
const addressValid = computed(() => !recipientNormalized.value || isValidAddress(recipientNormalized.value));
const recipientEligibilityReady = computed(
  () => recipientEligibilityAddress.value === recipientNormalized.value && !!recipientEligibility.value,
);
const recipientEligibilityPassed = computed(() => {
  if (!isSpreadingTransfer.value) return true;
  return recipientEligibilityReady.value && Boolean(recipientEligibility.value?.eligible);
});
const recipientEligibilityText = computed(() => {
  if (!recipientEligibilityReady.value || !recipientEligibility.value) return "";
  return recipientEligibility.value.eligible ? t("transferRecipientEligible") : mapEligibilityError(recipientEligibility.value);
});
const canSubmit = computed(
  () =>
    recipientNormalized.value.length === 34 &&
    addressValid.value &&
    !sending.value &&
    !confirming.value &&
    !checkingRecipientEligibility.value &&
    recipientEligibilityPassed.value,
);

onMounted(() => nextTick(() => recipientRef.value?.focus()));
onUnmounted(() => {
  if (checkTimer) clearTimeout(checkTimer);
  checkSeq++;
});

const mapEligibilityError = (eligibility: EligibilityResult): string => {
  const minHoldDays = Math.floor(eligibility.minHoldSeconds / 86400);
  const reason = (eligibility.reason || "").toLowerCase();
  if (reason.includes("check failed") || reason.includes("wallet") || reason.includes("rpc")) {
    return t("transferRecipientCheckFailed");
  }
  if (eligibility.reason === "insufficient NEO") {
    return t("transferRecipientInsufficientNeo", eligibility.neoBalance, eligibility.minNeoRequired);
  }
  if (eligibility.reason === "hold duration not met") {
    return t("transferRecipientHoldNotMet", eligibility.holdDays, minHoldDays);
  }
  if (eligibility.reason && eligibility.reason !== "unknown") {
    return t("transferRecipientNotEligibleReason", eligibility.reason);
  }
  return t("transferRecipientNotEligible");
};

const runEligibilityCheck = async (targetAddress: string): Promise<EligibilityResult> => {
  const seq = ++checkSeq;
  checkingRecipientEligibility.value = true;
  const result = await checkEligibilityForAddress(props.envelope.id, targetAddress);

  if (seq === checkSeq) {
    recipientEligibility.value = result;
    recipientEligibilityAddress.value = targetAddress;
    checkingRecipientEligibility.value = false;
  }
  return result;
};

watch(recipientNormalized, (next) => {
  error.value = "";

  if (!isSpreadingTransfer.value) return;

  recipientEligibility.value = null;
  recipientEligibilityAddress.value = "";
  checkSeq++;
  if (checkTimer) {
    clearTimeout(checkTimer);
    checkTimer = null;
  }

  if (!next || !isValidAddress(next)) {
    checkingRecipientEligibility.value = false;
    return;
  }

  checkTimer = setTimeout(() => {
    void runEligibilityCheck(next);
  }, 420);
});

const handleTransfer = async () => {
  const targetAddress = recipientNormalized.value;
  if (!isValidAddress(targetAddress)) {
    error.value = t("invalidAddress");
    return;
  }

  if (isSpreadingTransfer.value) {
    const eligibility =
      recipientEligibilityReady.value && recipientEligibilityAddress.value === targetAddress
        ? recipientEligibility.value
        : await runEligibilityCheck(targetAddress);

    if (!eligibility?.eligible) {
      error.value = mapEligibilityError(
        eligibility ?? {
          eligible: false,
          reason: "unknown",
          neoBalance: 0,
          holdDays: 0,
          minNeoRequired: 0,
          minHoldSeconds: 0,
        },
      );
      return;
    }
  }

  sending.value = true;
  error.value = "";
  try {
    const { txid } = await transferEnvelope(props.envelope, targetAddress);
    confirming.value = true;
    try {
      await waitForConfirmation(txid);
    } finally {
      confirming.value = false;
    }
    success.value = true;
    emit("transferred");
  } catch (e: unknown) {
    error.value = extractError(e);
  } finally {
    sending.value = false;
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
    <div class="modal transfer-modal" aria-labelledby="transfer-modal-title">
      <div class="modal-header">
        <h3 id="transfer-modal-title">{{ t("transferEnvelope") }} #{{ envelope.id }}</h3>
        <button class="btn-close" :aria-label="t('close')" @click="emit('close')">&times;</button>
      </div>

      <div class="modal-body">
        <div v-if="success" class="status success">
          {{ t("transferSuccess") }}
        </div>

        <template v-else>
          <div v-if="isSpreadingTransfer" class="section-hint">
            {{ t("transferRecipientCheckHint") }}
          </div>

          <div class="form-group">
            <label class="form-label" for="recipient-address">{{ t("labelRecipient") }}</label>
            <input
              id="recipient-address"
              ref="recipientRef"
              v-model="recipient"
              type="text"
              :placeholder="t('recipientAddress')"
              :class="['input', { 'input-error': !addressValid }]"
              maxlength="34"
            />
            <div v-if="!addressValid" class="field-hint text-fail">{{ t("invalidAddress") }}</div>
          </div>

          <div
            v-if="isSpreadingTransfer && recipientNormalized && addressValid"
            :class="['status', checkingRecipientEligibility ? 'transfer-eligibility-pending' : recipientEligibilityPassed ? 'success' : 'error']"
          >
            {{ checkingRecipientEligibility ? t("checkingRecipientEligibility") : recipientEligibilityText }}
          </div>

          <div v-if="error" class="status error">{{ error }}</div>

          <div class="modal-actions">
            <button class="btn" @click="emit('close')">
              {{ t("cancel") }}
            </button>
            <button class="btn btn-primary" :disabled="!canSubmit || confirming" @click="handleTransfer">
              {{
                confirming
                  ? t("confirming")
                  : sending
                    ? t("transferring")
                    : checkingRecipientEligibility
                      ? t("checkingRecipientEligibility")
                      : t("confirm")
              }}
            </button>
          </div>
        </template>

        <button v-if="success" class="btn btn-primary" @click="emit('close')">
          {{ t("close") }}
        </button>
      </div>
    </div>
  </div>
</template>
