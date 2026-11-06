import { getMode, setMode, setPolicy, status as heatingStatus } from './lib/heating.mjs';
import { listValves } from './lib/meross.mjs';
import * as ewelink from './lib/ewelink.mjs';
import * as tuya from './lib/tuya.mjs';
import * as switchbot from './lib/switchbot.mjs';
import { config as cfg, state, command, runScene, getSchedules, setSchedules } from './lib/core.mjs';

const json = (data, status = 200) => Response.json(data, { status });

export default async (req) => {
  // PIN semplice: imposta APP_PIN nelle variabili d'ambiente di Netlify.
  const pin = process.env.APP_PIN;
  if (pin && req.headers.get('x-pin') !== pin) return json({ error: 'PIN errato' }, 401);

  const path = new URL(req.url).pathname.replace(/^\/api\/?/, '');
  const body = req.method === 'POST' || req.method === 'PUT' ? await req.json().catch(() => ({})) : {};
  try {
    if (path === 'config') {
      const h = cfg.heating;
      return json({
        devices: cfg.devices.map(({ id, name, room, type, subName }) => ({ id, name, room, type, label: subName || name })),
        scenes: cfg.scenes.map(({ id, name, icon }) => ({ id, name, icon })),
        modes: cfg.modes,
        heating: { group: h.group, base: h.base.devices, always: h.always, temp: h.temp, baseTemp: h.base.temp, awayTemp: h.away.temp, winter: h.winter },
      });
    }
    if (path === 'mode' && req.method === 'GET') return json({ mode: await getMode() });
    if (path === 'heating') return json(await heatingStatus());
    if (path === 'policy') return json(await setPolicy(body.policy));
    if (path === 'mode') return json(await setMode(body.mode));
    if (path === 'discover') {
      const t = async (f) => { try { return { devices: await f() }; } catch (e) { return { error: e.message }; } };
      return json({ ewelink: await t(ewelink.listDevices), tuya: await t(tuya.listDevices), switchbot: await t(switchbot.listDevices) });
    }
    if (path === 'valves') {
      const hubs = [...new Set(cfg.devices.filter((d) => d.driver === 'meross').map((d) => d.hubUuid))];
      const found = (await Promise.all(hubs.map(listValves))).flat();
      const names = cfg.devices.filter((d) => d.driver === 'meross').map((d) => d.subName);
      const norm = (x) => String(x || '').trim().toLowerCase();
      return json({ valves: found.map((v) => ({ ...v, configured: names.some((n) => norm(n) === norm(v.name)) })), missing: names.filter((n) => !found.some((v) => norm(v.name) === norm(n))) });
    }
    if (path === 'state') return json(await state());
    if (path === 'command') {
      if (['door', 'lock'].includes(cfg.devices.find((d) => d.id === body.device)?.type) && !pin) return json({ error: 'Imposta APP_PIN per abilitare portone e serratura' }, 403);
 await command(body.device, body.command); return json({ ok: true }); }
    if (path === 'scene') return json(await runScene(body.scene));
    if (path === 'schedules' && req.method === 'GET') return json(await getSchedules());
    if (path === 'schedules' && req.method === 'PUT') { await setSchedules(body.schedules); return json({ ok: true }); }
    return json({ error: 'Non trovato' }, 404);
  } catch (e) { return json({ error: e.message }, 500); }
};


export const config = { path: "/api/*" };
