// Climatizzatori Zephir via Tuya Cloud OpenAPI (se l'app è Smart Life / Tuya).
// SPERIMENTALE: i codici ("switch", "temp_set", "mode") variano per modello.
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

export async function ac(dev, cmd) {
  const list = [];
  if ('on' in cmd) list.push({ code: 'switch', value: cmd.on });
  if ('target' in cmd) list.push({ code: 'temp_set', value: Math.round(cmd.target) });
  if ('mode' in cmd) list.push({ code: 'mode', value: cmd.mode }); // cool|heat|auto|wind|dry
  if (list.length) await commands(dev.deviceId, list);
}

export async function readAc(dev) {
  const st = await req('GET', `/v1.0/iot-03/devices/${dev.deviceId}/status`);
  const g = (c) => st.find((x) => x.code === c)?.value;
  return { on: g('switch'), target: g('temp_set'), current: g('temp_current'), mode: g('mode') };
}
