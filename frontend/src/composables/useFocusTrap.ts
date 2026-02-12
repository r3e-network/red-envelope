import { onMounted, onUnmounted, type Ref } from "vue";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(containerRef: Ref<HTMLElement | null>) {
  let previouslyFocused: HTMLElement | null = null;

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const container = containerRef.value;
    if (!container) return;

    const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  onMounted(() => {
    previouslyFocused = document.activeElement as HTMLElement | null;
    document.addEventListener("keydown", handleKeydown);
    // Auto-focus first focusable element
    const container = containerRef.value;
    if (container) {
      const first = container.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    }
  });

  onUnmounted(() => {
    document.removeEventListener("keydown", handleKeydown);
    previouslyFocused?.focus();
  });
}
