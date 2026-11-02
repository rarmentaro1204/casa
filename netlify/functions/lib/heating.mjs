import { getStore } from '@netlify/blobs';
import { config, command } from './core.mjs';

const store = () => getStore('casa');
const RETRY_MS = 5 * 60e3;

export function romeNow(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' }).formatToParts(d).map((x) => [x.type, x.value]));
  const hhmm = `${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
  const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday) + 1; // 1=lun … 7=dom
  return { hhmm, day };
}

// Stato desiderato di ogni valvola per la modalità corrente.
export function desired(mode, now = romeNow()) {
  const h = config.heating, out = {};
  const slots = now.day <= 5 ? h.winter.weekdays : h.winter.weekend;
  const inSlot = mode === 'inverno' && slots.some(([a, b]) => now.hhmm >= a && now.hhmm < b);
  for (const id of h.always) out[id] = { on: true, target: 'max' };
  for (const id of h.base.devices) out[id] = h.base.offIn.includes(mode) ? { on: false } : { on: true, target: h.base.temp };
  const away = mode === 'fuori';
  for (const id of h.group) out[id] = away ? { on: true, target: h.away.temp } : inSlot ? { on: true, target: h.temp } : { on: false };
  return out;
}

export const getMode = async () => (await store().get('mode', { type: 'json' }))?.id || null;

// Manda comandi solo quando qualcosa cambia (le pile delle valvole si consumano a ogni comando).
export async function applyHeating({ force = false } = {}) {
  const mode = await getMode();
  if (!mode) return [];
  const want = desired(mode), applied = (await store().get('applied', { type: 'json' })) || {};
  const todo = Object.entries(want).filter(([id, cmd]) => {
    const a = applied[id], w = JSON.stringify(cmd);
    return force || !a || a.want !== w || (!a.ok && Date.now() - a.at > RETRY_MS);
  });
  const res = await Promise.allSettled(todo.map(([id, cmd]) => command(id, cmd)));
  todo.forEach(([id, cmd], i) => { applied[id] = { want: JSON.stringify(cmd), ok: res[i].status === 'fulfilled', at: Date.now() }; });
  await store().setJSON('applied', applied);
  return todo.map(([id], i) => ({ device: id, ok: res[i].status === 'fulfilled', error: res[i].reason?.message }));
}

export async function setMode(id) {
  if (!config.modes.some((m) => m.id === id)) throw new Error('Scenario sconosciuto');
  await store().setJSON('mode', { id, at: Date.now() });
  return applyHeating({ force: true });
}
