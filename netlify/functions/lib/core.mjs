import { getStore } from '@netlify/blobs';
import { readFileSync } from 'node:fs';
import * as ewelink from './ewelink.mjs';
import * as meross from './meross.mjs';
import * as tuya from './tuya.mjs';

export const config = JSON.parse(readFileSync(new URL('../../../config/devices.json', import.meta.url), 'utf8'));
const store = () => getStore('casa');
const byId = (id) => config.devices.find((d) => d.id === id);

// type -> (dispositivo, comando) per i driver
const run = {
  'ewelink:light': ewelink.light,
  'ewelink:door': (d) => ewelink.door(d),
  'ewelink:shutter': (d, c) => ewelink.shutter(d, c.action),
  'meross:thermostat': meross.thermostat,
  'tuya:ac': tuya.ac,
};
const read = {
  'ewelink:light': ewelink.readLight,
  'meross:thermostat': meross.readThermostat,
  'tuya:ac': tuya.readAc,
};

export async function command(id, cmd) {
  const dev = byId(id);
  if (!dev) throw new Error(`Dispositivo sconosciuto: ${id}`);
  const fn = run[`${dev.driver}:${dev.type}`];
  if (!fn) throw new Error(`Driver non supportato: ${dev.driver}:${dev.type}`);
  if (dev.type === 'door') console.log(`PORTONE aperto ${new Date().toISOString()}`);
  await fn(dev, cmd);
  const st = (await store().get('state', { type: 'json' })) || {};
  st[id] = { ...st[id], ...cmd, at: Date.now() };
  await store().setJSON('state', st);
}

export async function runScene(sceneId) {
  const scene = config.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error('Scena sconosciuta');
  // Il portone non parte mai da scene, orari o automatismi: solo tocco manuale.
  scene.actions = scene.actions.filter((a) => byId(a.device)?.type !== 'door');
  const res = await Promise.allSettled(scene.actions.map((a) => command(a.device, a.command)));
  return res.map((r, i) => ({ device: scene.actions[i].device, ok: r.status === 'fulfilled', error: r.reason?.message }));
}

export async function state() {
  const cache = (await store().get('state', { type: 'json' })) || {};
  const live = await Promise.all(config.devices.map(async (d) => {
    const fn = read[`${d.driver}:${d.type}`];
    if (!fn) return [d.id, cache[d.id] || {}]; // es. tapparelle: solo l'ultimo comando
    try { return [d.id, { ...cache[d.id], ...(await fn(d)), online: true }]; }
    catch (e) { return [d.id, { ...cache[d.id], online: false, error: e.message }]; }
  }));
  return Object.fromEntries(live);
}

export const getSchedules = async () => (await store().get('schedules', { type: 'json' })) || [];
export const setSchedules = (list) => store().setJSON('schedules', list);
