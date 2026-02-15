<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useFocusTrap } from "@/composables/useFocusTrap";
import { useI18n } from "@/composables/useI18n";
import { useRedEnvelope, type EnvelopeItem } from "@/composables/useRedEnvelope";
import { extractError } from "@/utils/format";

type TokenMetadata = {
  name?: string;
  description?: string;
  image?: string;
};

const props = defineProps<{
  envelope: EnvelopeItem;
}>();

const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const { getTokenURI } = useRedEnvelope();

const modalRef = ref<HTMLElement | null>(null);
useFocusTrap(modalRef);

const loading = ref(true);
const actionWorking = ref(false);
const error = ref("");
const imageUri = ref("");
const tokenName = ref("");
const tokenDescription = ref("");
const actionStatus = ref("");

const shareLink = computed(() => {
  if (typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  url.searchParams.set("id", props.envelope.id);
  return url.toString();
});

const modalTitle = computed(() => tokenName.value || t("nftPreviewTitle", props.envelope.id));
const previewDescription = computed(() => tokenDescription.value || props.envelope.message || "");

onMounted(async () => {
  await loadNft();
});

async function parseTokenUri(uri: string): Promise<TokenMetadata | null> {
  const trimmed = uri.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("data:image/")) {
    return { image: trimmed };
  }

  if (trimmed.startsWith("data:application/json;base64,")) {
    const raw = trimmed.slice("data:application/json;base64,".length);
    const binary = atob(raw);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const jsonText = new TextDecoder().decode(bytes);
    return JSON.parse(jsonText) as TokenMetadata;
  }

  if (trimmed.startsWith("data:application/json,")) {
    const encoded = trimmed.slice("data:application/json,".length);
    return JSON.parse(decodeURIComponent(encoded)) as TokenMetadata;
  }

  if (!/^https?:\/\//i.test(trimmed)) return null;

  const res = await fetch(trimmed);
  if (!res.ok) return null;
  const contentType = res.headers.get("content-type")?.toLowerCase() || "";

  if (contentType.includes("application/json")) {
    return (await res.json()) as TokenMetadata;
  }

  if (contentType.startsWith("image/")) {
    return { image: trimmed };
  }

  const text = await res.text();
  try {
    return JSON.parse(text) as TokenMetadata;
  } catch {
    return null;
  }
}

async function loadNft() {
  loading.value = true;
  error.value = "";
  imageUri.value = "";
  tokenName.value = "";
  tokenDescription.value = "";

  try {
    const tokenUri = await getTokenURI(props.envelope.id);
    const metadata = await parseTokenUri(tokenUri);
    if (!metadata) throw new Error(t("nftLoadFailed"));

    tokenName.value = metadata.name ?? "";
    tokenDescription.value = metadata.description ?? "";
    imageUri.value = metadata.image ?? "";
    if (!imageUri.value) {
      error.value = t("nftNoImage");
    }
  } catch (e: unknown) {
    error.value = extractError(e) || t("nftLoadFailed");
  } finally {
    loading.value = false;
  }
}

async function copyShareLink() {
  if (!shareLink.value) return;
  try {
    await navigator.clipboard.writeText(shareLink.value);
    actionStatus.value = t("shareCopied");
    setTimeout(() => {
      actionStatus.value = "";
    }, 1600);
  } catch (e: unknown) {
    actionStatus.value = extractError(e);
  }
}

async function copyImage() {
  if (!imageUri.value) return;
  actionWorking.value = true;
  try {
    const res = await fetch(imageUri.value);
    if (!res.ok) throw new Error(t("nftLoadFailed"));
    const blob = await res.blob();

    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      await saveImage();
      return;
    }

    await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
    actionStatus.value = t("shareCopied");
    setTimeout(() => {
      actionStatus.value = "";
    }, 1600);
  } catch (e: unknown) {
    actionStatus.value = extractError(e);
  } finally {
    actionWorking.value = false;
  }
}

async function saveImage() {
  if (!imageUri.value) return;
  actionWorking.value = true;
  try {
    const link = document.createElement("a");
    link.href = imageUri.value;
    link.download = `red-envelope-nft-${props.envelope.id}.png`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.click();
    actionStatus.value = t("shareSaved");
    setTimeout(() => {
      actionStatus.value = "";
    }, 1600);
  } catch (e: unknown) {
    actionStatus.value = extractError(e);
  } finally {
    actionWorking.value = false;
  }
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
    <div class="modal nft-modal" aria-labelledby="nft-modal-title">
      <div class="modal-header">
        <h3 id="nft-modal-title">{{ modalTitle }}</h3>
        <button class="btn-close" :aria-label="t('close')" @click="emit('close')">&times;</button>
      </div>

      <div class="modal-body">
        <div v-if="loading" class="loading">{{ t("nftLoading") }}</div>

        <div v-else-if="error" class="status error">
          {{ error }}
        </div>

        <template v-else>
          <div class="nft-preview-wrap">
            <img :src="imageUri" :alt="modalTitle" class="nft-preview-img nft-preview-modal-img" />
          </div>

          <div v-if="previewDescription" class="section-hint nft-preview-desc">{{ previewDescription }}</div>
        </template>

        <div class="nft-preview-actions">
          <button class="btn btn-sm" :disabled="actionWorking || !imageUri" @click="copyImage">
            📋 {{ actionWorking ? t("creating") : t("shareCopyImage") }}
          </button>
          <button class="btn btn-sm" :disabled="actionWorking || !imageUri" @click="saveImage">
            💾 {{ actionWorking ? t("creating") : t("shareSaveImage") }}
          </button>
        </div>

        <div class="nft-preview-actions">
          <button class="btn btn-sm" @click="copyShareLink">
            {{ t("copyShareLink") }}
          </button>
          <a :href="shareLink" class="btn btn-sm btn-primary" target="_blank" rel="noopener noreferrer">
            {{ t("openShareLink") }}
          </a>
        </div>

        <div v-if="actionStatus" class="status success">
          {{ actionStatus }}
        </div>
      </div>
    </div>
  </div>
</template>
