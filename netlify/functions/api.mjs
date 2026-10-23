import { listDevices, rawThermostat } from './lib/meross.mjs';
import { rawAc } from './lib/tuya.mjs';
import { config as cfg, state, command, runScene, getSchedules, setSchedules } from './lib/core.mjs';

const json = (data, status = 200) => Response.json(data, { status });

export default async (req) => {
  // PIN semplice: imposta APP_PIN nelle variabili d'ambiente di Netlify.
  const pin = process.env.APP_PIN;
  if (pin && req.headers.get('x-pin') !== pin) return json({ error: 'PIN errato' }, 401);

  const path = new URL(req.url).pathname.replace(/^\/api\/?/, '');
  const body = req.method === 'POST' || req.method === 'PUT' ? await req.json().catch(() => ({})) : {};
  try {
    if (path === 'config') return json({ devices: cfg.devices.map(({ id, name, room, type }) => ({ id, name, room, type })), scenes: cfg.scenes.map(({ id, name, icon }) => ({ id, name, icon })) });
    if (path === 'meross-devices') { if (!pin) return json({ error: 'Imposta APP_PIN per usare questo endpoint' }, 403); return json(await listDevices()); }
    if (path === 'meross-debug') {
      if (!pin) return json({ error: 'Imposta APP_PIN per usare questo endpoint' }, 403);
      const out = {};
      for (const d of cfg.devices.filter((x) => x.driver === 'meross')) out[d.id] = await rawThermostat(d).catch((e) => ({ error: e.message }));
      return json(out);
    }
    if (path === 'tuya-debug') {
      if (!pin) return json({ error: 'Imposta APP_PIN per usare questo endpoint' }, 403);
      const out = {};
      for (const d of cfg.devices.filter((x) => x.driver === 'tuya')) out[d.id] = await rawAc(d).catch((e) => ({ error: e.message }));
      return json(out);
    }
    if (path === 'state') return json(await state());
    if (path === 'command') {
      if (cfg.devices.find((d) => d.id === body.device)?.type === 'door' && !pin) return json({ error: 'Imposta APP_PIN per abilitare il portone' }, 403);
 await command(body.device, body.command); return json({ ok: true }); }
    if (path === 'scene') return json(await runScene(body.scene));
    if (path === 'schedules' && req.method === 'GET') return json(await getSchedules());
    if (path === 'schedules' && req.method === 'PUT') { await setSchedules(body.schedules); return json({ ok: true }); }
    return json({ error: 'Non trovato' }, 404);
  } catch (e) { return json({ error: e.message }, 500); }
};


export const config = { path: "/api/*" };
