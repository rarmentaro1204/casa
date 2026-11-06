import { getStore } from '@netlify/blobs';
import { config, command } from './core.mjs';

const store = () => getStore('casa');
const RETRY_MS = 90e3;

export function romeNow(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' }).formatToParts(d).map((x) => [x.type, x.value]));
  const hhmm = `${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
  const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday) + 1; // 1=lun … 7=dom
  return { hhmm, day };
}

// Stato desiderato di ogni valvola.
// policy 'app': gli orari li fa questa app. policy 'meross': in inverno le valvole restano in "programma"
// e seguono gli orari impostati nell'app Meross (l'app non li tocca).
// boost ("Scalda ora"): finché non scade, le valvole indicate vanno alla sua temperatura, poi tornano allo scenario.
export function desired(mode, now = romeNow(), policy = 'app', boost = null, at = Date.now()) {
  const h = config.heating, out = {};
  if (mode) {
    for (const id of h.always) out[id] = { on: true, target: 'max' };
    if (mode === 'inverno' && policy === 'meross') {
      for (const id of [...h.group, ...h.base.devices]) out[id] = { on: true, mode: 'auto' };
    } else {
      const slots = now.day <= 5 ? h.winter.weekdays : h.winter.weekend;
      const inSlot = mode === 'inverno' && slots.some(([a, b]) => now.hhmm >= a && now.hhmm < b);
      for (const id of h.base.devices) out[id] = h.base.offIn.includes(mode) ? { on: false } : { on: true, target: h.base.temp };
      const away = mode === 'fuori';
      for (const id of h.group) out[id] = away ? { on: true, target: h.away.temp } : inSlot ? { on: true, target: h.temp } : { on: false };
    }
  }
  if (boost && boost.until > at) for (const id of boost.ids) out[id] = { on: true, target: boost.temp };
  return out;
}

// Prossimo cambio di stato (orari dell'app o fine di "Scalda ora"), entro 48 ore.
export function nextChange(mode, policy = 'app', from = new Date(), boost = null) {
  const boosting = boost && boost.until > from.getTime();
  if (!boosting && !(mode === 'inverno' && policy === 'app')) return null;
  const sig = (d) => JSON.stringify(desired(mode, romeNow(d), policy, boost, d.getTime()));
  const start = sig(from);
  for (let i = 1; i <= 2880; i++) {
    const d = new Date(from.getTime() + i * 60e3);
    if (sig(d) !== start) { const r = romeNow(d); return { at: r.hhmm, day: r.day, inMin: i }; }
  }
  return null;
}

export const getMode = async () => (await store().get('mode', { type: 'json' }))?.id || null;
export const getPolicy = async () => (await store().get('policy', { type: 'json' }))?.id || config.heating.defaultPolicy || 'app';
export async function getBoost() {
  const b = await store().get('boost', { type: 'json' });
  return b && b.until > Date.now() ? b : null;
}

// Manda comandi solo quando qualcosa cambia (le pile delle valvole si consumano a ogni comando).
// Le valvole vanno una alla volta; se il tempo a disposizione finisce, le rimaste le completa lo scheduler entro un minuto.
export async function applyHeating({ force = false, budget = 25000 } = {}) {
  const [mode, policy, boost] = await Promise.all([getMode(), getPolicy(), getBoost()]);
  if (!mode && !boost) return [];
  const want = desired(mode, romeNow(), policy, boost), applied = (await store().get('applied', { type: 'json' })) || {};
  const todo = Object.entries(want).filter(([id, cmd]) => {
    const a = applied[id], w = JSON.stringify(cmd);
    return force || !a || a.want !== w || (!a.ok && Date.now() - a.at > RETRY_MS);
  });
  const out = [], deadline = Date.now() + budget;
  for (const [id, cmd] of todo) {
    if (Date.now() > deadline) { delete applied[id]; out.push({ device: id, ok: null }); continue; }
    try { await command(id, cmd); applied[id] = { want: JSON.stringify(cmd), ok: true, at: Date.now() }; out.push({ device: id, ok: true }); }
    catch (e) { applied[id] = { want: JSON.stringify(cmd), ok: false, at: Date.now(), error: e.message }; out.push({ device: id, ok: false, error: e.message }); }
  }
  await store().setJSON('applied', applied);
  return out;
}

export async function setMode(id) {
  if (!config.modes.some((m) => m.id === id)) throw new Error('Scenario sconosciuto');
  await store().setJSON('mode', { id, at: Date.now() });
  return applyHeating({ force: true, budget: 7000 });
}

export async function setPolicy(id) {
  if (!['app', 'meross'].includes(id)) throw new Error('Opzione sconosciuta');
  await store().setJSON('policy', { id });
  return applyHeating({ force: true, budget: 7000 });
}

// "Scalda ora": ids = 'zona' (zona giorno) oppure elenco di valvole. Durata 15–240 minuti.
export async function setBoost({ ids = 'zona', minutes = 60, temp } = {}) {
  const h = config.heating, valves = config.devices.filter((d) => d.type === 'thermostat').map((d) => d.id);
  const list = ids === 'zona' ? h.group : (Array.isArray(ids) ? ids : []).filter((x) => valves.includes(x));
  if (!list.length) throw new Error('Nessuna valvola da scaldare');
  const m = Math.min(240, Math.max(15, Math.round(+minutes || 60)));
  const t = Math.min(30, Math.max(5, +temp || h.temp));
  await store().setJSON('boost', { ids: list, temp: t, until: Date.now() + m * 60e3, minutes: m });
  return applyHeating({ budget: 7000 });
}
export async function cancelBoost() {
  await store().delete('boost');
  return applyHeating({ budget: 7000 });
}

const describe = (c) => (c.mode === 'auto' ? 'programma Meross' : !c.on ? 'spenta' : c.target === 'max' ? 'massimo' : `${c.target}°`);

// Cosa dovrebbero fare adesso le valvole e com'è andata l'ultima applicazione.
export async function status() {
  const [mode, policy, boost] = await Promise.all([getMode(), getPolicy(), getBoost()]);
  if (!mode && !boost) return { mode: null, policy, boost: null, devices: [], next: null };
  const applied = (await store().get('applied', { type: 'json' })) || {};
  const devices = Object.entries(desired(mode, romeNow(), policy, boost)).map(([id, c]) => {
    const d = config.devices.find((x) => x.id === id), a = applied[id];
    return { id, name: d?.subName || id, want: describe(c), ok: a ? a.ok : null, error: a?.error, at: a?.at, boost: !!boost?.ids.includes(id) };
  });
  return { mode, policy, boost, devices, next: nextChange(mode, policy, new Date(), boost) };
}
