<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "@/composables/useI18n";
import { useFocusTrap } from "@/composables/useFocusTrap";
import { formatGas, formatHash } from "@/utils/format";
import { useRedEnvelope } from "@/composables/useRedEnvelope";

const props = defineProps<{
  amount: number;
  envelopeId: string;
  address: string;
  minNeoRequired?: number;
  minHoldDays?: number;
  envelopeType?: number;
}>();

const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const { getTokenURI } = useRedEnvelope();

const modalRef = ref<HTMLElement | null>(null);
useFocusTrap(modalRef);

const CARD_W = 600;
const CARD_H = 460;
const CARD_DPR = 2;

const copyStatus = ref("");
const canvasRef = ref<HTMLCanvasElement | null>(null);
const nftSvgDataUri = ref("");
const timers = new Set<ReturnType<typeof setTimeout>>();

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

function decodeBase64Utf8(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// ── Canvas share image generator ──
function drawShareImage(canvas: HTMLCanvasElement): void {
  const W = CARD_W;
  const H = CARD_H;
  const dpr = CARD_DPR;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);

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

  // Subtitle
  ctx.fillStyle = "#c4a0a0";
  ctx.font = "13px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(t("shareEnvelopeId", props.envelopeId), W / 2, 132);

  // Divider line
  ctx.strokeStyle = "rgba(255, 215, 0, 0.2)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(W * 0.2, 152);
  ctx.lineTo(W * 0.8, 152);
  ctx.stroke();

  // "I received" label
  ctx.fillStyle = "#c4a0a0";
  ctx.font = "14px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(t("shareReceived"), W / 2, 180);

  // GAS amount (big)
  ctx.fillStyle = "#ffd700";
  ctx.font = "bold 48px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(formatGas(props.amount), W / 2, 230);

  // "GAS" unit
  ctx.fillStyle = "#c4a0a0";
  ctx.font = "18px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(t("gas"), W / 2, 258);

  // Divider
  ctx.strokeStyle = "rgba(255, 215, 0, 0.2)";
  ctx.beginPath();
  ctx.moveTo(W * 0.2, 280);
  ctx.lineTo(W * 0.8, 280);
  ctx.stroke();

  // Address
  ctx.fillStyle = "#7a5555";
  ctx.font = "12px monospace";
  const maxCenteredTextWidth = W - 52;
  ctx.fillText(fitCanvasText(ctx, formatHash(props.address), maxCenteredTextWidth), W / 2, 308);

  ctx.fillStyle = "#d8c0a0";
  ctx.font = "12px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(fitCanvasText(ctx, gateText(), maxCenteredTextWidth), W / 2, 334);

  ctx.fillStyle = "#c8ac82";
  ctx.font = "11px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(fitCanvasText(ctx, t("shareGameplay", gameplayText()), maxCenteredTextWidth), W / 2, 356);

  // Confetti dots
  const colors = ["#e53935", "#ffd700", "#ff6f60", "#ffab00", "#00e599"];
  for (let i = 0; i < 30; i++) {
    ctx.beginPath();
    const x = Math.random() * W;
    const y = 372 + Math.random() * 58;
    const r = 2 + Math.random() * 3;
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = colors[i % colors.length];
    ctx.globalAlpha = 0.3 + Math.random() * 0.4;
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Footer
  ctx.fillStyle = "#7a5555";
  ctx.font = "11px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText("neo.org", W / 2, H - 16);
}

async function drawShareImageFromSvg(canvas: HTMLCanvasElement, svgDataUri: string): Promise<void> {
  const W = CARD_W;
  const H = CARD_H;
  const dpr = CARD_DPR;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);

  ctx.fillStyle = "#120606";
  roundRect(ctx, 0, 0, W, H, 16);
  ctx.fill();

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("failed to load nft svg"));
    img.src = svgDataUri;
  });

  const pad = 16;
  ctx.drawImage(img, pad, pad, W - pad * 2, H - pad * 2);

  // Overlay requirement + gameplay text so share image always carries rule context.
  const overlayY = H - 88;
  ctx.fillStyle = "rgba(20, 8, 8, 0.74)";
  roundRect(ctx, pad + 6, overlayY, W - (pad + 6) * 2, 64, 10);
  ctx.fill();

  ctx.fillStyle = "#ffdba0";
  ctx.font = "12px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textAlign = "left";
  const maxOverlayTextWidth = W - (pad + 18) * 2;
  ctx.fillText(fitCanvasText(ctx, gateText(), maxOverlayTextWidth), pad + 18, overlayY + 24);
  ctx.fillStyle = "#ffcf87";
  ctx.font = "11px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(fitCanvasText(ctx, t("shareGameplay", gameplayText()), maxOverlayTextWidth), pad + 18, overlayY + 44);
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

function fitCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (!text) return "";
  if (ctx.measureText(text).width <= maxWidth) return text;

  let out = text;
  while (out.length > 0 && ctx.measureText(`${out}...`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return out ? `${out}...` : "...";
}

// ── Actions ──
async function getCanvas(): Promise<HTMLCanvasElement> {
  const c = canvasRef.value;
  if (!c) throw new Error("Canvas element not mounted");
  if (nftSvgDataUri.value) {
    try {
      await drawShareImageFromSvg(c, nftSvgDataUri.value);
    } catch {
      drawShareImage(c);
    }
  } else {
    drawShareImage(c);
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
  const url = `${window.location.origin}${window.location.pathname}?id=${props.envelopeId}`;
  const twitterUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
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
          <div class="share-gate">{{ gateText() }}</div>
          <div class="share-gameplay">{{ t("shareGameplay", gameplayText()) }}</div>
        </div>

        <div v-else class="share-card-preview">
          <div class="share-neo-logo">N</div>
          <div class="share-card-title">{{ t("shareTitle") }}</div>
          <div class="share-card-subtitle">{{ t("shareEnvelopeId", props.envelopeId) }}</div>

          <div class="share-divider"></div>

          <div class="share-received-label">{{ t("shareReceived") }}</div>
          <div class="share-amount">
            <span class="share-amount-value">{{ formatGas(props.amount) }}</span>
            <span class="share-amount-unit">GAS</span>
          </div>

          <div class="share-divider"></div>

          <div class="share-address">{{ formatHash(props.address) }}</div>
          <div class="share-gate">{{ gateText() }}</div>
          <div class="share-gameplay">{{ t("shareGameplay", gameplayText()) }}</div>
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
