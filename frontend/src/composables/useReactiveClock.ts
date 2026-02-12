import { ref, onUnmounted } from "vue";

/**
 * Reactive clock that ticks every second.
 * Pauses when the document is hidden, resumes + syncs on visibility restore.
 * Cleans up automatically on component unmount.
 */
export function useReactiveClock() {
  const now = ref(Date.now());
  let timer: ReturnType<typeof setInterval> | null = null;

  const start = () => {
    if (!timer) {
      timer = setInterval(() => {
        now.value = Date.now();
      }, 1000);
    }
  };

  const stop = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  const onVisibilityChange = () => {
    if (document.hidden) {
      stop();
    } else {
      now.value = Date.now();
      start();
    }
  };

  start();
  document.addEventListener("visibilitychange", onVisibilityChange);

  onUnmounted(() => {
    stop();
    document.removeEventListener("visibilitychange", onVisibilityChange);
  });

  return { now };
}
