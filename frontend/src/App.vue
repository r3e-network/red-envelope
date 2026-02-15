<script setup lang="ts">
import { computed, ref } from "vue";
import { useWallet } from "@/composables/useWallet";
import { useI18n } from "@/composables/useI18n";
import { CONTRACT_HASH } from "@/config/contract";
import { resolveNetwork } from "@/config/networks";
import SearchClaim from "@/components/SearchClaim.vue";
import CreateForm from "@/components/CreateForm.vue";
import MyEnvelopes from "@/components/MyEnvelopes.vue";

const { t, lang, setLang } = useI18n();
const { address, connected, connect } = useWallet();
const network = resolveNetwork(import.meta.env.VITE_NETWORK);

type TabId = "search" | "create" | "my";
type SecondaryView = Exclude<TabId, "search"> | null;

const secondaryView = ref<SecondaryView>(null);
const showSecondaryMenu = ref(false);
const secondaryTitle = computed(() => (secondaryView.value === "create" ? t("createTab") : t("myTab")));
const shellStatus = ref<{ msg: string; type: "success" | "error" } | null>(null);

const toggleLang = () => setLang(lang.value === "en" ? "zh" : "en");

const toggleSecondaryMenu = () => {
  showSecondaryMenu.value = !showSecondaryMenu.value;
};

const closeSecondaryMenu = () => {
  showSecondaryMenu.value = false;
};

const mapWalletConnectError = (err: unknown): string => {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("No Neo wallet") ? t("walletNotDetected") : msg;
};

const ensureConnectedForSecondaryView = async (): Promise<boolean> => {
  if (connected.value) return true;
  try {
    await connect();
    return true;
  } catch (e: unknown) {
    shellStatus.value = { msg: mapWalletConnectError(e), type: "error" };
    return false;
  }
};

const openSecondaryView = async (view: Exclude<TabId, "search">) => {
  if (!(await ensureConnectedForSecondaryView())) return;
  shellStatus.value = null;
  secondaryView.value = view;
  closeSecondaryMenu();
};

const backToEnvelope = () => {
  secondaryView.value = null;
  closeSecondaryMenu();
};
</script>

<template>
  <div class="app app-layer">
    <header class="app-header">
      <h1 class="app-title">{{ t("title") }}</h1>
      <p class="app-subtitle">{{ t("subtitle") }}</p>
      <p class="app-subtitle text-dim">{{ network.label }}</p>
      <div v-if="connected" class="wallet-pill">{{ address }}</div>
    </header>

    <!-- Lang toggle (top-right) -->
    <button class="lang-toggle" :aria-label="t('langToggle')" @click="toggleLang">{{ t("langToggle") }}</button>

    <div class="secondary-toolbar">
      <div class="secondary-current">
        {{ secondaryView ? secondaryTitle : t("mainEnvelopeMode") }}
      </div>
      <div class="secondary-actions">
        <button v-if="secondaryView" class="btn btn-sm" @click="backToEnvelope">
          {{ t("backToEnvelope") }}
        </button>
        <button class="btn btn-sm" @click="toggleSecondaryMenu">
          {{ t("secondaryMenu") }}
        </button>
      </div>
    </div>

    <div v-if="showSecondaryMenu" class="secondary-drawer-overlay" role="dialog" aria-modal="true" @click.self="closeSecondaryMenu">
      <div class="secondary-drawer">
        <div class="secondary-drawer-head">
          <div class="secondary-drawer-title">{{ t("secondaryMenuTitle") }}</div>
          <button class="btn-close" :aria-label="t('close')" @click="closeSecondaryMenu">&times;</button>
        </div>
        <div class="section-hint">
          {{ t("secondaryMenuHint") }}
        </div>
        <div class="secondary-menu-panel">
          <button class="btn btn-sm" @click="openSecondaryView('create')">
            {{ t("createTab") }}
          </button>
          <button class="btn btn-sm" @click="openSecondaryView('my')">
            {{ t("myTab") }}
          </button>
          <button class="btn btn-sm" @click="backToEnvelope">
            {{ t("backToEnvelope") }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="shellStatus" :class="['status', shellStatus.type]" role="status">
      {{ shellStatus.msg }}
    </div>

    <main class="app-content">
      <div class="contract-banner">
        {{ t("contractLabel") }}
        <a
          :href="`${network.explorerBase}/contract/${CONTRACT_HASH}`"
          target="_blank"
          rel="noopener noreferrer"
          class="contract-link"
        >
          {{ CONTRACT_HASH }}
        </a>
      </div>
      <SearchClaim v-if="!secondaryView" />
      <CreateForm v-else-if="secondaryView === 'create'" />
      <MyEnvelopes v-else />
    </main>
  </div>
</template>
