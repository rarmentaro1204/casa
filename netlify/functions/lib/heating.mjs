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

// Stato desiderato di ogni valvola.
// policy 'app': gli orari li fa questa app. policy 'meross': in inverno le valvole restano in "programma"
// e seguono gli orari impostati nell'app Meross (l'app non li tocca).
export function desired(mode, now = romeNow(), policy = 'app') {
  const h = config.heating, out = {};
  for (const id of h.always) out[id] = { on: true, target: 'max' };
  if (mode === 'inverno' && policy === 'meross') {
    for (const id of [...h.group, ...h.base.devices]) out[id] = { on: true, mode: 'auto' };
    return out;
  }
  const slots = now.day <= 5 ? h.winter.weekdays : h.winter.weekend;
  const inSlot = mode === 'inverno' && slots.some(([a, b]) => now.hhmm >= a && now.hhmm < b);
  for (const id of h.base.devices) out[id] = h.base.offIn.includes(mode) ? { on: false } : { on: true, target: h.base.temp };
  const away = mode === 'fuori';
  for (const id of h.group) out[id] = away ? { on: true, target: h.away.temp } : inSlot ? { on: true, target: h.temp } : { on: false };
  return out;
}

// Prossimo cambio di stato (solo gli orari dell'app), entro 48 ore.
export function nextChange(mode, policy = 'app', from = new Date()) {
  if (mode !== 'inverno' || policy !== 'app') return null;
  const sig = (d) => JSON.stringify(desired(mode, romeNow(d), policy));
  const start = sig(from);
  for (let i = 1; i <= 2880; i++) {
    const d = new Date(from.getTime() + i * 60e3);
    if (sig(d) !== start) { const r = romeNow(d); return { at: r.hhmm, day: r.day, inMin: i }; }
  }
  return null;
}

export const getMode = async () => (await store().get('mode', { type: 'json' }))?.id || null;
export const getPolicy = async () => (await store().get('policy', { type: 'json' }))?.id || config.heating.defaultPolicy || 'app';

// Manda comandi solo quando qualcosa cambia (le pile delle valvole si consumano a ogni comando).
export async function applyHeating({ force = false } = {}) {
  const mode = await getMode();
  if (!mode) return [];
  const want = desired(mode, romeNow(), await getPolicy()), applied = (await store().get('applied', { type: 'json' })) || {};
  const todo = Object.entries(want).filter(([id, cmd]) => {
    const a = applied[id], w = JSON.stringify(cmd);
    return force || !a || a.want !== w || (!a.ok && Date.now() - a.at > RETRY_MS);
  });
  const res = await Promise.allSettled(todo.map(([id, cmd]) => command(id, cmd)));
  todo.forEach(([id, cmd], i) => { applied[id] = { want: JSON.stringify(cmd), ok: res[i].status === 'fulfilled', at: Date.now(), error: res[i].reason?.message }; });
  await store().setJSON('applied', applied);
  return todo.map(([id], i) => ({ device: id, ok: res[i].status === 'fulfilled', error: res[i].reason?.message }));
}

export async function setMode(id) {
  if (!config.modes.some((m) => m.id === id)) throw new Error('Scenario sconosciuto');
  await store().setJSON('mode', { id, at: Date.now() });
  return applyHeating({ force: true });
}

export async function setPolicy(id) {
  if (!['app', 'meross'].includes(id)) throw new Error('Opzione sconosciuta');
  await store().setJSON('policy', { id });
  return applyHeating({ force: true });
}

const describe = (c) => (c.mode === 'auto' ? 'programma Meross' : !c.on ? 'spenta' : c.target === 'max' ? 'massimo' : `${c.target}°`);

// Cosa dovrebbero fare adesso le valvole e com'è andata l'ultima applicazione.
export async function status() {
  const mode = await getMode(), policy = await getPolicy();
  if (!mode) return { mode: null, policy, devices: [], next: null };
  const applied = (await store().get('applied', { type: 'json' })) || {};
  const devices = Object.entries(desired(mode, romeNow(), policy)).map(([id, c]) => {
    const d = config.devices.find((x) => x.id === id), a = applied[id];
    return { id, name: d?.subName || id, want: describe(c), ok: a ? a.ok : null, error: a?.error, at: a?.at };
  });
  return { mode, policy, devices, next: nextChange(mode, policy) };
}
