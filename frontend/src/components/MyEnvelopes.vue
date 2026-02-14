<script setup lang="ts">
import { onMounted, ref, computed, watch } from "vue";
import { useWallet } from "@/composables/useWallet";
import { useRedEnvelope, type EnvelopeItem } from "@/composables/useRedEnvelope";
import { useI18n } from "@/composables/useI18n";
import { useReactiveClock } from "@/composables/useReactiveClock";
import { formatGas, extractError } from "@/utils/format";
import { waitForConfirmation } from "@/utils/rpc";
import { computeCountdown, formatCountdownDisplay } from "@/utils/time";
import { addressToScriptHashHex } from "@/utils/neo";
import EnvelopeCard from "./EnvelopeCard.vue";
import type { EnrichedEnvelope } from "./EnvelopeCard.vue";
import OpeningModal from "./OpeningModal.vue";
import TransferModal from "./TransferModal.vue";
import { countActionableClaimNfts, partitionEnvelopeSections } from "./myEnvelopes.logic";

const { t } = useI18n();
const { address, connected } = useWallet();
const { envelopes, loadingEnvelopes, loadEnvelopes, reclaimEnvelope } = useRedEnvelope();
const { now } = useReactiveClock();

const selectedEnvelope = ref<EnvelopeItem | null>(null);
const showOpenModal = ref(false);
const showTransferModal = ref(false);
const actionStatus = ref<{ msg: string; type: "success" | "error" } | null>(null);
const reclaimingId = ref<string | null>(null);

onMounted(() => {
  if (connected.value) loadEnvelopes();
});

watch(connected, (isConnected) => {
  if (isConnected) loadEnvelopes();
});

// ── Pre-computed enriched list (eliminates repeated calls in template) ──
const enrichedEnvelopes = computed<EnrichedEnvelope[]>(() =>
  envelopes.value.map((env) => {
    const addr = address.value;
    // Contract returns base64-encoded UInt160 script hash; wallet returns Neo N3 address.
    // Convert wallet address to base64 script hash for comparison.
    const addrHash = addr ? addressToScriptHashHex(addr) : "";
    const holder = addrHash && env.currentHolder === addrHash;
    const creator = addrHash && env.creator === addrHash;
    const active = env.active && !env.expired && !env.depleted;

    // Role
    let role: EnrichedEnvelope["role"] = null;
    if (creator) role = { text: t("youAreCreator"), cls: "role-creator" };
    else if (holder) role = { text: t("youAreHolder"), cls: "role-holder" };

    const countdown = formatCountdownDisplay(computeCountdown(env.expiryTime, now.value, env.expired), t);

    // Status label
    let status = t("active");
    if (!env.active || env.depleted) status = t("depleted");
    else if (env.expired) status = t("expired");

    return {
      ...env,
      isActive: active,
      progress: env.packetCount > 0 ? Math.round((env.openedCount / env.packetCount) * 100) : 0,
      status,
      role,
      countdown,
      showOpen: active && !!holder,
      showTransfer: !!holder && env.envelopeType !== 1,
      showReclaim: env.envelopeType !== 2 && env.active && env.expired && env.remainingAmount > 0 && !!creator,
      holdDays: Math.floor(env.minHoldSeconds / 86400),
    };
  }),
);

// ── Filtered: only envelopes where user is creator or holder ──
const myEnvelopes = computed(() => enrichedEnvelopes.value.filter((env) => env.role !== null));

const sections = computed(() => partitionEnvelopeSections(myEnvelopes.value));
const spreadingNfts = computed(() => sections.value.spreadingNfts);
const claimNfts = computed(() => sections.value.claimNfts);
const otherEnvelopes = computed(() => sections.value.otherEnvelopes);
const actionableClaimCount = computed(() => countActionableClaimNfts(claimNfts.value));

// ── Actions ──
const handleOpen = (env: EnvelopeItem) => {
  selectedEnvelope.value = env;
  showOpenModal.value = true;
};

const handleTransfer = (env: EnvelopeItem) => {
  selectedEnvelope.value = env;
  showTransferModal.value = true;
};

const handleReclaim = async (env: EnvelopeItem) => {
  actionStatus.value = null;
  reclaimingId.value = env.id;
  try {
    const res = await reclaimEnvelope(env);
    actionStatus.value = { msg: t("reclaimSuccess", formatGas(env.remainingAmount)), type: "success" };
    // Wait for TX confirmation before refreshing state (BUG-4 fix)
    await waitForConfirmation(res.txid);
    await loadEnvelopes();
  } catch (e: unknown) {
    actionStatus.value = { msg: extractError(e), type: "error" };
  } finally {
    reclaimingId.value = null;
  }
};
</script>

<template>
  <div class="my-envelopes">
    <div class="toolbar">
      <h2>{{ t("myTab") }}</h2>
      <button class="btn btn-sm" :aria-label="t('refresh')" @click="loadEnvelopes">↻</button>
    </div>

    <div v-if="loadingEnvelopes" class="loading">{{ t("searching") }}</div>

    <div v-else-if="myEnvelopes.length === 0" class="empty">
      {{ t("noEnvelopes") }}
    </div>

    <template v-else>
      <!-- ── Spreading NFTs Section ── -->
      <div class="section-header">
        <span>{{ t("mySpreadingNfts") }}</span>
        <span class="section-count">{{ spreadingNfts.length }}</span>
      </div>
      <div class="section-hint">{{ t("spreadingNftHint") }}</div>

      <div v-if="spreadingNfts.length === 0" class="section-empty">
        {{ t("noSpreadingNfts") }}
      </div>

      <div v-else class="envelope-list">
        <EnvelopeCard
          v-for="env in spreadingNfts"
          :key="'s-' + env.id"
          :env="env"
          :spreading="true"
          :reclaiming="reclaimingId === env.id"
          @open="handleOpen"
          @transfer="handleTransfer"
          @reclaim="handleReclaim"
        />
      </div>

      <!-- ── Claim NFTs Section ── -->
      <div class="section-header">
        <span>{{ t("myClaimNfts") }}</span>
        <span :class="['section-count', { 'section-count-hot': actionableClaimCount > 0 }]">{{
          claimNfts.length
        }}</span>
      </div>
      <div class="section-hint">
        {{ t("claimNftHint") }}
        <span v-if="actionableClaimCount > 0" class="section-hint-hot">
          · {{ t("claimNftReadyToOpen", actionableClaimCount) }}
        </span>
      </div>

      <div v-if="claimNfts.length === 0" class="section-empty">
        {{ t("noClaimNfts") }}
      </div>

      <div v-else class="envelope-list">
        <EnvelopeCard
          v-for="env in claimNfts"
          :key="'c-' + env.id"
          :env="env"
          :reclaiming="reclaimingId === env.id"
          @open="handleOpen"
          @transfer="handleTransfer"
          @reclaim="handleReclaim"
        />
      </div>

      <!-- ── Other Envelopes Section ── -->
      <div class="section-header">
        <span>{{ t("myOtherEnvelopes") }}</span>
        <span class="section-count">{{ otherEnvelopes.length }}</span>
      </div>

      <div v-if="otherEnvelopes.length === 0" class="section-empty">
        {{ t("noEnvelopes") }}
      </div>

      <div v-else class="envelope-list">
        <EnvelopeCard
          v-for="env in otherEnvelopes"
          :key="'o-' + env.id"
          :env="env"
          :reclaiming="reclaimingId === env.id"
          @open="handleOpen"
          @transfer="handleTransfer"
          @reclaim="handleReclaim"
        />
      </div>
    </template>

    <div v-if="actionStatus" :class="['status', actionStatus.type]" role="status">
      {{ actionStatus.msg }}
    </div>

    <OpeningModal
      v-if="showOpenModal && selectedEnvelope"
      :envelope="selectedEnvelope"
      @close="showOpenModal = false"
      @opened="loadEnvelopes()"
    />

    <TransferModal
      v-if="showTransferModal && selectedEnvelope"
      :envelope="selectedEnvelope"
      @close="showTransferModal = false"
      @transferred="loadEnvelopes()"
    />
  </div>
</template>
