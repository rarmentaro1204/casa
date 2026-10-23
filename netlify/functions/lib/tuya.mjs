// Climatizzatori Zephir via Tuya Cloud OpenAPI (se l'app è Smart Life / Tuya).
// Codici verificati sul Zephir/TCL dell'utente (switch, temp_set, mode); altri modelli possono variare.
// Env: TUYA_ACCESS_ID, TUYA_ACCESS_SECRET, TUYA_REGION (eu -> openapi.tuyaeu.com)
import crypto from 'node:crypto';

const HOST = { eu: 'https://openapi.tuyaeu.com', us: 'https://openapi.tuyaus.com', cn: 'https://openapi.tuyacn.com' }[process.env.TUYA_REGION || 'eu'];
const hmac = (s) => crypto.createHmac('sha256', process.env.TUYA_ACCESS_SECRET).update(s).digest('hex').toUpperCase();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
let tok;

async function req(method, path, body) {
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

// Zephir/TCL: temp_set ha scala 1 (260 = 26.0°C, passo 0.5, minimo 16°C); mode usa cold|hot|wet|wind|auto.
const MODE_TO_TUYA = { cool: 'cold', heat: 'hot', dry: 'wet', fan: 'wind', auto: 'auto' };
const MODE_FROM_TUYA = { cold: 'cool', hot: 'heat', wet: 'dry', wind: 'fan', auto: 'auto' };

export async function ac(dev, cmd) {
  const list = [];
  if ('on' in cmd) list.push({ code: 'switch', value: cmd.on });
  if ('target' in cmd) list.push({ code: 'temp_set', value: Math.round(Math.min(30, Math.max(16, cmd.target)) * 2) * 5 });
  if ('mode' in cmd) list.push({ code: 'mode', value: MODE_TO_TUYA[cmd.mode] ?? cmd.mode });
  if (list.length) await commands(dev.deviceId, list);
}

export async function readAc(dev) {
  const st = await req('GET', `/v1.0/iot-03/devices/${dev.deviceId}/status`);
  const g = (c) => st.find((x) => x.code === c)?.value;
  const target = g('temp_set');
  return { on: g('switch'), target: target != null ? target / 10 : undefined, current: g('temp_current'), mode: MODE_FROM_TUYA[g('mode')] ?? g('mode') };
}

// Diagnostica: codici e valori che il climatizzatore accetta (i nomi variano per modello).
export async function rawAc(dev) {
  const [functions, status] = await Promise.all([
    req('GET', `/v1.0/devices/${dev.deviceId}/functions`).catch((e) => ({ error: e.message })),
    req('GET', `/v1.0/iot-03/devices/${dev.deviceId}/status`).catch((e) => ({ error: e.message })),
  ]);
  return { functions, status };
}
