import i18next from 'i18next';
import { b64Decode } from './utils';
import en from './locales/en.json';
import fr from './locales/fr.json';

// Interface strings for the exercise editor, translated with i18next.
// English is the reference; add a language by copying locales/en.json,
// translating every value, and registering the file here.
export const resources = {
  en: { translation: en },
  fr: { translation: fr },
};

export type TranslationKey = keyof typeof en;

// The document language is Quarto's `lang` YAML key, which Pandoc writes to
// the <html lang="..."> attribute. i18next resolves a regional tag such as
// "fr-CA" to "fr" before falling back to English.
function documentLanguage(): string {
  return document.documentElement.lang || 'en';
}

// Per-document overrides from the `live: translations:` YAML key, which
// live.lua emits as a base64 JSON <script> block.
function documentTranslations(): Partial<Record<TranslationKey, string>> {
  const script = document.querySelector('script[type="live-translations"]');
  if (!script) {
    return {};
  }
  try {
    return JSON.parse(b64Decode(script.textContent.trim()));
  } catch (error) {
    console.warn('quarto-live: ignoring invalid `live: translations:` block.', error);
    return {};
  }
}

const i18n = i18next.createInstance();

// Synchronous init: the resources are bundled, nothing is fetched, so t()
// is usable as soon as this module has been evaluated.
i18n.init({
  lng: documentLanguage(),
  fallbackLng: 'en',
  resources,
  initAsync: false,
  interpolation: { escapeValue: false },
});

const overrides = documentTranslations();
if (Object.keys(overrides).length > 0) {
  i18n.addResourceBundle(i18n.language, 'translation', overrides, true, true);
}

export function t(key: TranslationKey): string {
  return i18n.t(key);
}

export { i18n };
