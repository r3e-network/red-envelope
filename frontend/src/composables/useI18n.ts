import { ref, computed } from "vue";
import { messages, type MessageKey } from "@/locale/messages";

type Lang = "en" | "zh";

const lang = ref<Lang>("en");

export function useI18n() {
  const t = (key: MessageKey, ...args: (string | number)[]): string => {
    const entry = messages[key];
    if (!entry) return key;
    let text = entry[lang.value] || entry.en || key;
    args.forEach((arg, i) => {
      text = text.replace(`{${i}}`, String(arg));
    });
    return text;
  };

  const setLang = (l: Lang) => {
    lang.value = l;
  };

  const currentLang = computed(() => lang.value);

  return { t, lang: currentLang, setLang };
}
