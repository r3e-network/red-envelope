<script setup lang="ts">
import { onMounted } from "vue";
import { useI18n } from "@/composables/useI18n";
import { useAudio } from "@/composables/useAudio";
import { formatGas } from "@/utils/format";

const props = defineProps<{ amount: number }>();
const { t } = useI18n();
const { playCelebrationSound } = useAudio();

onMounted(() => {
  playCelebrationSound();
});

// Generate 40 confetti particles with random properties
const confettiColors = ["#e53935", "#ffd700", "#ff6f60", "#ffab00", "#c62828", "#ffeb3b"];
const confetti = Array.from({ length: 40 }, (_, i) => ({
  id: i,
  color: confettiColors[i % confettiColors.length],
  left: `${Math.random() * 100}%`,
  delay: `${Math.random() * 2}s`,
  duration: `${2 + Math.random() * 2}s`,
  size: `${4 + Math.random() * 6}px`,
}));
</script>

<template>
  <div class="lucky-overlay">
    <!-- CSS confetti particles -->
    <div class="confetti-container" aria-hidden="true">
      <span
        v-for="c in confetti"
        :key="c.id"
        class="confetti-particle"
        :style="{
          left: c.left,
          backgroundColor: c.color,
          animationDelay: c.delay,
          animationDuration: c.duration,
          width: c.size,
          height: c.size,
        }"
      ></span>
    </div>

    <!-- Firework burst -->
    <div class="firework-burst" aria-hidden="true">
      <div class="firework-ring"></div>
      <div class="firework-ring"></div>
      <div class="firework-ring"></div>
    </div>

    <div class="lucky-gongxi" aria-hidden="true">恭喜發財</div>
    <div class="lucky-snake-year" aria-hidden="true">{{ t("snakeYearCelebration") }}</div>
    <div class="lucky-icon" aria-hidden="true">🧧</div>
    <div class="lucky-title">{{ t("congratulations") }}</div>

    <!-- Gold sparkle border around amount -->
    <div class="lucky-amount-wrapper">
      <div class="lucky-amount">
        <span class="amount-value">{{ formatGas(props.amount) }}</span>
        <span class="amount-unit">{{ t("gas") }}</span>
      </div>
    </div>

    <div class="lucky-subtitle">{{ t("shareYourLuck") }}</div>
  </div>
</template>

<style scoped>
.lucky-overlay {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 2rem 1rem;
  animation: fadeIn 0.4s ease;
  position: relative;
  overflow: hidden;
}

/* Confetti container */
.confetti-container {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.confetti-particle {
  position: absolute;
  top: -10px;
  border-radius: 2px;
  animation: confettiDrop 3s ease-in forwards;
}

.lucky-icon {
  font-size: 4rem;
  margin-bottom: 0.5rem;
  animation: bounce 0.6s ease;
  filter: drop-shadow(0 0 8px rgba(255, 215, 0, 0.4));
}

.lucky-title {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--color-gold, #ffd700);
  margin-bottom: 1rem;
  text-shadow: 0 0 12px rgba(255, 215, 0, 0.3);
}

/* Gold sparkle border */
.lucky-amount-wrapper {
  padding: 3px;
  border-radius: 12px;
  background: linear-gradient(
    135deg,
    var(--color-gold, #ffd700),
    var(--color-red, #e53935),
    var(--color-gold, #ffd700)
  );
  background-size: 200% 200%;
  animation: sparkleGradient 2s ease-in-out infinite;
  margin-bottom: 0.75rem;
}

.lucky-amount {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  background: var(--color-bg-card, #2d1111);
  border-radius: 10px;
  padding: 0.75rem 1.5rem;
}

.amount-value {
  font-size: 2.5rem;
  font-weight: 800;
  color: var(--color-gold, #ffd700);
}

.amount-unit {
  font-size: 1rem;
  color: var(--color-text-secondary, #c4a0a0);
}

.lucky-subtitle {
  font-size: 0.875rem;
  color: var(--color-text-secondary, #c4a0a0);
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes bounce {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.2);
  }
}

@keyframes sparkleGradient {
  0%,
  100% {
    background-position: 0% 50%;
  }
  50% {
    background-position: 100% 50%;
  }
}

@keyframes confettiDrop {
  0% {
    transform: translateY(0) rotate(0deg);
    opacity: 1;
  }
  75% {
    opacity: 1;
  }
  100% {
    transform: translateY(350px) rotate(720deg);
    opacity: 0;
  }
}

/* Firework burst */
.firework-burst {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.firework-ring {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  border: 2px solid var(--color-gold, #ffd700);
  animation: fireworkExpand 1s ease-out forwards;
}

.firework-ring:nth-child(2) {
  animation-delay: 0.15s;
  border-color: var(--color-red-light, #ff6f60);
}

.firework-ring:nth-child(3) {
  animation-delay: 0.3s;
  border-color: var(--color-gold-light, #ffeb3b);
}

.lucky-snake-year {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-gold-light, #ffeb3b);
  opacity: 0;
  animation: fadeIn 0.6s ease 0.5s forwards;
  letter-spacing: 0.1em;
  margin-bottom: 0.25rem;
}

.lucky-gongxi {
  font-size: 2rem;
  font-weight: 800;
  color: var(--color-gold, #ffd700);
  text-shadow:
    0 0 20px rgba(255, 215, 0, 0.4),
    0 0 40px rgba(255, 215, 0, 0.2);
  letter-spacing: 0.2em;
  margin-bottom: 0.5rem;
  animation: glowPulse 2s ease-in-out infinite;
}

@keyframes fireworkExpand {
  0% {
    width: 10px;
    height: 10px;
    opacity: 1;
  }
  100% {
    width: 150px;
    height: 150px;
    opacity: 0;
    border-width: 1px;
  }
}

@keyframes glowPulse {
  0%,
  100% {
    text-shadow:
      0 0 20px rgba(255, 215, 0, 0.4),
      0 0 40px rgba(255, 215, 0, 0.2);
  }
  50% {
    text-shadow:
      0 0 30px rgba(255, 215, 0, 0.6),
      0 0 60px rgba(255, 215, 0, 0.3);
  }
}
</style>
