import { getStore } from '@netlify/blobs';
import devices from '../../../config/devices.json' with { type: 'json' };
import * as ewelink from './ewelink.mjs';
import * as meross from './meross.mjs';
import * as tuya from './tuya.mjs';
import * as switchbot from './switchbot.mjs';

export const config = devices;
const store = () => getStore('casa');
const byId = (id) => config.devices.find((d) => d.id === id);

// type -> (dispositivo, comando) per i driver
const run = {
  'ewelink:light': ewelink.light,
  'ewelink:door': (d) => ewelink.door(d),
  'ewelink:shutter': (d, c) => ewelink.shutter(d, c.action),
  'meross:thermostat': meross.thermostat,
  'tuya:ac': tuya.ac,
  'switchbot:lock': switchbot.lock,
  'switchbot:door': (d) => switchbot.press(d),
};
const read = {
  'ewelink:light': ewelink.readLight,
  'meross:thermostat': meross.readThermostat,
  'tuya:ac': tuya.readAc,
  'switchbot:lock': switchbot.readLock,
};

export async function command(id, cmd) {
  const dev = byId(id);
  if (!dev) throw new Error(`Dispositivo sconosciuto: ${id}`);
  const fn = run[`${dev.driver}:${dev.type}`];
  if (!fn) throw new Error(`Driver non supportato: ${dev.driver}:${dev.type}`);
  if (dev.type === 'door' || (dev.type === 'lock' && cmd.locked === false)) console.log(`PORTONE aperto ${new Date().toISOString()}`);
  await fn(dev, cmd);
  const st = (await store().get('state', { type: 'json' })) || {};
  st[id] = { ...st[id], ...cmd, at: Date.now() };
  await store().setJSON('state', st);
}

export async function runScene(sceneId) {
  const scene = config.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error('Scena sconosciuta');
  // Il portone non parte mai da scene, orari o automatismi: solo tocco manuale.
  // Mai aprire da automatismi: il portone/citofono e lo sblocco della serratura sono solo manuali.
  scene.actions = scene.actions.filter((a) => byId(a.device)?.type !== 'door' && !(byId(a.device)?.type === 'lock' && a.command.locked === false));
  const res = await Promise.allSettled(scene.actions.map((a) => command(a.device, a.command)));
  return res.map((r, i) => ({ device: scene.actions[i].device, ok: r.status === 'fulfilled', error: r.reason?.message }));
}

export async function state() {
  const cache = (await store().get('state', { type: 'json' })) || {};
  const live = await Promise.all(config.devices.map(async (d) => {
    const fn = read[`${d.driver}:${d.type}`];
    if (!fn) return [d.id, cache[d.id] || {}]; // es. tapparelle: solo l'ultimo comando
    try { const r = await fn(d); return [d.id, { ...cache[d.id], ...r, online: r.online ?? true }]; }
    catch (e) { return [d.id, { ...cache[d.id], online: false, error: e.message }]; }
  }));
  return Object.fromEntries(live);
}

export const getSchedules = async () => (await store().get('schedules', { type: 'json' })) || [];
export const setSchedules = (list) => store().setJSON('schedules', list);
