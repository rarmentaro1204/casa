// Sonoff Mini R4 via eWeLink Open API v2 (cloud).
// Env: EWELINK_APPID, EWELINK_SECRET, EWELINK_EMAIL, EWELINK_PASSWORD, EWELINK_REGION (eu|us|as|cn)
import crypto from 'node:crypto';

const BASE = { eu: 'https://eu-apia.coolkit.cc', us: 'https://us-apia.coolkit.cc', as: 'https://as-apia.coolkit.cc', cn: 'https://cn-apia.coolkit.cn' };
let session; // { token, base, exp }

const sign = (body) => crypto.createHmac('sha256', process.env.EWELINK_SECRET).update(body).digest('base64');

async function login() {
  if (session && session.exp > Date.now()) return session;
  const base = BASE[process.env.EWELINK_REGION || 'eu'];
  const body = JSON.stringify({ email: process.env.EWELINK_EMAIL, password: process.env.EWELINK_PASSWORD, countryCode: '+39' });
  const r = await fetch(`${base}/v2/user/login`, {
    method: 'POST', body,
    headers: { 'Content-Type': 'application/json', 'X-CK-Appid': process.env.EWELINK_APPID, Authorization: `Sign ${sign(body)}` },
  }).then((x) => x.json());
  if (r.error) throw new Error(`eWeLink login: ${r.msg}`);
  session = { token: r.data.at, base, exp: Date.now() + 20 * 24 * 3600e3 };
  return session;
}

async function call(path, method, body) {
  const s = await login();
  const r = await fetch(s.base + path, {
    method, body: body && JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'X-CK-Appid': process.env.EWELINK_APPID, Authorization: `Bearer ${s.token}` },
  }).then((x) => x.json());
  if (r.error) throw new Error(`eWeLink: ${r.msg}`);
  return r.data;
}

export const setSwitch = (id, on) =>
  call('/v2/device/thing/status', 'POST', { type: 1, id, params: { switch: on ? 'on' : 'off' } });

export async function getSwitch(id) {
  const d = await call(`/v2/device/thing/status?type=1&id=${id}&params=switch`, 'GET');
  return d.params.switch === 'on';
}

// Tapparella = 2 Mini R4 (SU/GIU). L'interblocco e il tempo di corsa li gestisce il
// dispositivo: in eWeLink imposta su entrambi "Inching" (impulso) = tempo di corsa.
export async function shutter(dev, action) {
  if (action === 'stop') return Promise.all([setSwitch(dev.up, false), setSwitch(dev.down, false)]);
  const [on, off] = action === 'up' ? [dev.up, dev.down] : [dev.down, dev.up];
  await setSwitch(off, false); // prima spegni il verso opposto: mai entrambi accesi
  await setSwitch(on, true);
}

// Portone: un Mini R4 in parallelo al pulsante apriporta del citofono.
// In eWeLink imposta "Inching" a 1-2 s: il relè si chiude e si riapre da solo.
export const door = (dev) => setSwitch(dev.deviceId, true);

export async function light(dev, cmd) {
  if ('on' in cmd) await setSwitch(dev.deviceId, cmd.on);
}
export async function readLight(dev) { return { on: await getSwitch(dev.deviceId) }; }
