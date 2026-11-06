// Collegamenti per Siri / Comandi rapidi e automazioni dell'iPhone (es. "quando esco di casa").
// Protetti da un token segreto generato dall'app; non aprono MAI porta o portone.
import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { config, command, runScene } from './core.mjs';
import { setMode, setBoost } from './heating.mjs';

const store = () => getStore('casa');

export async function hookToken(rotate = false) {
  let t = rotate ? null : await store().get('hookToken');
  if (!t) { t = crypto.randomBytes(18).toString('base64url'); await store().set('hookToken', t); }
  return t;
}

const byType = (type) => config.devices.filter((d) => d.type === type);
const failures = (r) => (r || []).filter((x) => x.ok === false).length;
const tail = (n) => (n ? ` Attenzione: ${n} ${n === 1 ? 'dispositivo non ha' : 'dispositivi non hanno'} risposto.` : '');
async function each(list) { const r = await Promise.allSettled(list.map(([id, c]) => command(id, c))); return r.filter((x) => x.status === 'rejected').length; }

export const ACTIONS = {
  inverno: ['Casa inverno', async () => `Casa inverno attivato.${tail(failures(await setMode('inverno')))}`],
  fuori: ['Esco di casa', async () => `Esco di casa: valvole a ${config.heating.away.temp} gradi.${tail(failures(await setMode('fuori')))}`],
  estate: ['Casa estate', async () => `Casa estate attivato.${tail(failures(await setMode('estate')))}`],
  scalda: ['Scalda la zona giorno per un\'ora', async () => `Scaldo la zona giorno per un'ora.${tail(failures(await setBoost({ ids: 'zona', minutes: 60 })))}`],
  'luci-off': ['Spegni tutte le luci', async () => `Luci spente.${tail(await each(byType('light').map((d) => [d.id, { on: false }])))}`],
  'tapparelle-giu': ['Abbassa le tapparelle', async () => `Abbasso le tapparelle.${tail(await each(byType('shutter').map((d) => [d.id, { action: 'down' }])))}`],
  'tapparelle-su': ['Alza le tapparelle', async () => `Alzo le tapparelle.${tail(await each(byType('shutter').map((d) => [d.id, { action: 'up' }])))}`],
  ...Object.fromEntries(config.scenes.map((s) => [s.id, [s.name, async () => `${s.name}.${tail(failures(await runScene(s.id)))}`]])),
};

const text = (s, status = 200) => new Response(s, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

export async function runHook(req) {
  const u = new URL(req.url), given = u.searchParams.get('t') || req.headers.get('x-hook-token') || '';
  const real = (await store().get('hookToken')) || '';
  const ok = real && given.length === real.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(real));
  if (!ok) return text('Non autorizzato', 401);
  const act = ACTIONS[u.searchParams.get('do')];
  if (!act) return text(`Azione sconosciuta. Disponibili: ${Object.keys(ACTIONS).join(', ')}`, 400);
  try { return text(await act[1]()); } catch (e) { return text(`Non ci sono riuscito: ${e.message}`, 500); }
}
