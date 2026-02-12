import { ref } from "vue";

// ---------------------------------------------------------------------------
// Pentatonic note frequencies (Hz)
// ---------------------------------------------------------------------------
const NOTE = {
  A4: 440,
  C5: 523,
  D5: 587,
  E5: 659,
  G5: 784,
  A5: 880,
  C6: 1047,
  D5s: 622, // D#5 / Eb5 — unused but reserved
  Fs5: 740, // F#5
  Gs5: 831, // G#5
  B5: 988,
} as const;

/** 恭喜發財 melody — pentatonic sequence */
const BGM_MELODY: number[] = [
  NOTE.E5,
  NOTE.E5,
  NOTE.D5,
  NOTE.E5,
  NOTE.G5,
  NOTE.G5,
  NOTE.A5,
  NOTE.G5,
  NOTE.E5,
  NOTE.D5,
  NOTE.C5,
  NOTE.D5,
  NOTE.E5,
  NOTE.D5,
  NOTE.C5,
  NOTE.A4,
];

const BGM_NOTE_DURATION = 0.18; // seconds per note
const BGM_NOTE_GAP = 0.02; // silence between notes
const BGM_STEP = BGM_NOTE_DURATION + BGM_NOTE_GAP; // 200ms total

// ---------------------------------------------------------------------------
// Singleton AudioContext (lazy — created on first user gesture)
// ---------------------------------------------------------------------------
let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    window.addEventListener("beforeunload", () => {
      ctx?.close();
      ctx = null;
    });
  }
  if (ctx.state === "suspended") {
    ctx.resume();
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Shared reactive state (singleton across all component instances)
// ---------------------------------------------------------------------------
const isBGMPlaying = ref(false);
const bgmVolume = ref(0.08);

let bgmTimeoutId: ReturnType<typeof setTimeout> | null = null;
let bgmGain: GainNode | null = null;

// ---------------------------------------------------------------------------
// BGM scheduling loop
// ---------------------------------------------------------------------------

/** Schedule one full pass of the melody, then loop via setTimeout. */
function scheduleMelody(): void {
  if (!isBGMPlaying.value) return;
  const ac = getCtx();

  if (!bgmGain) {
    bgmGain = ac.createGain();
    bgmGain.gain.value = bgmVolume.value;
    bgmGain.connect(ac.destination);
  }

  const now = ac.currentTime;

  for (let i = 0; i < BGM_MELODY.length; i++) {
    const start = now + i * BGM_STEP;
    const osc = ac.createOscillator();
    osc.type = "sine";
    osc.frequency.value = BGM_MELODY[i];
    osc.connect(bgmGain);
    osc.start(start);
    osc.stop(start + BGM_NOTE_DURATION);
    osc.onended = () => osc.disconnect();
  }

  // Re-schedule after the full melody finishes
  const loopMs = BGM_MELODY.length * BGM_STEP * 1000;
  bgmTimeoutId = setTimeout(() => {
    if (isBGMPlaying.value) {
      scheduleMelody();
    }
  }, loopMs);
}

function startBGM(): void {
  if (isBGMPlaying.value) return;
  isBGMPlaying.value = true;
  scheduleMelody();
}

function stopBGM(): void {
  isBGMPlaying.value = false;
  if (bgmTimeoutId !== null) {
    clearTimeout(bgmTimeoutId);
    bgmTimeoutId = null;
  }
  if (bgmGain) {
    bgmGain.disconnect();
    bgmGain = null;
  }
}

function toggleBGM(): void {
  if (isBGMPlaying.value) {
    stopBGM();
  } else {
    startBGM();
  }
}

function setBGMVolume(v: number): void {
  bgmVolume.value = Math.max(0, Math.min(1, v));
  if (bgmGain) {
    bgmGain.gain.value = bgmVolume.value;
  }
}

// ---------------------------------------------------------------------------
// SFX helpers
// ---------------------------------------------------------------------------

/** Play a single oscillator note and auto-disconnect after it ends. */
function playNote(
  ac: AudioContext,
  dest: AudioNode,
  freq: number,
  type: OscillatorType,
  startTime: number,
  duration: number,
): void {
  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  osc.connect(dest);
  osc.start(startTime);
  osc.stop(startTime + duration);
  osc.onended = () => osc.disconnect();
}

// ---------------------------------------------------------------------------
// Envelope Open SFX — ascending arpeggio C5→E5→G5→C6 over 400ms
// ---------------------------------------------------------------------------
function playOpenSound(): void {
  const ac = getCtx();
  const gain = ac.createGain();
  gain.gain.value = 0.15;
  gain.connect(ac.destination);

  const notes = [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6];
  const step = 0.1; // 100ms each, 4 notes = 400ms total
  const now = ac.currentTime;

  for (let i = 0; i < notes.length; i++) {
    playNote(ac, gain, notes[i], "triangle", now + i * step, step * 0.9);
  }

  // Disconnect gain after all notes finish
  setTimeout(() => gain.disconnect(), 500);
}

// ---------------------------------------------------------------------------
// Celebration SFX — three layered chords ascending
// ---------------------------------------------------------------------------
function playCelebrationSound(): void {
  const ac = getCtx();
  const gain = ac.createGain();
  gain.gain.value = 0.12;
  gain.connect(ac.destination);

  const chords: [number, number, number][] = [
    [NOTE.C5, NOTE.E5, NOTE.G5], // C major
    [NOTE.D5, NOTE.Fs5, NOTE.A5], // D major
    [NOTE.E5, NOTE.Gs5, NOTE.B5], // E major
  ];

  const chordDuration = 0.3;
  const now = ac.currentTime;
  const harmonicGains: GainNode[] = [];

  chords.forEach((chord, ci) => {
    const start = now + ci * chordDuration;
    chord.forEach((freq) => {
      // Sine layer
      playNote(ac, gain, freq, "sine", start, chordDuration * 0.9);
      // Triangle layer (quieter harmonic richness)
      const hGain = ac.createGain();
      hGain.gain.value = 0.5;
      hGain.connect(gain);
      playNote(ac, hGain, freq, "triangle", start, chordDuration * 0.9);
      harmonicGains.push(hGain);
    });
  });

  // Single batch cleanup after all chords finish
  const totalMs = chords.length * chordDuration * 1000 + 100;
  setTimeout(() => {
    harmonicGains.forEach((g) => g.disconnect());
    gain.disconnect();
  }, totalMs);
}

// ---------------------------------------------------------------------------
// Coin SFX — metallic ping with harmonic
// ---------------------------------------------------------------------------
function playCoinSound(): void {
  const ac = getCtx();
  const now = ac.currentTime;
  const duration = 0.15;

  // Primary ping at 2000 Hz
  const g1 = ac.createGain();
  g1.gain.setValueAtTime(0.18, now);
  g1.gain.exponentialRampToValueAtTime(0.001, now + duration);
  g1.connect(ac.destination);
  playNote(ac, g1, 2000, "sine", now, duration);

  // Quieter harmonic at 4000 Hz
  const g2 = ac.createGain();
  g2.gain.setValueAtTime(0.08, now);
  g2.gain.exponentialRampToValueAtTime(0.001, now + duration);
  g2.connect(ac.destination);
  playNote(ac, g2, 4000, "sine", now, duration);

  setTimeout(() => {
    g1.disconnect();
    g2.disconnect();
  }, 250);
}

// ---------------------------------------------------------------------------
// Composable export
// ---------------------------------------------------------------------------
export function useAudio() {
  return {
    toggleBGM,
    isBGMPlaying,
    bgmVolume,
    setBGMVolume,
    playOpenSound,
    playCelebrationSound,
    playCoinSound,
  };
}
