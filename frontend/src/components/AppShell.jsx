import { NavLink } from 'react-router-dom';
import { Home, LogOut } from 'lucide-react';
import AmbientBackground from './AmbientBackground';
import DigitalClock from './DigitalClock';
import LanguageMenu from './LanguageMenu';
import { useI18n } from '../i18n/LanguageProvider';
import { EMPLOYEE_HOME_URL, canAdmin, canTrain } from '../lib/training';

const linkClass = ({ isActive }) =>
  `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
    isActive
      ? 'bg-cl-accent/20 text-[#c7cbf5] border border-cl-accent/40'
      : 'text-cl-muted hover:text-cl-fg hover:bg-white/[0.04] border border-transparent'
  }`;

export default function AppShell({ portalUser, role, onLogout, children }) {
  const trainer = canTrain(role);
  const admin = canAdmin(role);
  const { t } = useI18n();
  const roleKey = `role.${role || 'employee'}`;
  const roleLabel = t(roleKey) === roleKey ? (role || 'employee') : t(roleKey);

  return (
    <div className="min-h-screen relative">
      <AmbientBackground />
      <header className="cl-header">
        <div className="max-w-7xl mx-auto px-4 py-3 grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-cl-accent">{t('shell.brand')}</p>
            <h1 className="text-lg font-semibold text-cl-fg leading-tight">{t('shell.title')}</h1>
            <p className="text-xs text-cl-muted">
              {portalUser?.fullName || portalUser?.email} · {roleLabel}
            </p>
          </div>
          <DigitalClock />
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <LanguageMenu />
            <a
              href={EMPLOYEE_HOME_URL}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-cl-border text-sm text-cl-fg hover:bg-white/[0.04]"
            >
              <Home className="w-4 h-4" />
              {t('shell.home')}
            </a>
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-cl-border text-sm text-cl-muted hover:text-cl-fg hover:bg-white/[0.04]"
            >
              <LogOut className="w-4 h-4" />
              {t('shell.logout')}
            </button>
          </div>
        </div>
        <nav className="max-w-7xl mx-auto px-4 pb-3 flex gap-2 flex-wrap">
          <NavLink to="/" end className={linkClass}>
            {t('nav.myRecords')}
          </NavLink>
          {trainer && (
            <>
              <NavLink to="/dashboard" className={linkClass}>
                {t('nav.dashboard')}
              </NavLink>
              <NavLink to="/employees" className={linkClass}>
                {t('nav.employees')}
              </NavLink>
              <NavLink to="/matrix" className={linkClass}>
                {t('nav.matrix')}
              </NavLink>
              <NavLink to="/courses" className={linkClass}>
                {t('nav.catalogue')}
              </NavLink>
              <NavLink to="/log" className={linkClass}>
                {t('nav.addCourse')}
              </NavLink>
              <NavLink to="/required" className={linkClass}>
                {t('nav.required')}
              </NavLink>
              <NavLink to="/reports" className={linkClass}>
                {t('nav.reports')}
              </NavLink>
            </>
          )}
          {admin && (
            <>
              <NavLink to="/admin/amend" className={linkClass}>
                {t('nav.amendRecords')}
              </NavLink>
              <NavLink to="/admin" className={linkClass}>
                {t('nav.admin')}
              </NavLink>
            </>
          )}
        </nav>
      </header>
      <main className="relative z-10 max-w-[1600px] mx-auto px-4 py-6 animate-fade-in">{children}</main>
    </div>
  );
}
