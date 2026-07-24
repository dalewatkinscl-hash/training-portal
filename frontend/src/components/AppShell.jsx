import { NavLink } from 'react-router-dom';
import { Home, LogOut } from 'lucide-react';
import AmbientBackground from './AmbientBackground';
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

  return (
    <div className="min-h-screen relative">
      <AmbientBackground />
      <header className="cl-header">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-cl-accent">Country Lion</p>
            <h1 className="text-lg font-semibold text-cl-fg leading-tight">Training</h1>
            <p className="text-xs text-cl-muted">
              {portalUser?.fullName || portalUser?.email} · {role || 'employee'}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <a
              href={EMPLOYEE_HOME_URL}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-cl-border text-sm text-cl-fg hover:bg-white/[0.04]"
            >
              <Home className="w-4 h-4" />
              Home
            </a>
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-cl-border text-sm text-cl-muted hover:text-cl-fg hover:bg-white/[0.04]"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
          </div>
        </div>
        <nav className="max-w-7xl mx-auto px-4 pb-3 flex gap-2 flex-wrap">
          <NavLink to="/" end className={linkClass}>
            My records
          </NavLink>
          {trainer && (
            <>
              <NavLink to="/dashboard" className={linkClass}>
                Dashboard
              </NavLink>
              <NavLink to="/employees" className={linkClass}>
                Employees
              </NavLink>
              <NavLink to="/matrix" className={linkClass}>
                Matrix
              </NavLink>
              <NavLink to="/courses" className={linkClass}>
                Courses
              </NavLink>
              <NavLink to="/log" className={linkClass}>
                Log completion
              </NavLink>
              <NavLink to="/required" className={linkClass}>
                Required
              </NavLink>
            </>
          )}
          {admin && (
            <>
              <NavLink to="/admin/amend" className={linkClass}>
                Amend dates
              </NavLink>
              <NavLink to="/admin" className={linkClass}>
                Admin
              </NavLink>
            </>
          )}
        </nav>
      </header>
      <main className="relative z-10 max-w-[1600px] mx-auto px-4 py-6 animate-fade-in">{children}</main>
    </div>
  );
}
