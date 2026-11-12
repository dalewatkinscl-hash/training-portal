import { Fragment, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { useI18n } from '../i18n/LanguageProvider';

const EMPLOYEE_PROFILE_URL = 'https://employee.countrylion.co.uk/dashboard/profile';

const OTHER_PORTALS = [
  { key: 'assessment_app', labelKey: 'portal.assessment', href: 'https://assessments.countrylion.co.uk' },
  { key: 'attendance_app', labelKey: 'portal.attendance', href: 'https://attendance.countrylion.co.uk' },
  { key: 'contracts_app', labelKey: 'portal.contracts', href: 'https://contracts.countrylion.co.uk' },
  { key: 'hr_app', labelKey: 'portal.headcount', href: 'https://headcount.countrylion.co.uk' },
  { key: 'hr_portal', labelKey: 'portal.hr', href: 'https://employee.countrylion.co.uk/dashboard/hr' },
  { key: 'mentoring_app', labelKey: 'portal.mentor', href: 'https://mentor.countrylion.co.uk' },
  { key: 'routes_app', labelKey: 'portal.routes', href: 'https://routes.countrylion.co.uk' },
  { key: 'cpc_app', labelKey: 'portal.cpc', href: 'https://cpc.countrylion.co.uk' },
  { key: 'holidays_app', labelKey: 'portal.holidays', href: 'https://holidays.countrylion.co.uk' },
  { key: 'events_app', labelKey: 'portal.events', href: 'https://events.countrylion.co.uk' },
  { key: 'tyre_app', labelKey: 'portal.tyres', href: 'https://tyres.countrylion.co.uk' },
  { key: 'cleaning_app', labelKey: 'portal.cleaning', href: 'https://cleaning.countrylion.co.uk' },
  { key: 'compliance_app', labelKey: 'portal.compliance', href: 'https://compliance.countrylion.co.uk' },
];

function canAccessHrPortal(access) {
  if (access.master_admin === 'admin') return true;
  const hrRole = access.hr_app;
  if (hrRole === 'manager' || hrRole === 'admin') return true;
  const casesRole = access.cases_app;
  return casesRole === 'manager' || casesRole === 'admin' || casesRole === 'hr';
}

function hasPortalAccess(access, key) {
  if (key === 'hr_portal') return canAccessHrPortal(access);
  const role = key === 'mentoring_app'
    ? access.mentoring_app || access.mentor
    : access[key];
  return typeof role === 'string' && role.trim().length > 0;
}

function menuPosition(button) {
  const rect = button.getBoundingClientRect();
  const width = Math.min(288, Math.max(220, window.innerWidth - 16));
  const maxLeft = window.innerWidth - width - 8;
  const left = Math.max(8, Math.min(rect.right - width, maxLeft));
  const spaceBelow = window.innerHeight - rect.bottom;
  const openUp = spaceBelow < 320 && rect.top > spaceBelow;
  return {
    top: openUp ? 'auto' : rect.bottom + 6,
    bottom: openUp ? window.innerHeight - rect.top + 6 : 'auto',
    left,
    width,
  };
}

export default function PortalMenu({ user }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();

  const links = useMemo(() => {
    const access = user?.portalsAccess || {};
    const portals = OTHER_PORTALS
      .filter((portal) => hasPortalAccess(access, portal.key))
      .map((portal) => ({ ...portal, label: t(portal.labelKey) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }));
    return [
      { key: 'profile', href: EMPLOYEE_PROFILE_URL, label: t('nav.myProfile') },
      ...portals,
    ];
  }, [t, user]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const placeMenu = () => {
      if (!buttonRef.current) return;
      setMenuStyle(menuPosition(buttonRef.current));
    };
    placeMenu();
    const onPointerDown = (event) => {
      if (buttonRef.current?.contains(event.target)) return;
      if (menuRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('resize', placeMenu);
    window.addEventListener('scroll', placeMenu, true);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', placeMenu);
      window.removeEventListener('scroll', placeMenu, true);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="language-menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{t('portals.menu')}</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && menuStyle && createPortal(
        <ul
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={t('portals.menu')}
          className="language-menu-list"
          style={menuStyle}
        >
          {links.map((link, index) => (
            <Fragment key={link.key}>
              {index === 1 ? <li className="portal-menu-divider" role="separator" /> : null}
              <li role="none">
                <a
                  role="menuitem"
                  className="language-menu-option no-underline"
                  href={link.href}
                >
                  {link.label}
                </a>
              </li>
            </Fragment>
          ))}
        </ul>,
        document.body,
      )}
    </>
  );
}
