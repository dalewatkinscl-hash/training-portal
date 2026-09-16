const FLAG_CLASS = 'language-flag';

export function FlagUk({ className = FLAG_CLASS }) {
  return (
    <svg viewBox="0 0 60 40" className={className} aria-hidden="true">
      <rect width="60" height="40" fill="#012169" />
      <path d="M0 0 L60 40 M60 0 L0 40" stroke="#fff" strokeWidth="8" />
      <path d="M0 0 L60 40 M60 0 L0 40" stroke="#C8102E" strokeWidth="5" />
      <path d="M30 0 V40 M0 20 H60" stroke="#fff" strokeWidth="13" />
      <path d="M30 0 V40 M0 20 H60" stroke="#C8102E" strokeWidth="8" />
    </svg>
  );
}

export function FlagRo({ className = FLAG_CLASS }) {
  return (
    <svg viewBox="0 0 60 40" className={className} aria-hidden="true">
      <rect width="20" height="40" fill="#002B7F" />
      <rect x="20" width="20" height="40" fill="#FCD116" />
      <rect x="40" width="20" height="40" fill="#CE1126" />
    </svg>
  );
}

export function FlagPl({ className = FLAG_CLASS }) {
  return (
    <svg viewBox="0 0 60 40" className={className} aria-hidden="true">
      <rect width="60" height="20" fill="#fff" />
      <rect y="20" width="60" height="20" fill="#DC143C" />
    </svg>
  );
}

export function FlagHu({ className = FLAG_CLASS }) {
  return (
    <svg viewBox="0 0 60 40" className={className} aria-hidden="true">
      <rect width="60" height="13.34" fill="#CE2939" />
      <rect y="13.34" width="60" height="13.32" fill="#fff" />
      <rect y="26.66" width="60" height="13.34" fill="#477050" />
    </svg>
  );
}

export function FlagAl({ className = FLAG_CLASS }) {
  return (
    <svg viewBox="0 0 60 40" className={className} aria-hidden="true">
      <rect width="60" height="40" fill="#E41E20" />
      <g fill="#111" transform="translate(30 21) scale(0.92)">
        <path d="M0-11.2c1.1 1.6 2.4 2.6 3.8 2.2 1.2 1.8 2.8 2.8 4.6 2.2-.2 2.2-1.6 3.8-3.6 4.6 1.6 1.2 2.2 2.8 1.4 4.6-1.8-0.6-3.2-0.2-4.4 1.2C1 2.2.4 1.2 0 0c-.4 1.2-1 2.2-1.8 3.6-1.2-1.4-2.6-1.8-4.4-1.2-.8-1.8-.2-3.4 1.4-4.6-2-.8-3.4-2.4-3.6-4.6 1.8.6 3.4-.4 4.6-2.2 1.4.4 2.7-.6 3.8-2.2z" />
        <path d="M-8.4-2.4c-2.2.6-4.6 0-6.6-1.8 1.8 3.2 1.6 5.8-.2 8.2 2.6-.4 4.6.4 6.2 2.4-.4-2.6.4-4.8 2.4-6.4-1.2-.4-1.8-1.4-1.8-2.4zM8.4-2.4c2.2.6 4.6 0 6.6-1.8-1.8 3.2-1.6 5.8.2 8.2-2.6-.4-4.6.4-6.2 2.4.4-2.6-.4-4.8-2.4-6.4 1.2-.4 1.8-1.4 1.8-2.4z" />
        <path d="M-2.2 5.2c-1.6 2.2-1.8 4.6-.4 7.2 1.2-1.6 2.2-3.6 2.6-6.2.4 2.6 1.4 4.6 2.6 6.2 1.4-2.6 1.2-5-.4-7.2C1.2 6.4.6 7.2 0 8c-.6-.8-1.2-1.6-2.2-2.8z" />
      </g>
    </svg>
  );
}

const FLAGS = {
  uk: FlagUk,
  ro: FlagRo,
  pl: FlagPl,
  hu: FlagHu,
  sq: FlagAl,
};

export default function FlagIcon({ code, className = FLAG_CLASS }) {
  const Icon = FLAGS[code];
  if (!Icon) return null;
  return <Icon className={className} />;
}
