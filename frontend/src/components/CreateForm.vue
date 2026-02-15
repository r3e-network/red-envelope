<script setup lang="ts">
import { ref, computed, nextTick, onUnmounted } from "vue";
import QRCode from "qrcode";
import { useWallet } from "@/composables/useWallet";
import { useRedEnvelope } from "@/composables/useRedEnvelope";
import { useI18n } from "@/composables/useI18n";
import { CONTRACT_HASH } from "@/config/contract";
import { extractError, formatGas } from "@/utils/format";
import { scriptHashHexToAddress } from "@/utils/neo";
import { extractEnvelopeCreatedId, waitForConfirmation } from "@/utils/rpc";
import { parseOptionalNumber } from "./createForm.logic";

const { t } = useI18n();
const { address, connected, connect } = useWallet();
const { createEnvelope, getTokenURI, isLoading } = useRedEnvelope();

const amount = ref("");
const count = ref("");
const expiryHours = ref("24");
const message = ref("");
const minNeo = ref("");
const minHoldDays = ref("");
const envelopeType = ref(1); // 0=spreading (Lucky NFT), 1=pool (Red Envelope Pool)
const confirming = ref(false);
const status = ref<{ msg: string; type: "success" | "error" } | null>(null);
const createdEnvelopeId = ref("");
const shareCopied = ref(false);
const createdNftImage = ref("");
const createdBlessing = ref("");
const createdByAddress = ref("");
const createdTotalGas = ref(0);
const createdMinNeoRequired = ref(0);
const createdMinHoldDays = ref(0);
const createdEnvelopeType = ref(0);
const shareImageCopied = ref(false);
const shareImageSaved = ref(false);
const shareImageWorking = ref(false);
const shareCanvasRef = ref<HTMLCanvasElement | null>(null);
const confirmCountdown = ref(60);
const confirmProgress = ref(0);
const confirmTimer = ref<ReturnType<typeof setInterval> | null>(null);

const shareLink = computed(() => {
  if (!createdEnvelopeId.value || typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  url.searchParams.set("id", createdEnvelopeId.value);
  return url.toString();
});

const createShareImageLabel = computed(() => (shareImageCopied.value ? t("shareCopied") : t("shareCopyImage")));
const createSaveImageLabel = computed(() => (shareImageSaved.value ? t("shareSaved") : t("shareSaveImage")));

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
  return (
    a >= 1 &&
    c >= 1 &&
    c <= 100 &&
    Number.isInteger(c) &&
    a >= c * 0.1 &&
    e >= 1 &&
    Number.isInteger(e) &&
    minNeoInputValid.value &&
    minHoldDaysInputValid.value
  );
});

const perPacket = computed(() => {
  const a = Number(amount.value);
  const c = Number(count.value);
  if (a > 0 && c > 0) return (a / c).toFixed(2);
  return "—";
});

const parsedMinNeo = computed(() => parseOptionalNumber(minNeo.value, 0));
const parsedMinHoldDays = computed(() => parseOptionalNumber(minHoldDays.value, 0));

const minNeoInputValid = computed(() => {
  const raw = String(minNeo.value).trim();
  if (!raw) return true;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= 0;
});

const minHoldDaysInputValid = computed(() => {
  const raw = String(minHoldDays.value).trim();
  if (!raw) return true;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= 0;
});

const showMinPerPacketError = computed(() => {
  const a = Number(amount.value);
  const c = Number(count.value);
  return amount.value && count.value && a >= 1 && c >= 1 && c <= 100 && a < c * 0.1;
});

function clearConfirmTimer() {
  if (confirmTimer.value) {
    clearInterval(confirmTimer.value);
    confirmTimer.value = null;
  }
}

function startConfirmTimer(totalSeconds = 60) {
  clearConfirmTimer();
  confirmCountdown.value = totalSeconds;
  confirmProgress.value = 0;

  confirmTimer.value = setInterval(() => {
    confirmCountdown.value = Math.max(0, confirmCountdown.value - 1);
    confirmProgress.value = Math.round(((totalSeconds - confirmCountdown.value) / totalSeconds) * 100);
    if (confirmCountdown.value <= 0) {
      clearConfirmTimer();
    }
  }, 1000);
}

function encodeBase64Utf8(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getPlayIntroByType(type: number): string {
  if (type === 2) return t("playIntroClaim");
  if (type === 1) return t("playIntroPool");
  return t("playIntroSpreading");
}

function getCreatedGateText(): string {
  if (createdMinNeoRequired.value <= 0 && createdMinHoldDays.value <= 0) return t("shareGateNone");
  return t("shareGateRequirement", createdMinNeoRequired.value, createdMinHoldDays.value);
}

function buildCreatedFallbackNftImage(envelopeId: string, blessing: string): string {
  const creator = createdByAddress.value || scriptHashHexToAddress(address.value) || address.value || "";
  const safeCreator = escapeXml(creator);
  const safeBlessing = escapeXml((blessing || t("defaultBlessing")).slice(0, 52));
  const totalText = createdTotalGas.value > 0 ? formatGas(createdTotalGas.value) : "";
  const gateText = escapeXml(getCreatedGateText());
  const playText = escapeXml(getPlayIntroByType(createdEnvelopeType.value));

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 470">` +
    `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#7a0000"/><stop offset="100%" stop-color="#250000"/></linearGradient></defs>` +
    `<rect width="720" height="470" rx="24" fill="url(#bg)"/>` +
    `<rect x="14" y="14" width="692" height="442" rx="18" fill="none" stroke="#ffd35a" stroke-width="2"/>` +
    `<text x="36" y="58" fill="#ffd35a" font-size="30" font-family="sans-serif" font-weight="700">Neo N3 Red Envelope</text>` +
    `<text x="36" y="98" fill="#fff2cc" font-size="22" font-family="sans-serif">Envelope #${envelopeId}</text>` +
    `<text x="36" y="140" fill="#ffffff" font-size="20" font-family="sans-serif">${t("snakeYearBadge")}</text>` +
    `<text x="36" y="180" fill="#ffffff" font-size="18" font-family="sans-serif">${totalText ? `Total ${totalText} GAS` : ""}</text>` +
    `<text x="36" y="220" fill="#ffe8c2" font-size="18" font-family="sans-serif">${safeBlessing}</text>` +
    `<text x="36" y="258" fill="#ffd9a0" font-size="15" font-family="monospace">Creator: ${safeCreator}</text>` +
    `<text x="36" y="292" fill="#ffd35a" font-size="15" font-family="sans-serif">${gateText}</text>` +
    `<text x="36" y="324" fill="#ffd35a" font-size="14" font-family="sans-serif">${t("shareGameplay", playText)}</text>` +
    `</svg>`;

  return `data:image/svg+xml;base64,${encodeBase64Utf8(svg)}`;
}

async function parseTokenUriImage(uri: string): Promise<string> {
  const trimmed = uri.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("data:image/")) return trimmed;

  if (trimmed.startsWith("data:application/json;base64,")) {
    const raw = trimmed.slice("data:application/json;base64,".length);
    const jsonText = new TextDecoder().decode(Uint8Array.from(atob(raw), (c) => c.charCodeAt(0)));
    const parsed = JSON.parse(jsonText) as { image?: string };
    return typeof parsed.image === "string" ? parsed.image : "";
  }

  if (trimmed.startsWith("data:application/json,")) {
    const parsed = JSON.parse(decodeURIComponent(trimmed.slice("data:application/json,".length))) as { image?: string };
    return typeof parsed.image === "string" ? parsed.image : "";
  }

  if (!/^https?:\/\//i.test(trimmed)) return "";
  const res = await fetch(trimmed);
  if (!res.ok) return "";
  const ctype = res.headers.get("content-type")?.toLowerCase() || "";
  if (ctype.startsWith("image/")) return trimmed;

  if (ctype.includes("application/json")) {
    const parsed = (await res.json()) as { image?: string };
    return typeof parsed.image === "string" ? parsed.image : "";
  }
  return "";
}

async function loadCreatedNftImage(envelopeId: string, blessing: string) {
  createdNftImage.value = "";
  try {
    const tokenUri = await getTokenURI(envelopeId);
    const parsedImage = await parseTokenUriImage(tokenUri);
    createdNftImage.value = parsedImage || buildCreatedFallbackNftImage(envelopeId, blessing);
  } catch {
    createdNftImage.value = buildCreatedFallbackNftImage(envelopeId, blessing);
  }
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("failed to load image"));
    img.src = src;
  });
  return img;
}

async function getCreateShareCanvas(): Promise<HTMLCanvasElement> {
  if (!createdEnvelopeId.value || !shareLink.value) throw new Error(t("nftLoadFailed"));
  const canvas = shareCanvasRef.value;
  if (!canvas) throw new Error("Share canvas unavailable");

  const W = 860;
  const H = 1320;
  const dpr = 2;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context unavailable");
  ctx.scale(dpr, dpr);

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#6f0606");
  bg.addColorStop(1, "#2b0000");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "rgba(255, 215, 0, 0.55)";
  ctx.lineWidth = 2;
  ctx.strokeRect(16, 16, W - 32, H - 32);

  ctx.fillStyle = "#ffd35a";
  ctx.font = "700 48px Georgia, serif";
  ctx.textAlign = "center";
  ctx.fillText("Neo N3 Red Envelope", W / 2, 84);

  ctx.fillStyle = "#ffdba0";
  ctx.font = "600 28px sans-serif";
  ctx.fillText(t("snakeYearBadge"), W / 2, 124);

  const blessing = (createdBlessing.value || t("defaultBlessing")).slice(0, 48);
  ctx.fillStyle = "#fff0c9";
  ctx.font = "600 30px sans-serif";
  ctx.fillText(blessing, W / 2, 170);

  if (createdNftImage.value) {
    try {
      const nft = await loadImage(createdNftImage.value);
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(80, 210, W - 160, 520);
      ctx.drawImage(nft, 92, 222, W - 184, 496);
    } catch {
      // ignore, continue with text/QR
    }
  }

  const creator = createdByAddress.value || scriptHashHexToAddress(address.value) || address.value;
  ctx.fillStyle = "#ffd9a0";
  ctx.font = "600 21px monospace";
  ctx.fillText(creator, W / 2, 786);

  ctx.fillStyle = "#ffe0b8";
  ctx.font = "600 21px sans-serif";
  ctx.fillText(getCreatedGateText(), W / 2, 818);

  ctx.fillStyle = "#ffd089";
  ctx.font = "500 18px sans-serif";
  ctx.fillText(t("shareGameplay", getPlayIntroByType(createdEnvelopeType.value)), W / 2, 848);

  const qr = await QRCode.toDataURL(shareLink.value, {
    margin: 1,
    width: 280,
    color: { dark: "#3a0000", light: "#00000000" },
  });
  const qrImage = await loadImage(qr);
  ctx.fillStyle = "#f8e7c1";
  ctx.fillRect(W / 2 - 160, 874, 320, 320);
  ctx.drawImage(qrImage, W / 2 - 140, 894, 280, 280);

  ctx.fillStyle = "#ffe9c3";
  ctx.font = "500 18px sans-serif";
  ctx.fillText(shareLink.value, W / 2, 1234);

  ctx.fillStyle = "#ffd35a";
  ctx.font = "700 32px sans-serif";
  ctx.fillText(`#${createdEnvelopeId.value}`, W / 2, 1286);

  return canvas;
}

async function copyShareImage() {
  if (!createdEnvelopeId.value) return;
  shareImageWorking.value = true;
  try {
    const canvas = await getCreateShareCanvas();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Failed to create image");

    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      await saveShareImage();
      return;
    }

    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    shareImageCopied.value = true;
    shareImageSaved.value = false;
    setTimeout(() => {
      shareImageCopied.value = false;
    }, 1800);
  } catch (e: unknown) {
    status.value = { msg: extractError(e), type: "error" };
  } finally {
    shareImageWorking.value = false;
  }
}

async function saveShareImage() {
  if (!createdEnvelopeId.value) return;
  shareImageWorking.value = true;
  try {
    const canvas = await getCreateShareCanvas();
    const link = document.createElement("a");
    link.download = `red-envelope-share-${createdEnvelopeId.value}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    shareImageSaved.value = true;
    shareImageCopied.value = false;
    setTimeout(() => {
      shareImageSaved.value = false;
    }, 1800);
  } catch (e: unknown) {
    status.value = { msg: extractError(e), type: "error" };
  } finally {
    shareImageWorking.value = false;
  }
}

onUnmounted(() => {
  clearConfirmTimer();
});

const handleSubmit = async () => {
  if (!connected.value) {
    await connect();
    return;
  }
  status.value = null;
  createdEnvelopeId.value = "";
  createdNftImage.value = "";
  shareCopied.value = false;
  shareImageCopied.value = false;
  shareImageSaved.value = false;
  const blessing = message.value || t("defaultBlessing");
  const submitMinNeo = parseOptionalNumber(minNeo.value, 0);
  const submitMinHoldDays = parseOptionalNumber(minHoldDays.value, 0);
  const submitTotalGas = Number(amount.value);
  createdBlessing.value = blessing;
  createdByAddress.value = scriptHashHexToAddress(address.value) || address.value;
  createdTotalGas.value = Number.isFinite(submitTotalGas) ? submitTotalGas : 0;
  createdMinNeoRequired.value = submitMinNeo;
  createdMinHoldDays.value = submitMinHoldDays;
  createdEnvelopeType.value = envelopeType.value;
  try {
    const txid = await createEnvelope({
      totalGas: submitTotalGas,
      packetCount: Number(count.value),
      expiryHours: Number(expiryHours.value) || 24,
      message: blessing,
      minNeo: submitMinNeo,
      minHoldDays: submitMinHoldDays,
      envelopeType: envelopeType.value,
    });

    const maxConfirmMs = 60_000;
    confirming.value = true;
    status.value = { msg: t("confirming"), type: "success" };
    startConfirmTimer(Math.ceil(maxConfirmMs / 1000));

    const appLog = await waitForConfirmation(txid, maxConfirmMs);
    const envelopeId = extractEnvelopeCreatedId(appLog, CONTRACT_HASH);
    if (envelopeId) {
      createdEnvelopeId.value = envelopeId;
      await loadCreatedNftImage(envelopeId, blessing);
      status.value = { msg: t("createSuccessWithId", envelopeId), type: "success" };
    } else {
      status.value = { msg: t("createSuccessTx", txid.slice(0, 12) + "..."), type: "success" };
    }
    amount.value = "";
    count.value = "";
    message.value = "";
    minNeo.value = "";
    minHoldDays.value = "";
  } catch (e: unknown) {
    status.value = { msg: extractError(e), type: "error" };
  } finally {
    confirming.value = false;
    clearConfirmTimer();
    confirmProgress.value = 100;
  }
};

const copyShareLink = async () => {
  if (!shareLink.value) return;
  try {
    await navigator.clipboard.writeText(shareLink.value);
    shareCopied.value = true;
    setTimeout(() => {
      shareCopied.value = false;
    }, 1800);
  } catch (e: unknown) {
    status.value = { msg: extractError(e), type: "error" };
  }
};
</script>

<template>
  <div class="create-form layout-two-col">
    <div v-if="confirming" class="create-wait-overlay" role="status" aria-live="polite">
      <div class="create-wait-card">
        <div class="create-wait-spinner" aria-hidden="true"></div>
        <div class="create-wait-title">{{ t("creatingConfirming") }}</div>
        <div class="create-wait-countdown">{{ t("createCountdown", confirmCountdown) }}</div>
        <div class="create-wait-progress">
          <div class="create-wait-progress-fill" :style="{ width: confirmProgress + '%' }"></div>
        </div>
      </div>
    </div>

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
          <div v-if="count && !Number.isInteger(Number(count))" class="field-hint text-fail">
            {{ t("validationIntegerOnly") }}
          </div>
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
            <div v-if="minNeo && !minNeoInputValid" class="field-hint text-fail">
              {{ t("validationNonNegativeInteger") }}
            </div>
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
            <div v-if="minHoldDays && !minHoldDaysInputValid" class="field-hint text-fail">
              {{ t("validationNonNegativeInteger") }}
            </div>
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
          <div v-if="expiryHours && !Number.isInteger(Number(expiryHours))" class="field-hint text-fail">
            {{ t("validationIntegerOnly") }}
          </div>
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

      <div v-if="createdEnvelopeId" class="create-result-card">
        <div class="create-result-title">{{ t("createdEnvelopeId", createdEnvelopeId) }}</div>
        <div v-if="createdNftImage" class="create-result-nft-wrap">
          <img :src="createdNftImage" :alt="t('createdEnvelopeId', createdEnvelopeId)" class="create-result-nft" />
        </div>
        <a :href="shareLink" class="create-result-link mono-sm" target="_blank" rel="noopener noreferrer">
          {{ shareLink }}
        </a>
        <div class="section-hint">
          {{ getCreatedGateText() }}
        </div>
        <div class="section-hint">
          {{ t("shareGameplay", getPlayIntroByType(createdEnvelopeType)) }}
        </div>
        <div class="create-result-actions">
          <button class="btn btn-sm" @click="copyShareLink">
            {{ shareCopied ? t("shareCopied") : t("copyShareLink") }}
          </button>
          <a :href="shareLink" class="btn btn-sm btn-primary" target="_blank" rel="noopener noreferrer">
            {{ t("openShareLink") }}
          </a>
        </div>
        <div class="create-result-actions create-result-actions-mt">
          <button class="btn btn-sm" :disabled="shareImageWorking" @click="copyShareImage">
            {{ shareImageWorking ? t("creating") : createShareImageLabel }}
          </button>
          <button class="btn btn-sm" :disabled="shareImageWorking" @click="saveShareImage">
            {{ shareImageWorking ? t("creating") : createSaveImageLabel }}
          </button>
        </div>
      </div>
      <canvas ref="shareCanvasRef" class="d-none"></canvas>
    </div>
  </div>
</template>
