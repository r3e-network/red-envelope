<script setup lang="ts">
import { ref, computed, nextTick } from "vue";
import { useWallet } from "@/composables/useWallet";
import { useRedEnvelope } from "@/composables/useRedEnvelope";
import { useI18n } from "@/composables/useI18n";
import { extractError } from "@/utils/format";
import { waitForConfirmation } from "@/utils/rpc";
import { parseOptionalNumber } from "./createForm.logic";

const { t } = useI18n();
const { connected, connect } = useWallet();
const { createEnvelope, isLoading } = useRedEnvelope();

const amount = ref("");
const count = ref("");
const expiryHours = ref("24");
const message = ref("");
const minNeo = ref("");
const minHoldDays = ref("");
const envelopeType = ref(1); // 0=spreading (Lucky NFT), 1=pool (Red Envelope Pool)
const confirming = ref(false);
const status = ref<{ msg: string; type: "success" | "error" } | null>(null);

const radioPoolRef = ref<HTMLElement | null>(null);
const radioNftRef = ref<HTMLElement | null>(null);

const selectType = (type: 0 | 1) => {
  envelopeType.value = type;
  nextTick(() => (type === 1 ? radioPoolRef : radioNftRef).value?.focus());
};

const canSubmit = computed(() => {
  const a = Number(amount.value);
  const c = Number(count.value);
  const e = Number(expiryHours.value);
  return a >= 1 && c >= 1 && c <= 100 && a >= c * 0.1 && e >= 1;
});

const perPacket = computed(() => {
  const a = Number(amount.value);
  const c = Number(count.value);
  if (a > 0 && c > 0) return (a / c).toFixed(2);
  return "—";
});

const parsedMinNeo = computed(() => parseOptionalNumber(minNeo.value, 100));
const parsedMinHoldDays = computed(() => parseOptionalNumber(minHoldDays.value, 2));

const showMinPerPacketError = computed(() => {
  const a = Number(amount.value);
  const c = Number(count.value);
  return amount.value && count.value && a >= 1 && c >= 1 && c <= 100 && a < c * 0.1;
});

const handleSubmit = async () => {
  if (!connected.value) {
    await connect();
    return;
  }
  status.value = null;
  try {
    const txid = await createEnvelope({
      totalGas: Number(amount.value),
      packetCount: Number(count.value),
      expiryHours: Number(expiryHours.value) || 24,
      message: message.value || t("defaultBlessing"),
      minNeo: parseOptionalNumber(minNeo.value, 100),
      minHoldDays: parseOptionalNumber(minHoldDays.value, 2),
      envelopeType: envelopeType.value,
    });
    confirming.value = true;
    status.value = { msg: t("confirming"), type: "success" };
    await waitForConfirmation(txid);
    status.value = { msg: `TX: ${txid.slice(0, 12)}...`, type: "success" };
    amount.value = "";
    count.value = "";
    message.value = "";
    minNeo.value = "";
    minHoldDays.value = "";
  } catch (e: unknown) {
    status.value = { msg: extractError(e), type: "error" };
  } finally {
    confirming.value = false;
  }
};
</script>

<template>
  <div class="create-form layout-two-col">
    <!-- LEFT PANEL: Flow explanation + Summary -->
    <div class="panel-left">
      <h3 class="detail-title flow-title">{{ t("createFlowTitle") }}</h3>

      <div class="flow-banner">{{ envelopeType === 1 ? t("flowBannerPool") : t("flowBannerNft") }}</div>

      <ul class="flow-steps">
        <template v-if="envelopeType === 1">
          <li>{{ t("createFlowPoolStep1") }}</li>
          <li>{{ t("createFlowPoolStep2") }}</li>
          <li>{{ t("createFlowPoolStep3") }}</li>
          <li>{{ t("createFlowPoolStep4") }}</li>
        </template>
        <template v-else>
          <li>{{ t("createFlowNftStep1") }}</li>
          <li>{{ t("createFlowNftStep2") }}</li>
          <li>{{ t("createFlowNftStep3") }}</li>
          <li>{{ t("createFlowNftStep4") }}</li>
        </template>
      </ul>

      <!-- Summary card (shows when form is valid) -->
      <div v-if="canSubmit" class="summary-card">
        <div class="summary-title">{{ t("summaryTitle") }}</div>
        <div class="summary-row">
          <span>{{ t("summaryTotal") }}</span>
          <span class="summary-value">{{ amount }} GAS</span>
        </div>
        <div class="summary-row">
          <span>{{ envelopeType === 1 ? t("summaryPerSlot") : t("summaryPerOpen") }}</span>
          <span class="summary-value">~{{ perPacket }} GAS</span>
        </div>
        <div class="summary-row">
          <span>{{ t("summaryExpiry") }}</span>
          <span class="summary-value">{{ t("summaryHours", expiryHours) }}</span>
        </div>
        <div class="summary-row">
          <span>{{ t("summaryNeoGate") }}</span>
          <span class="summary-value">≥{{ parsedMinNeo }} NEO, ≥{{ parsedMinHoldDays }}d</span>
        </div>
      </div>
    </div>

    <!-- RIGHT PANEL: Form inputs -->
    <div class="panel-right">
      <!-- 🎁 Envelope Type Selector -->
      <div class="form-section">
        <div class="form-section-title">{{ t("envelopeTypeSection") }}</div>
        <div id="envelope-type" class="type-selector" role="radiogroup" :aria-label="t('envelopeTypeSection')">
          <div
            ref="radioPoolRef"
            :class="['type-option', { 'type-active': envelopeType === 1 }]"
            role="radio"
            :tabindex="envelopeType === 1 ? 0 : -1"
            :aria-checked="envelopeType === 1"
            @click="selectType(1)"
            @keydown.enter="selectType(1)"
            @keydown.space.prevent="selectType(1)"
            @keydown.left="selectType(1)"
            @keydown.right="selectType(0)"
            @keydown.up.prevent="selectType(1)"
            @keydown.down.prevent="selectType(0)"
          >
            <div class="type-label">{{ t("typePool") }}</div>
            <div class="type-desc">{{ t("typePoolDesc") }}</div>
          </div>
          <div
            ref="radioNftRef"
            :class="['type-option', { 'type-active': envelopeType === 0 }]"
            role="radio"
            :tabindex="envelopeType === 0 ? 0 : -1"
            :aria-checked="envelopeType === 0"
            @click="selectType(0)"
            @keydown.enter="selectType(0)"
            @keydown.space.prevent="selectType(0)"
            @keydown.left="selectType(1)"
            @keydown.right="selectType(0)"
            @keydown.up.prevent="selectType(1)"
            @keydown.down.prevent="selectType(0)"
          >
            <div class="type-label">{{ t("typeNft") }}</div>
            <div class="type-desc">{{ t("typeNftDesc") }}</div>
          </div>
        </div>
      </div>

      <!-- 💰 Amount Section -->
      <div class="form-section">
        <div class="form-section-title">{{ t("amountSection") }}</div>
        <div class="form-group">
          <label class="form-label" for="total-gas">{{ t("labelGasAmount") }}</label>
          <input
            id="total-gas"
            v-model="amount"
            type="number"
            step="0.1"
            min="1"
            :placeholder="t('totalGasPlaceholder')"
            class="input"
          />
          <div v-if="amount && Number(amount) < 1" class="field-hint text-fail">{{ t("validationMinGas") }}</div>
        </div>
        <div class="form-group">
          <label class="form-label" for="packet-count">{{
            envelopeType === 1 ? t("labelClaimSlots") : t("labelOpenCount")
          }}</label>
          <input
            id="packet-count"
            v-model="count"
            type="number"
            min="1"
            max="100"
            :placeholder="t('packetsPlaceholder')"
            class="input"
          />
          <div v-if="count && (Number(count) < 1 || Number(count) > 100)" class="field-hint text-fail">
            {{ t("validationPacketRange") }}
          </div>
          <div v-if="showMinPerPacketError" class="field-hint text-fail">
            {{ t("validationMinPerPacket") }}
          </div>
        </div>
      </div>

      <!-- 🔒 NEO Gate Section -->
      <div class="form-section">
        <div class="form-section-title">{{ t("neoGateSection") }}</div>
        <div class="form-row">
          <div class="input-half">
            <label class="form-label" for="min-neo">{{ t("labelMinNeo") }}</label>
            <input
              id="min-neo"
              v-model="minNeo"
              type="number"
              min="0"
              :placeholder="t('minNeoPlaceholder')"
              class="input"
            />
          </div>
          <div class="input-half">
            <label class="form-label" for="min-hold-days">{{ t("labelHoldDays") }}</label>
            <input
              id="min-hold-days"
              v-model="minHoldDays"
              type="number"
              min="0"
              :placeholder="t('minHoldDaysPlaceholder')"
              class="input"
            />
          </div>
        </div>
      </div>

      <!-- ⏰ Settings Section -->
      <div class="form-section">
        <div class="form-section-title">{{ t("settingsSection") }}</div>
        <div class="form-group">
          <label class="form-label" for="expiry-hours">{{ t("labelExpiry") }}</label>
          <input
            id="expiry-hours"
            v-model="expiryHours"
            type="number"
            min="1"
            :placeholder="t('expiryPlaceholder')"
            class="input"
          />
          <div v-if="expiryHours && Number(expiryHours) < 1" class="field-hint text-fail">
            {{ t("validationExpiryMin") }}
          </div>
        </div>
        <div class="form-group">
          <label class="form-label" for="message">{{ t("labelMessage") }}</label>
          <input
            id="message"
            v-model="message"
            type="text"
            maxlength="256"
            :placeholder="t('messagePlaceholder')"
            class="input"
          />
        </div>
      </div>

      <button class="btn btn-send" :disabled="!canSubmit || isLoading || confirming" @click="handleSubmit">
        {{ confirming ? t("creatingConfirming") : isLoading ? t("creating") : t("sendRedEnvelope") }}
      </button>

      <div v-if="status" :class="['status', status.type]" role="status">
        {{ status.msg }}
      </div>
    </div>
  </div>
</template>
