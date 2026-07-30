export const PORTAL_KEY = 'training_app';
export const EMPLOYEE_HOME_URL = 'https://employee.countrylion.co.uk';
export const EMPLOYEE_LOGIN_URL = 'https://employee.countrylion.co.uk/login';

export function getRole(user) {
  return user?.portalsAccess?.[PORTAL_KEY] || '';
}

export function canTrain(role) {
  return ['manager', 'trainer', 'admin'].includes(role);
}

export function canAdmin(role) {
  return role === 'admin';
}

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatStatus(status) {
  if (status === 'expiring_soon') return 'Expiring soon';
  if (status === 'completed') return 'Valid';
  if (status === 'expired') return 'Expired';
  if (status === 'assigned') return 'Required';
  if (status === 'failed') return 'Failed';
  return status || '—';
}

export function statusTone(status) {
  if (status === 'completed') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
  if (status === 'expiring_soon') return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
  if (status === 'expired') return 'border-rose-500/40 bg-rose-500/10 text-rose-300';
  if (status === 'assigned') return 'border-sky-500/40 bg-sky-500/10 text-sky-200';
  if (status === 'failed') return 'border-red-600/50 bg-red-600/15 text-red-400';
  return 'border-cl-border bg-white/5 text-cl-muted';
}
