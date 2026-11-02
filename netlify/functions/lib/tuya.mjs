// Climatizzatori Zephir via Tuya Cloud OpenAPI (se l'app è Smart Life / Tuya).
// SPERIMENTALE: i codici ("switch", "temp_set", "mode") variano per modello.
// Env: TUYA_ACCESS_ID, TUYA_ACCESS_SECRET, TUYA_REGION (eu -> openapi.tuyaeu.com)
import crypto from 'node:crypto';

const HOST = { eu: 'https://openapi.tuyaeu.com', us: 'https://openapi.tuyaus.com', cn: 'https://openapi.tuyacn.com' }[process.env.TUYA_REGION || 'eu'];
const hmac = (s) => crypto.createHmac('sha256', process.env.TUYA_ACCESS_SECRET).update(s).digest('hex').toUpperCase();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
let tok;

async function req(method, path, body) {
  if (!process.env.TUYA_ACCESS_ID || !process.env.TUYA_ACCESS_SECRET) throw new Error('Mancano TUYA_ACCESS_ID / TUYA_ACCESS_SECRET su Netlify');
  const t = Date.now().toString();
  const bodyStr = body ? JSON.stringify(body) : '';
  const token = path.startsWith('/v1.0/token') ? '' : (tok ??= await getToken());
  const stringToSign = [method, sha(bodyStr), '', path].join('\n');
  const sign = hmac(process.env.TUYA_ACCESS_ID + token + t + stringToSign);
  const r = await fetch(HOST + path, {
    method, body: bodyStr || undefined,
    headers: { client_id: process.env.TUYA_ACCESS_ID, sign, t, sign_method: 'HMAC-SHA256', ...(token && { access_token: token }), 'Content-Type': 'application/json' },
  }).then((x) => x.json());
  if (!r.success) throw new Error(`Tuya: ${r.msg}`);
  return r.result;
}
async function getToken() { return (await req('GET', '/v1.0/token?grant_type=1')).access_token; }

const commands = (id, list) => req('POST', `/v1.0/iot-03/devices/${id}/commands`, { commands: list });

// In configurazione deviceId può essere l'ID Tuya oppure il nome del dispositivo nell'app.
let devs;
const norm = (s) => String(s || '').trim().toLowerCase();
export async function listDevices() {
  if (devs) return devs;
  const r = await req('GET', '/v1.0/iot-01/associated-users/devices?size=100');
  devs = (r.devices || []).map((d) => ({ id: d.id, name: d.name, category: d.category, online: d.online }));
  return devs;
}
async function rid(v) {
  const l = await listDevices();
  const f = l.find((x) => x.id === v) || l.find((x) => norm(x.name) === norm(v));
  if (!f) throw new Error(`Tuya: dispositivo "${v}" non trovato tra quelli collegati al progetto`);
  return f.id;
}

// Le funzioni supportate cambiano da modello a modello: le leggo da Tuya (e le tengo in cache).
const specCache = new Map();
const FAN_CODES = ['windspeed', 'fan_speed_enum', 'wind_speed'];
const SWING_CODES = ['swing', 'switch_horizontal', 'switch_vertical', 'swing_3d'];

async function specs(id) {
  if (specCache.has(id)) return specCache.get(id);
  const r = await req('GET', `/v1.0/iot-03/devices/${id}/specifications`);
  const fns = Object.fromEntries((r.functions || []).map((f) => [f.code, { type: f.type, ...JSON.parse(f.values || '{}') }]));
  const find = (codes) => codes.find((c) => fns[c]);
  const t = fns.temp_set || {};
  const sp = {
    fns,
    scale: t.scale || 0,
    temp: { min: (t.min ?? 16) / 10 ** (t.scale || 0), max: (t.max ?? 30) / 10 ** (t.scale || 0), step: (t.step ?? 1) / 10 ** (t.scale || 0) },
    modes: fns.mode?.range || [],
    fanCode: find(FAN_CODES),
    swingCodes: SWING_CODES.filter((c) => fns[c]?.type === 'Boolean'),
    extras: ['eco', 'sleep', 'turbo', 'health', 'light', 'child_lock'].filter((c) => fns[c]?.type === 'Boolean'),
  };
  sp.fans = sp.fanCode ? fns[sp.fanCode].range || [] : [];
  specCache.set(id, sp);
  return sp;
}

export async function ac(dev, cmd) {
  const id = await rid(dev.deviceId);
  const sp = await specs(id);
  const list = [];
  if ('on' in cmd) list.push({ code: 'switch', value: cmd.on });
  if ('target' in cmd) {
    const v = Math.min(sp.temp.max, Math.max(sp.temp.min, cmd.target));
    list.push({ code: 'temp_set', value: Math.round(v * 10 ** sp.scale) });
  }
  if ('mode' in cmd) {
    if (!sp.modes.includes(cmd.mode)) throw new Error(`Modalità non supportata: ${cmd.mode}`);
    list.push({ code: 'mode', value: cmd.mode });
  }
  if ('fan' in cmd) {
    if (!sp.fanCode || !sp.fans.includes(cmd.fan)) throw new Error(`Velocità non supportata: ${cmd.fan}`);
    list.push({ code: sp.fanCode, value: cmd.fan });
  }
  if ('swing' in cmd) sp.swingCodes.forEach((c) => list.push({ code: c, value: !!cmd.swing }));
  for (const x of sp.extras) if (x in cmd) list.push({ code: x, value: !!cmd[x] });
  if (list.length) await commands(id, list);
}

export async function readAc(dev) {
  const id = await rid(dev.deviceId);
  const [sp, st] = await Promise.all([specs(id), req('GET', `/v1.0/iot-03/devices/${id}/status`)]);
  const g = (c) => st.find((x) => x.code === c)?.value;
  const k = 10 ** sp.scale;
  return {
    on: g('switch'), mode: g('mode'),
    target: g('temp_set') != null ? g('temp_set') / k : undefined,
    current: g('temp_current') != null ? g('temp_current') / (g('temp_current') > 60 ? 10 : 1) : undefined,
    fan: sp.fanCode ? g(sp.fanCode) : undefined,
    swing: sp.swingCodes.length ? sp.swingCodes.some((c) => g(c)) : undefined,
    extras: Object.fromEntries(sp.extras.map((c) => [c, !!g(c)])),
    caps: { modes: sp.modes, fans: sp.fans, swing: sp.swingCodes.length > 0, extras: sp.extras, temp: sp.temp },
  };
}
