export const LANGUAGE_STORAGE_KEY = 'cl-training-language';

export const LANGUAGES = [
  { id: 'sq', label: 'Albanian', locale: 'sq-AL', htmlLang: 'sq' },
  { id: 'hu', label: 'Hungarian', locale: 'hu-HU', htmlLang: 'hu' },
  { id: 'pl', label: 'Polish', locale: 'pl-PL', htmlLang: 'pl' },
  { id: 'ro', label: 'Romanian', locale: 'ro-RO', htmlLang: 'ro' },
  { id: 'uk', label: 'UK', locale: 'en-GB', htmlLang: 'en-GB' },
];

export const DEFAULT_LANGUAGE = 'uk';

const LANGUAGE_IDS = new Set(LANGUAGES.map((lang) => lang.id));

export function isLanguageId(value) {
  return LANGUAGE_IDS.has(value);
}

export function getLanguage(id) {
  return LANGUAGES.find((lang) => lang.id === id)
    || LANGUAGES.find((lang) => lang.id === DEFAULT_LANGUAGE)
    || LANGUAGES[0];
}
