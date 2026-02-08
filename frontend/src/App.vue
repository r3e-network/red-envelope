<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useWallet } from "@/composables/useWallet";
import { useI18n } from "@/composables/useI18n";
import { CONTRACT_HASH } from "@/config/contract";
import { resolveNetwork } from "@/config/networks";
import SearchClaim from "@/components/SearchClaim.vue";
import CreateForm from "@/components/CreateForm.vue";
import MyEnvelopes from "@/components/MyEnvelopes.vue";

const { t, lang, setLang } = useI18n();
const { address, connected, connect, autoConnect } = useWallet();
const network = resolveNetwork(import.meta.env.VITE_NETWORK);

const activeTab = ref<"search" | "create" | "my">("search");
const walletError = ref("");

const toggleLang = () => setLang(lang.value === "en" ? "zh" : "en");

const handleConnect = async () => {
  walletError.value = "";
  try {
    await connect();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    walletError.value = msg.includes("No Neo wallet") ? t("walletNotDetected") : msg;
  }
};

onMounted(() => {
  autoConnect();
  // Force search tab when URL contains ?id=
  const urlId = new URLSearchParams(window.location.search).get("id");
  if (urlId) activeTab.value = "search";
});
</script>

<template>
  <div class="app">
    <header class="app-header">
      <!-- Pure CSS envelope icon -->
      <div class="header-envelope-icon">
        <div class="envelope-body"></div>
      </div>

      <h1 class="app-title">{{ t("title") }}</h1>
      <p class="app-subtitle">{{ t("subtitle") }}</p>
      <p class="app-subtitle" style="opacity: 0.85">{{ network.label }}</p>

      <button v-if="!connected" class="btn btn-primary" @click="handleConnect">
        {{ t("connectWallet") }}
      </button>
      <div v-else class="wallet-pill">{{ address }}</div>
      <div v-if="walletError" class="wallet-error">{{ walletError }}</div>
    </header>

    <!-- Lang toggle (top-right) -->
    <button class="lang-toggle" @click="toggleLang">{{ t("langToggle") }}</button>

    <!-- Gold ornamental divider -->
    <div class="ornament-divider">
      <span class="ornament-dot"></span>
    </div>

    <nav class="tabs">
      <button :class="['tab', { active: activeTab === 'search' }]" @click="activeTab = 'search'">
        {{ t("searchTab") }}
      </button>
      <button :class="['tab', { active: activeTab === 'create' }]" @click="activeTab = 'create'">
        {{ t("createTab") }}
      </button>
      <button :class="['tab', { active: activeTab === 'my' }]" @click="activeTab = 'my'">
        {{ t("myTab") }}
      </button>
    </nav>

    <main class="app-content">
      <div class="contract-banner">
        Contract:
        <a
          :href="`${network.explorerBase}/contract/${CONTRACT_HASH}`"
          target="_blank"
          rel="noopener noreferrer"
          class="contract-link"
        >
          {{ CONTRACT_HASH }}
        </a>
      </div>
      <SearchClaim v-if="activeTab === 'search'" />
      <CreateForm v-else-if="activeTab === 'create'" />
      <MyEnvelopes v-else />
    </main>
  </div>
</template>
