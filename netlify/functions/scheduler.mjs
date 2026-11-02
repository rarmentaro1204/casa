import { getSchedules, runScene } from './lib/core.mjs';
import { applyHeating, romeNow } from './lib/heating.mjs';

// Ogni minuto: 1) applica l'orario riscaldamento della modalità attiva, 2) lancia le scene programmate.
export default async () => {
  await applyHeating().catch((e) => console.error('heating', e.message));
  const { hhmm, day } = romeNow();
  for (const s of await getSchedules()) {
    if (s.enabled && s.time === hhmm && (!s.days?.length || s.days.includes(day))) await runScene(s.scene);
  }
};
export const config = { schedule: '* * * * *' };
