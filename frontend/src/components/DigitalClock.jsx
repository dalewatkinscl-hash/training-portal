import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/LanguageProvider';

function pad(value) {
  return String(value).padStart(2, '0');
}

export default function DigitalClock() {
  const { locale, t } = useI18n();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const hours = pad(now.getHours());
  const minutes = pad(now.getMinutes());
  const seconds = pad(now.getSeconds());
  const dateLabel = now.toLocaleDateString(locale, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const timeLabel = `${hours}:${minutes}:${seconds}`;

  return (
    <time
      dateTime={now.toISOString()}
      className="digital-clock"
      aria-label={t('clock.aria', { time: timeLabel, date: dateLabel })}
    >
      <span className="digital-clock-time" aria-hidden="true">
        {hours}
        <span className="digital-clock-sep">:</span>
        {minutes}
        <span className="digital-clock-sep">:</span>
        {seconds}
      </span>
      <span className="digital-clock-date">{dateLabel}</span>
    </time>
  );
}
