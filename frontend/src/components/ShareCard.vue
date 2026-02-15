<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "@/composables/useI18n";
import { useFocusTrap } from "@/composables/useFocusTrap";
import { formatGas } from "@/utils/format";
import { useRedEnvelope } from "@/composables/useRedEnvelope";
import { scriptHashHexToAddress } from "@/utils/neo";
import QRCode from "qrcode";

const props = defineProps<{
  amount: number;
  envelopeId: string;
  address: string;
  minNeoRequired?: number;
  minHoldDays?: number;
  envelopeType?: number;
  message?: string;
  creatorScriptHash?: string;
}>();

const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const { getTokenURI } = useRedEnvelope();

const modalRef = ref<HTMLElement | null>(null);
useFocusTrap(modalRef);

const CARD_W = 600;
const CARD_H = 680;
const CARD_DPR = 2;

const copyStatus = ref("");
const canvasRef = ref<HTMLCanvasElement | null>(null);
const nftSvgDataUri = ref("");
const qrDataUrl = ref("");
const timers = new Set<ReturnType<typeof setTimeout>>();

const shareLink = computed(() => {
  if (typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  url.searchParams.set("id", props.envelopeId);
  return url.toString();
});

const creatorAddress = computed(() => {
  if (!props.creatorScriptHash) return "";
  return scriptHashHexToAddress(props.creatorScriptHash) || props.creatorScriptHash;
});

const blessingText = computed(() => props.message?.trim() || t("defaultBlessing"));

const gateText = () => {
  const neo = Number(props.minNeoRequired ?? 0);
  const hold = Number(props.minHoldDays ?? 0);
  if (neo <= 0 && hold <= 0) return t("shareGateNone");
  return t("shareGateRequirement", neo, hold);
};

const gameplayText = () => {
  if (props.envelopeType === 2) return t("playIntroClaim");
  if (props.envelopeType === 1) return t("playIntroPool");
  return t("playIntroSpreading");
};

onUnmounted(() => {
  timers.forEach(clearTimeout);
  timers.clear();
});

onMounted(async () => {
  await ensureQrDataUrl();
  try {
    const uri = await getTokenURI(props.envelopeId);
    if (!uri.startsWith("data:application/json;base64,")) return;

    const jsonBase64 = uri.slice("data:application/json;base64,".length);
    const jsonText = decodeBase64Utf8(jsonBase64);
    const obj = JSON.parse(jsonText) as { image?: string };
    if (obj?.image?.startsWith("data:image/svg+xml;base64,")) {
      nftSvgDataUri.value = obj.image;
    }
  } catch {
    // fallback to local rendering if tokenURI unavailable
  }
});

async function ensureQrDataUrl(): Promise<string> {
  if (qrDataUrl.value) return qrDataUrl.value;
  if (!shareLink.value) return "";
  try {
    qrDataUrl.value = await QRCode.toDataURL(shareLink.value, {
      width: 220,
      margin: 1,
      errorCorrectionLevel: "M",
      color: {
        dark: "#6f4700",
        light: "#00000000",
      },
    });
  } catch {
    qrDataUrl.value = "";
  }
  return qrDataUrl.value;
}

function decodeBase64Utf8(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function fitCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (!text) return "";
  if (ctx.measureText(text).width <= maxWidth) return text;

  let out = text;
  while (out.length > 0 && ctx.measureText(`${out}...`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return out ? `${out}...` : "...";
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
): number {
  if (!text) return y;
  const lines: string[] = [];
  let line = "";
  for (const ch of text) {
    const next = line + ch;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = ch;
      if (lines.length === maxLines) break;
    } else {
      line = next;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines) {
    lines[maxLines - 1] = fitCanvasText(ctx, lines[maxLines - 1], maxWidth);
  }
  lines.forEach((ln, i) => ctx.fillText(ln, x, y + i * lineHeight));
  return y + lines.length * lineHeight;
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
  return img;
}

function setupCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const W = CARD_W;
  const H = CARD_H;
  const dpr = CARD_DPR;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(dpr, dpr);
  return ctx;
}

async function drawQrArea(ctx: CanvasRenderingContext2D, y: number): Promise<void> {
  const W = CARD_W;
  const qrUri = await ensureQrDataUrl();

  if (qrUri) {
    const qrImg = await loadImage(qrUri);
    const qrSize = 138;
    const qrX = Math.round(W / 2 - qrSize / 2);
    ctx.fillStyle = "rgba(255, 215, 0, 0.08)";
    roundRect(ctx, qrX - 10, y - 10, qrSize + 20, qrSize + 20, 12);
    ctx.fill();
    ctx.drawImage(qrImg, qrX, y, qrSize, qrSize);
  }

  ctx.textAlign = "center";
  ctx.fillStyle = "#dfc69a";
  ctx.font = "12px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(fitCanvasText(ctx, shareLink.value, W - 40), W / 2, y + 160);

  ctx.fillStyle = "#7a5555";
  ctx.font = "12px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(t("shareEnvelopeId", props.envelopeId), W / 2, y + 184);
}

// ── Canvas share image generator ──
async function drawShareImage(canvas: HTMLCanvasElement): Promise<void> {
  const W = CARD_W;
  const H = CARD_H;
  const ctx = setupCanvas(canvas);
  if (!ctx) return;

  // Background gradient
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#2d1111");
  bg.addColorStop(1, "#1a0a0a");
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, W, H, 16);
  ctx.fill();

  // Red accent bar at top
  const topBar = ctx.createLinearGradient(0, 0, W, 0);
  topBar.addColorStop(0, "#e53935");
  topBar.addColorStop(1, "#c62828");
  ctx.fillStyle = topBar;
  ctx.fillRect(0, 0, W, 6);

  // Gold border
  ctx.strokeStyle = "rgba(255, 215, 0, 0.3)";
  ctx.lineWidth = 1.5;
  roundRect(ctx, 8, 12, W - 16, H - 20, 12);
  ctx.stroke();

  // Neo logo circle
  ctx.beginPath();
  ctx.arc(W / 2, 60, 24, 0, Math.PI * 2);
  const logoGrad = ctx.createRadialGradient(W / 2, 60, 0, W / 2, 60, 24);
  logoGrad.addColorStop(0, "#00e599");
  logoGrad.addColorStop(1, "#009966");
  ctx.fillStyle = logoGrad;
  ctx.fill();

  // "N" letter in logo
  ctx.fillStyle = "#fff";
  ctx.font = "bold 24px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("N", W / 2, 61);

  // Title
  ctx.fillStyle = "#ffd700";
  ctx.font = "bold 20px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(t("shareTitle"), W / 2, 108);

  // Year + blessing
  ctx.fillStyle = "#c4a0a0";
  ctx.font = "13px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(t("snakeYearBadge"), W / 2, 132);

  ctx.fillStyle = "#ffdfad";
  ctx.font = "15px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(fitCanvasText(ctx, blessingText.value, W - 52), W / 2, 158);

  // Divider line
  ctx.strokeStyle = "rgba(255, 215, 0, 0.2)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(W * 0.2, 176);
  ctx.lineTo(W * 0.8, 176);
  ctx.stroke();

  // "I received" label
  ctx.fillStyle = "#c4a0a0";
  ctx.font = "14px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(t("shareReceived"), W / 2, 206);

  // GAS amount (big)
  ctx.fillStyle = "#ffd700";
  ctx.font = "bold 48px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(formatGas(props.amount), W / 2, 258);

  // "GAS" unit
  ctx.fillStyle = "#c4a0a0";
  ctx.font = "18px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(t("gas"), W / 2, 286);

  // Divider
  ctx.strokeStyle = "rgba(255, 215, 0, 0.2)";
  ctx.beginPath();
  ctx.moveTo(W * 0.2, 306);
  ctx.lineTo(W * 0.8, 306);
  ctx.stroke();

  const publisher = creatorAddress.value || props.address;
  const maxCenteredTextWidth = W - 60;

  ctx.fillStyle = "#a8835f";
  ctx.font = "12px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(t("sharePublisher"), W / 2, 332);

  ctx.fillStyle = "#f4debc";
  ctx.font = "12px monospace";
  drawWrappedText(ctx, publisher, W / 2, 352, maxCenteredTextWidth, 16, 2);

  ctx.fillStyle = "#d8c0a0";
  ctx.font = "12px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(fitCanvasText(ctx, gateText(), maxCenteredTextWidth), W / 2, 390);

  ctx.fillStyle = "#c8ac82";
  ctx.font = "11px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(fitCanvasText(ctx, t("shareGameplay", gameplayText()), maxCenteredTextWidth), W / 2, 412);

  // Confetti dots
  const colors = ["#e53935", "#ffd700", "#ff6f60", "#ffab00", "#00e599"];
  for (let i = 0; i < 30; i++) {
    ctx.beginPath();
    const x = Math.random() * W;
    const y = 420 + Math.random() * 30;
    const r = 2 + Math.random() * 3;
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = colors[i % colors.length];
    ctx.globalAlpha = 0.3 + Math.random() * 0.4;
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  await drawQrArea(ctx, 452);
}

async function drawShareImageFromSvg(canvas: HTMLCanvasElement, svgDataUri: string): Promise<void> {
  const W = CARD_W;
  const H = CARD_H;
  const ctx = setupCanvas(canvas);
  if (!ctx) return;

  ctx.fillStyle = "#120606";
  roundRect(ctx, 0, 0, W, H, 16);
  ctx.fill();

  const img = await loadImage(svgDataUri);

  const pad = 16;
  ctx.drawImage(img, pad, 136, W - pad * 2, 290);

  ctx.textAlign = "center";
  ctx.fillStyle = "#ffd700";
  ctx.font = "bold 20px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(t("shareTitle"), W / 2, 48);
  ctx.fillStyle = "#d8c0a0";
  ctx.font = "13px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(t("snakeYearBadge"), W / 2, 70);
  ctx.fillStyle = "#ffdfad";
  ctx.font = "15px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(fitCanvasText(ctx, blessingText.value, W - 40), W / 2, 94);
  ctx.fillStyle = "#ffd700";
  ctx.font = "bold 34px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(formatGas(props.amount), W / 2, 124);

  // Overlay requirement + gameplay text so share image always carries rule context.
  const overlayY = 438;
  ctx.fillStyle = "rgba(20, 8, 8, 0.74)";
  roundRect(ctx, pad + 6, overlayY, W - (pad + 6) * 2, 84, 10);
  ctx.fill();

  const publisher = creatorAddress.value || props.address;
  ctx.fillStyle = "#ffdba0";
  ctx.textAlign = "left";
  ctx.font = "12px -apple-system, BlinkMacSystemFont, sans-serif";
  const maxOverlayTextWidth = W - (pad + 18) * 2;
  ctx.fillText(`${t("sharePublisher")}: ${fitCanvasText(ctx, publisher, maxOverlayTextWidth - 80)}`, pad + 18, overlayY + 22);
  ctx.fillText(fitCanvasText(ctx, gateText(), maxOverlayTextWidth), pad + 18, overlayY + 44);
  ctx.fillStyle = "#ffcf87";
  ctx.font = "11px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(fitCanvasText(ctx, t("shareGameplay", gameplayText()), maxOverlayTextWidth), pad + 18, overlayY + 66);

  await drawQrArea(ctx, 536);
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

// ── Actions ──
async function getCanvas(): Promise<HTMLCanvasElement> {
  const c = canvasRef.value;
  if (!c) throw new Error("Canvas element not mounted");
  if (nftSvgDataUri.value) {
    try {
      await drawShareImageFromSvg(c, nftSvgDataUri.value);
    } catch {
      await drawShareImage(c);
    }
  } else {
    await drawShareImage(c);
  }
  return c;
}

async function copyAsImage() {
  try {
    const canvas = await getCanvas();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
    if (!blob) return;
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    copyStatus.value = "copied";
    const t1 = setTimeout(() => {
      copyStatus.value = "";
      timers.delete(t1);
    }, 2000);
    timers.add(t1);
  } catch {
    // Fallback: save instead
    await saveImage();
  }
}

async function saveImage() {
  const canvas = await getCanvas();
  const link = document.createElement("a");
  link.download = `neo-red-envelope-${props.envelopeId}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
  copyStatus.value = "saved";
  const t2 = setTimeout(() => {
    copyStatus.value = "";
    timers.delete(t2);
  }, 2000);
  timers.add(t2);
}

function shareOnTwitter() {
  const text = t("shareTweetText", formatGas(props.amount), props.envelopeId);
  const twitterUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareLink.value)}`;
  window.open(twitterUrl, "_blank", "noopener,noreferrer");
}
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
    <div class="modal share-modal" aria-labelledby="share-modal-title">
      <div class="modal-header">
        <h3 id="share-modal-title">{{ t("congratulations") }}</h3>
        <button class="btn-close" :aria-label="t('close')" @click="emit('close')">&times;</button>
      </div>

      <div class="modal-body share-body">
        <!-- Visual card preview -->
        <div v-if="nftSvgDataUri" class="share-card-preview">
          <img :src="nftSvgDataUri" :alt="t('shareEnvelopeId', props.envelopeId) + ' NFT'" class="nft-preview-img" />
          <div class="share-year">{{ t("snakeYearBadge") }}</div>
          <div class="share-blessing">{{ blessingText }}</div>
        </div>

        <div v-else class="share-card-preview">
          <div class="share-neo-logo">N</div>
          <div class="share-card-title">{{ t("shareTitle") }}</div>
          <div class="share-card-subtitle">{{ t("snakeYearBadge") }}</div>
          <div class="share-blessing">{{ blessingText }}</div>

          <div class="share-divider"></div>

          <div class="share-received-label">{{ t("shareReceived") }}</div>
          <div class="share-amount">
            <span class="share-amount-value">{{ formatGas(props.amount) }}</span>
            <span class="share-amount-unit">GAS</span>
          </div>

          <div class="share-divider"></div>
        </div>

        <div class="share-info-block">
          <div class="share-address-label">{{ t("sharePublisher") }}</div>
          <div class="share-address">{{ creatorAddress || props.address }}</div>
          <div class="share-gate">{{ gateText() }}</div>
          <div class="share-gameplay">{{ t("shareGameplay", gameplayText()) }}</div>
          <div v-if="qrDataUrl" class="share-qr-wrap">
            <img :src="qrDataUrl" :alt="t('shareQrAlt')" class="share-qr-img" />
          </div>
          <a :href="shareLink" target="_blank" rel="noopener noreferrer" class="share-link mono-sm">
            {{ shareLink }}
          </a>
          <div class="share-envelope-id">{{ t("shareEnvelopeId", props.envelopeId) }}</div>
        </div>

        <!-- Action buttons -->
        <div class="share-actions">
          <button class="btn btn-twitter" @click="shareOnTwitter">𝕏 {{ t("shareTwitter") }}</button>
          <button class="btn btn-copy-img" @click="copyAsImage">
            📋 {{ copyStatus === "copied" ? t("shareCopied") : t("shareCopyImage") }}
          </button>
          <button class="btn btn-save-img" @click="saveImage">
            💾 {{ copyStatus === "saved" ? t("shareSaved") : t("shareSaveImage") }}
          </button>
        </div>

        <button class="btn btn-primary btn-block-mt" @click="emit('close')">
          {{ t("close") }}
        </button>
      </div>

      <!-- Hidden canvas for image generation -->
      <canvas ref="canvasRef" class="d-none"></canvas>
    </div>
  </div>
</template>
