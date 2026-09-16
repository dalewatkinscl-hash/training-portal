import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import FlagIcon from './FlagIcon';
import { getLanguage, LANGUAGES } from '../i18n/languages';
import { useI18n } from '../i18n/LanguageProvider';

const MENU_MIN_WIDTH = 200;
const VIEWPORT_PAD = 16;

function menuPosition(button) {
  const rect = button.getBoundingClientRect();
  const available = Math.max(160, window.innerWidth - VIEWPORT_PAD * 2);
  const width = Math.min(Math.max(MENU_MIN_WIDTH, rect.width), available);
  let left = rect.left;
  if (left + width > window.innerWidth - VIEWPORT_PAD) {
    left = rect.right - width;
  }
  if (left < VIEWPORT_PAD) left = VIEWPORT_PAD;
  if (left + width > window.innerWidth - VIEWPORT_PAD) {
    left = Math.max(VIEWPORT_PAD, window.innerWidth - VIEWPORT_PAD - width);
  }

  const estimatedHeight = LANGUAGES.length * 44 + 12;
  const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_PAD;
  const openUp = spaceBelow < estimatedHeight && rect.top > spaceBelow;
  const top = openUp
    ? Math.max(VIEWPORT_PAD, rect.top - estimatedHeight - 8)
    : rect.bottom + 8;

  return { top, left, width };
}

export default function LanguageMenu() {
  const { language, setLanguage, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const current = getLanguage(language);

  const updatePosition = () => {
    if (!buttonRef.current) return;
    setCoords(menuPosition(buttonRef.current));
  };

  useLayoutEffect(() => {
    if (!open) return undefined;
    updatePosition();
    const onReposition = () => updatePosition();
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event) => {
      const target = event.target;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="language-menu-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('language.label')}
        onClick={() => setOpen((prev) => !prev)}
      >
        <FlagIcon code={current.id} />
        <span>{current.label}</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && coords && createPortal(
        <ul
          ref={menuRef}
          className="language-menu-list"
          role="listbox"
          aria-label={t('language.label')}
          style={{ top: coords.top, left: coords.left, width: coords.width }}
        >
          {LANGUAGES.map((item) => {
            const selected = language === item.id;
            return (
              <li key={item.id} role="none">
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`language-menu-option${selected ? ' is-active' : ''}`}
                  onClick={() => {
                    setLanguage(item.id);
                    setOpen(false);
                  }}
                >
                  <FlagIcon code={item.id} />
                  <span>{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>,
        document.body,
      )}
    </>
  );
}
