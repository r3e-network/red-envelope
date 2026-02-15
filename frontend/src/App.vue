<script setup lang="ts">
import { computed, ref } from "vue";
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
type SecondaryView = Exclude<TabId, "search"> | null;

const secondaryView = ref<SecondaryView>(null);
const showSecondaryMenu = ref(false);
const walletError = ref("");
const showVolume = ref(false);
const secondaryTitle = computed(() => (secondaryView.value === "create" ? t("createTab") : t("myTab")));

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

const toggleSecondaryMenu = () => {
  showSecondaryMenu.value = !showSecondaryMenu.value;
};

const openSecondaryView = (view: Exclude<TabId, "search">) => {
  secondaryView.value = view;
  showSecondaryMenu.value = false;
};

const backToEnvelope = () => {
  secondaryView.value = null;
  showSecondaryMenu.value = false;
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

    <div v-if="showSecondaryMenu" class="secondary-menu-panel">
      <button class="btn btn-sm" @click="openSecondaryView('create')">
        {{ t("createTab") }}
      </button>
      <button class="btn btn-sm" @click="openSecondaryView('my')">
        {{ t("myTab") }}
      </button>
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
