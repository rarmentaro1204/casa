import { getSchedules, runScene, runActions } from './lib/core.mjs';

// Ogni minuto controlla gli orari salvati (fuso Europe/Rome). Un orario può lanciare una scena
// oppure comandi diretti ai dispositivi, con un'ora di fine opzionale (es. clima acceso 7:00-8:00).
export default async () => {
  const now = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' }).formatToParts(new Date());
  const get = (t) => now.find((p) => p.type === t).value;
  const hhmm = `${get('hour')}:${get('minute')}`;
  const day = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'].indexOf(get('weekday').toLowerCase().slice(0, 3)) + 1;
  for (const s of await getSchedules()) {
    if (!s.enabled || (s.days?.length && !s.days.includes(day))) continue;
    if (s.time === hhmm) await (s.actions ? runActions(s.actions) : runScene(s.scene));
    if (s.end === hhmm && s.endActions) await runActions(s.endActions);
  }
};
export const config = { schedule: '* * * * *' };
