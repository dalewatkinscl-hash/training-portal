import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_LANGUAGE, getLanguage, isLanguageId, LANGUAGE_STORAGE_KEY } from './languages';
import { translate } from './translations';

const LanguageContext = createContext(null);

function readStoredLanguage() {
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (isLanguageId(stored)) return stored;
  } catch {
    // ignore
  }
  return DEFAULT_LANGUAGE;
}

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(readStoredLanguage);

  useEffect(() => {
    const meta = getLanguage(language);
    document.documentElement.lang = meta.htmlLang;
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // ignore
    }
  }, [language]);

  const setLanguage = useCallback((next) => {
    if (isLanguageId(next)) setLanguageState(next);
  }, []);

  const t = useCallback((key, vars) => translate(language, key, vars), [language]);

  const locale = getLanguage(language).locale;

  const formatDate = useCallback((value) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString(locale, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }, [locale]);

  const formatStatus = useCallback((status) => {
    if (status === 'completed' || status === 'valid') return t('status.valid');
    if (status === 'expiring_soon' || status === 'expiring') return t('status.expiringSoon');
    if (status === 'expired') return t('status.expired');
    if (status === 'assigned') return t('status.required');
    if (status === 'failed') return t('status.failed');
    return status || '—';
  }, [t]);

  const formatSource = useCallback((source) => {
    if (!source) return '—';
    const key = `source.${String(source).toLowerCase()}`;
    const translated = t(key);
    return translated === key ? source : translated;
  }, [t]);

  const formatCourseType = useCallback((type) => {
    if (!type) return '—';
    const key = `courseType.${String(type).toLowerCase()}`;
    const translated = t(key);
    return translated === key ? type : translated;
  }, [t]);

  const value = useMemo(
    () => ({
      language,
      locale,
      setLanguage,
      t,
      formatDate,
      formatStatus,
      formatSource,
      formatCourseType,
    }),
    [language, locale, setLanguage, t, formatDate, formatStatus, formatSource, formatCourseType],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useI18n must be used within LanguageProvider');
  }
  return context;
}
