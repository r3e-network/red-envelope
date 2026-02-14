<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useWallet } from "@/composables/useWallet";
import { useI18n } from "@/composables/useI18n";
import { useAudio } from "@/composables/useAudio";
import { CONTRACT_HASH } from "@/config/contract";
import { resolveNetwork } from "@/config/networks";
import SearchClaim from "@/components/SearchClaim.vue";
import CreateForm from "@/components/CreateForm.vue";
import MyEnvelopes from "@/components/MyEnvelopes.vue";

const { t, lang, setLang } = useI18n();
const { address, connected, connect } = useWallet();
const { toggleBGM, isBGMPlaying, bgmVolume, setBGMVolume } = useAudio();
const network = resolveNetwork(import.meta.env.VITE_NETWORK);

type TabId = "search" | "create" | "my";
const TAB_ORDER: TabId[] = ["search", "create", "my"];

const activeTab = ref<TabId>("search");
const walletError = ref("");
const showVolume = ref(false);

const switchTab = (tab: TabId) => {
  activeTab.value = tab;
};

const handleTabKeydown = (e: KeyboardEvent, current: TabId) => {
  const idx = TAB_ORDER.indexOf(current);
  let next: TabId | undefined;
  if (e.key === "ArrowRight" || e.key === "ArrowDown") {
    next = TAB_ORDER[(idx + 1) % TAB_ORDER.length];
  } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
    next = TAB_ORDER[(idx - 1 + TAB_ORDER.length) % TAB_ORDER.length];
  } else if (e.key === "Home") {
    next = TAB_ORDER[0];
  } else if (e.key === "End") {
    next = TAB_ORDER[TAB_ORDER.length - 1];
  }
  if (next) {
    e.preventDefault();
    activeTab.value = next;
    (document.getElementById(`tab-${next}`) as HTMLElement | null)?.focus();
  }
};

const toggleLang = () => setLang(lang.value === "en" ? "zh" : "en");

const handleMusicToggle = () => {
  toggleBGM();
  // Show volume slider when BGM starts (helps mobile users who lack hover)
  showVolume.value = isBGMPlaying.value;
};

const handleVolumeChange = (e: Event) => {
  const val = parseFloat((e.target as HTMLInputElement).value);
  setBGMVolume(val);
};

const handleConnect = async () => {
  walletError.value = "";
  try {
    await connect();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    walletError.value = msg.includes("No Neo wallet") ? t("walletNotDetected") : msg;
  }
};

// Generate golden particles with random properties
const particles = Array.from({ length: 12 }, (_, i) => ({
  id: i,
  left: `${5 + Math.random() * 90}%`,
  bottom: `${-10 - Math.random() * 20}%`,
  delay: `${Math.random() * 8}s`,
  duration: `${6 + Math.random() * 6}s`,
  size: `${2 + Math.random() * 3}px`,
}));

onMounted(() => {
  // Force search tab when URL contains ?id=
  const urlId = new URLSearchParams(window.location.search).get("id");
  if (urlId) activeTab.value = "search";
});
</script>

<template>
  <!-- Floating lanterns background -->
  <div class="floating-lanterns" aria-hidden="true">
    <div class="lantern lantern-1"></div>
    <div class="lantern lantern-2"></div>
    <div class="lantern lantern-3"></div>
    <div class="lantern lantern-4"></div>
    <div class="lantern lantern-5"></div>
    <div class="lantern lantern-6"></div>
  </div>

  <!-- Golden particles -->
  <div class="golden-particles" aria-hidden="true">
    <span
      v-for="p in particles"
      :key="p.id"
      class="golden-particle"
      :style="{
        left: p.left,
        bottom: p.bottom,
        animationDelay: p.delay,
        animationDuration: p.duration,
        width: p.size,
        height: p.size,
      }"
    ></span>
  </div>

  <div class="app app-layer">
    <!-- Music toggle (top-left) -->
    <button
      :class="['btn-music', { playing: isBGMPlaying }]"
      :aria-label="isBGMPlaying ? t('bgmOff') : t('bgmOn')"
      @click="handleMusicToggle"
      @mouseenter="showVolume = true"
      @mouseleave="showVolume = false"
    >
      {{ isBGMPlaying ? "🎵" : "🔇" }}
    </button>
    <div
      :class="['volume-slider-wrap', { visible: showVolume && isBGMPlaying }]"
      @mouseenter="showVolume = true"
      @mouseleave="showVolume = false"
    >
      <input
        type="range"
        class="volume-slider"
        min="0"
        max="0.3"
        step="0.01"
        :aria-label="t('volume')"
        :value="bgmVolume"
        @input="handleVolumeChange"
      />
    </div>

    <header class="app-header golden-frame">
      <!-- Pure CSS envelope icon -->
      <div class="header-envelope-icon">
        <div class="envelope-body"></div>
      </div>

      <h1 class="app-title">{{ t("title") }}</h1>
      <p class="gongxi-text">{{ t("gongxifacai") }}</p>
      <div class="year-badge" aria-hidden="true">{{ t("snakeYearBadge") }}</div>
      <p class="app-subtitle">{{ t("subtitle") }}</p>
      <p class="app-subtitle text-dim">{{ network.label }}</p>

      <button v-if="!connected" class="btn btn-primary" :aria-label="t('connectWallet')" @click="handleConnect">
        {{ t("connectWallet") }}
      </button>
      <div v-else class="wallet-pill">{{ address }}</div>
      <div v-if="walletError" class="wallet-error">{{ walletError }}</div>
    </header>

    <!-- Lang toggle (top-right) -->
    <button class="lang-toggle" :aria-label="t('langToggle')" @click="toggleLang">{{ t("langToggle") }}</button>

    <!-- Gold ornamental divider -->
    <div class="ornament-divider">
      <span class="ornament-dot"></span>
    </div>
    <div class="spring-couplet" aria-hidden="true">
      <span class="couplet-half">{{ t("springCoupletLeft") }}</span>
      <span class="couplet-half">{{ t("springCoupletRight") }}</span>
    </div>

    <nav class="tabs" role="tablist">
      <button
        id="tab-search"
        :class="['tab', { active: activeTab === 'search' }]"
        role="tab"
        :tabindex="activeTab === 'search' ? 0 : -1"
        :aria-selected="activeTab === 'search'"
        aria-controls="tabpanel-search"
        @click="switchTab('search')"
        @keydown="handleTabKeydown($event, 'search')"
      >
        {{ t("searchTab") }}
      </button>
      <button
        id="tab-create"
        :class="['tab', { active: activeTab === 'create' }]"
        role="tab"
        :tabindex="activeTab === 'create' ? 0 : -1"
        :aria-selected="activeTab === 'create'"
        aria-controls="tabpanel-create"
        @click="switchTab('create')"
        @keydown="handleTabKeydown($event, 'create')"
      >
        {{ t("createTab") }}
      </button>
      <button
        id="tab-my"
        :class="['tab', { active: activeTab === 'my' }]"
        role="tab"
        :tabindex="activeTab === 'my' ? 0 : -1"
        :aria-selected="activeTab === 'my'"
        aria-controls="tabpanel-my"
        @click="switchTab('my')"
        @keydown="handleTabKeydown($event, 'my')"
      >
        {{ t("myTab") }}
      </button>
    </nav>

    <main :id="`tabpanel-${activeTab}`" class="app-content" role="tabpanel" :aria-labelledby="`tab-${activeTab}`">
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
      <SearchClaim v-if="activeTab === 'search'" />
      <CreateForm v-else-if="activeTab === 'create'" />
      <MyEnvelopes v-else />
    </main>
  </div>
</template>
