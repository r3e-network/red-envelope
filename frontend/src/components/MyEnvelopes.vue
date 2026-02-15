<script setup lang="ts">
import { onMounted, ref, computed, watch } from "vue";
import { useWallet } from "@/composables/useWallet";
import { useRedEnvelope, type EnvelopeItem } from "@/composables/useRedEnvelope";
import { useI18n } from "@/composables/useI18n";
import { useReactiveClock } from "@/composables/useReactiveClock";
import { formatGas, extractError, formatHash } from "@/utils/format";
import { waitForConfirmation } from "@/utils/rpc";
import { computeCountdown, formatCountdownDisplay } from "@/utils/time";
import { addressToScriptHashHex, normalizeScriptHashHex } from "@/utils/neo";
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
const inspectorInput = ref("");
const snapshotCanvasRef = ref<HTMLCanvasElement | null>(null);
const snapshotWorking = ref(false);

const SNAPSHOT_W = 860;
const SNAPSHOT_H = 1120;
const SNAPSHOT_DPR = 2;

const walletHash = computed(() => (address.value ? addressToScriptHashHex(address.value) : ""));
const inspectorHash = computed(() => normalizeScriptHashHex(inspectorInput.value));
const isInspectorActive = computed(() => inspectorInput.value.trim().length > 0);
const isInspectorValid = computed(() => !isInspectorActive.value || !!inspectorHash.value);
const isInspectingCurrentWallet = computed(() => !!inspectorHash.value && inspectorHash.value === walletHash.value);

onMounted(() => {
  if (connected.value) loadEnvelopes();
});

watch(connected, (isConnected) => {
  if (isConnected) loadEnvelopes();
});

// ── Pre-computed enriched list (eliminates repeated calls in template) ──
const enrichedEnvelopes = computed<EnrichedEnvelope[]>(() =>
  envelopes.value.map((env) => {
    // Contract fields are normalized to 0x-prefixed UInt160 script-hash hex.
    // Convert wallet address to the same representation for stable comparisons.
    const addrHash = walletHash.value;
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

// ── Address inspector: view creator/holder envelopes for any address/hash ──
const inspectedEnvelopes = computed<EnrichedEnvelope[]>(() => {
  const hash = inspectorHash.value;
  if (!hash) return [];

  const allowActions = isInspectingCurrentWallet.value;
  const matches: EnrichedEnvelope[] = [];
  for (const env of enrichedEnvelopes.value) {
    const creator = env.creator === hash;
    const holder = env.currentHolder === hash;
    if (!creator && !holder) continue;

    matches.push({
      ...env,
      role: creator
        ? { text: t("roleCreator"), cls: "role-creator" }
        : { text: t("roleHolder"), cls: "role-holder" },
      showOpen: allowActions ? env.showOpen : false,
      showTransfer: allowActions ? env.showTransfer : false,
      showReclaim: allowActions ? env.showReclaim : false,
    });
  }
  return matches;
});

const visibleEnvelopes = computed(() => (isInspectorActive.value ? inspectedEnvelopes.value : myEnvelopes.value));

const sections = computed(() => partitionEnvelopeSections(visibleEnvelopes.value));
const spreadingNfts = computed(() => sections.value.spreadingNfts);
const claimNfts = computed(() => sections.value.claimNfts);
const otherEnvelopes = computed(() => sections.value.otherEnvelopes);
const actionableClaimCount = computed(() => countActionableClaimNfts(claimNfts.value));
const sectionSpreadingTitle = computed(() => (isInspectorActive.value ? t("inspectorSpreadingNfts") : t("mySpreadingNfts")));
const sectionClaimTitle = computed(() => (isInspectorActive.value ? t("inspectorClaimNfts") : t("myClaimNfts")));
const sectionOtherTitle = computed(() => (isInspectorActive.value ? t("inspectorOtherEnvelopes") : t("myOtherEnvelopes")));
const emptyText = computed(() => {
  if (isInspectorActive.value && !isInspectorValid.value) return t("inspectorInvalidAddress");
  if (isInspectorActive.value) return t("inspectorNoEnvelopes");
  return t("noEnvelopes");
});

const clearInspector = () => {
  inspectorInput.value = "";
};

const normalizeInspectorInput = (value: string): string => {
  const normalized = normalizeScriptHashHex(value);
  return normalized || value.trim();
};

const handleInspectWallet = (wallet: string) => {
  const next = normalizeInspectorInput(wallet);
  if (!next) return;
  inspectorInput.value = next;
};

function envelopeTypeLabel(env: EnvelopeItem): string {
  if (env.envelopeType === 0) return t("detailTypeSpreading");
  if (env.envelopeType === 2) return t("detailTypeClaim");
  return t("detailTypePool");
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 0 && ctx.measureText(`${out}...`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}...`;
}

function drawWalletSnapshot(canvas: HTMLCanvasElement) {
  const dpr = SNAPSHOT_DPR;
  const W = SNAPSHOT_W;
  const H = SNAPSHOT_H;

  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context unavailable");
  ctx.scale(dpr, dpr);

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#2a0f10");
  bg.addColorStop(1, "#130809");
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, W, H, 18);
  ctx.fill();

  const top = ctx.createLinearGradient(0, 0, W, 0);
  top.addColorStop(0, "#e53935");
  top.addColorStop(0.5, "#ffd700");
  top.addColorStop(1, "#e53935");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, W, 8);

  const target = inspectorHash.value || inspectorInput.value.trim();
  const walletLabel = formatHash(target);

  ctx.fillStyle = "#ffd76a";
  ctx.font = "700 40px Georgia, serif";
  ctx.textAlign = "left";
  ctx.fillText(t("myTab"), 44, 66);

  ctx.fillStyle = "#f1d4d4";
  ctx.font = "600 24px sans-serif";
  ctx.fillText(walletLabel, 44, 108);

  const chips = [
    [t("inspectorSpreadingNfts"), spreadingNfts.value.length],
    [t("inspectorClaimNfts"), claimNfts.value.length],
    [t("inspectorOtherEnvelopes"), otherEnvelopes.value.length],
  ] as const;

  let chipX = 44;
  for (const [label, count] of chips) {
    const text = `${label}: ${count}`;
    ctx.font = "600 19px sans-serif";
    const width = Math.ceil(ctx.measureText(text).width) + 36;
    const height = 38;

    ctx.fillStyle = "rgba(255, 215, 0, 0.12)";
    roundRect(ctx, chipX, 132, width, height, 10);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 215, 0, 0.35)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "#ffd76a";
    ctx.fillText(text, chipX + 16, 157);
    chipX += width + 12;
  }

  const list = inspectedEnvelopes.value.slice(0, 12);
  const listTop = 198;
  const listBottom = H - 70;
  const rowHeight = Math.max(62, Math.floor((listBottom - listTop) / Math.max(list.length, 1)));
  let y = listTop;

  if (list.length === 0) {
    ctx.fillStyle = "#bfa2a2";
    ctx.font = "500 24px sans-serif";
    ctx.fillText(t("inspectorNoEnvelopes"), 44, listTop + 32);
  } else {
    for (const env of list) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
      roundRect(ctx, 34, y - 28, W - 68, rowHeight - 8, 10);
      ctx.fill();

      ctx.fillStyle = "#ffe08f";
      ctx.font = "700 22px sans-serif";
      const title = `#${env.id} · ${envelopeTypeLabel(env)} · ${env.status}`;
      ctx.fillText(fitText(ctx, title, W - 120), 52, y);

      ctx.fillStyle = "#cdb8b8";
      ctx.font = "500 17px sans-serif";
      const subtitle = `${t("gasRemaining", formatGas(env.remainingAmount))} · ${t("packets", env.openedCount, env.packetCount)}`;
      ctx.fillText(fitText(ctx, subtitle, W - 120), 52, y + 27);
      y += rowHeight;
    }
  }

  ctx.fillStyle = "#7f6565";
  ctx.font = "500 15px monospace";
  ctx.fillText(target, 44, H - 28);
}

async function getSnapshotCanvas(): Promise<HTMLCanvasElement> {
  const canvas = snapshotCanvasRef.value;
  if (!canvas) throw new Error("Snapshot canvas unavailable");
  drawWalletSnapshot(canvas);
  return canvas;
}

async function saveWalletSnapshot() {
  snapshotWorking.value = true;
  try {
    const canvas = await getSnapshotCanvas();
    const link = document.createElement("a");
    const hash = (inspectorHash.value || "wallet").replace(/^0x/i, "");
    link.download = `red-envelope-wallet-${hash.slice(0, 10) || "snapshot"}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    actionStatus.value = { msg: t("shareSaved"), type: "success" };
  } catch (e: unknown) {
    actionStatus.value = { msg: extractError(e), type: "error" };
  } finally {
    snapshotWorking.value = false;
  }
}

async function copyWalletSnapshot() {
  snapshotWorking.value = true;
  try {
    const canvas = await getSnapshotCanvas();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Failed to create snapshot image");

    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      await saveWalletSnapshot();
      return;
    }

    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    actionStatus.value = { msg: t("shareCopied"), type: "success" };
  } catch (e: unknown) {
    actionStatus.value = { msg: extractError(e), type: "error" };
  } finally {
    snapshotWorking.value = false;
  }
}

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

    <div class="inspector-controls">
      <input
        v-model="inspectorInput"
        type="text"
        class="input inspector-input"
        :placeholder="t('inspectorPlaceholder')"
        :aria-label="t('inspectorPlaceholder')"
      />
      <button v-if="inspectorInput" class="btn btn-sm" :aria-label="t('inspectorClear')" @click="clearInspector">
        {{ t("inspectorClear") }}
      </button>
    </div>

    <div v-if="isInspectorActive && isInspectorValid" class="section-hint inspector-hint">
      {{ t("inspectorViewing", inspectorInput.trim()) }}
    </div>
    <div v-if="isInspectorActive && isInspectorValid" class="inspector-share-actions">
      <button class="btn btn-sm" :disabled="snapshotWorking" @click="copyWalletSnapshot">
        📋 {{ snapshotWorking ? t("creating") : t("shareCopyImage") }}
      </button>
      <button class="btn btn-sm" :disabled="snapshotWorking" @click="saveWalletSnapshot">
        💾 {{ snapshotWorking ? t("creating") : t("shareSaveImage") }}
      </button>
    </div>

    <div v-if="loadingEnvelopes" class="loading">{{ t("searching") }}</div>

    <div v-else-if="visibleEnvelopes.length === 0" class="empty">
      {{ emptyText }}
    </div>

    <template v-else>
      <!-- ── Spreading NFTs Section ── -->
      <div class="section-header">
        <span>{{ sectionSpreadingTitle }}</span>
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
          @inspect-wallet="handleInspectWallet"
        />
      </div>

      <!-- ── Claim NFTs Section ── -->
      <div class="section-header">
        <span>{{ sectionClaimTitle }}</span>
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
          @inspect-wallet="handleInspectWallet"
        />
      </div>

      <!-- ── Other Envelopes Section ── -->
      <div class="section-header">
        <span>{{ sectionOtherTitle }}</span>
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
          @inspect-wallet="handleInspectWallet"
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
    <canvas ref="snapshotCanvasRef" class="d-none"></canvas>
  </div>
</template>
