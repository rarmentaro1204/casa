import { getSchedules, runScene } from './lib/core.mjs';

// Ogni minuto controlla gli orari salvati (fuso Europe/Rome) e lancia le scene.
export default async () => {
  const now = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' }).formatToParts(new Date());
  const get = (t) => now.find((p) => p.type === t).value;
  const hhmm = `${get('hour')}:${get('minute')}`;
  const day = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'].indexOf(get('weekday').toLowerCase().slice(0, 3)) + 1;
  for (const s of await getSchedules()) {
    if (s.enabled && s.time === hhmm && (!s.days?.length || s.days.includes(day))) await runScene(s.scene);
  }
};
export const config = { schedule: '* * * * *' };
