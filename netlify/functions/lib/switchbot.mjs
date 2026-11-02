// Serratura SwitchBot (Lock / Lock Pro / Lock Ultra) via API v1.1 cloud.
// Il controllo da remoto richiede un SwitchBot Hub (Mini o 2) collegato alla serratura.
// Env: SWITCHBOT_TOKEN, SWITCHBOT_SECRET (app SwitchBot → Profilo → Preferenze → Opzioni sviluppatore)
import crypto from 'node:crypto';

const norm = (s) => String(s || '').trim().toLowerCase();

async function call(method, path, body) {
  const { SWITCHBOT_TOKEN: token, SWITCHBOT_SECRET: secret } = process.env;
  if (!token || !secret) throw new Error('Mancano SWITCHBOT_TOKEN / SWITCHBOT_SECRET su Netlify');
  const t = Date.now().toString(), nonce = crypto.randomUUID();
  const sign = crypto.createHmac('sha256', secret).update(token + t + nonce).digest('base64');
  const r = await fetch(`https://api.switch-bot.com${path}`, {
    method, body: body && JSON.stringify(body),
    headers: { Authorization: token, sign, t, nonce, 'Content-Type': 'application/json; charset=utf8' },
  }).then((x) => x.json());
  if (r.statusCode !== 100) throw new Error(`SwitchBot: ${r.message || r.statusCode}`);
  return r.body;
}

let devs;
export async function listDevices() {
  if (devs) return devs;
  const b = await call('GET', '/v1.1/devices');
  devs = (b.deviceList || []).map((d) => ({ id: d.deviceId, name: d.deviceName, type: d.deviceType, online: !!d.hubDeviceId }));
  return devs;
}

// In configurazione deviceId può essere l'ID oppure il nome della serratura nell'app.
async function rid(v) {
  const l = await listDevices();
  const f = l.find((x) => x.id === v) || l.find((x) => norm(x.name) === norm(v));
  if (!f) throw new Error(`SwitchBot: dispositivo "${v}" non trovato`);
  return f.id;
}

// cmd: { locked: true } chiude, { locked: false } apre.
export async function lock(dev, cmd) {
  const id = await rid(dev.deviceId);
  await call('POST', `/v1.1/devices/${id}/commands`, { command: cmd.locked === false ? 'unlock' : 'lock', parameter: 'default', commandType: 'command' });
}

// SwitchBot Bot: preme il pulsante apriporta del citofono (adesivo, nessun filo).
export async function press(dev) {
  const id = await rid(dev.deviceId);
  await call('POST', `/v1.1/devices/${id}/commands`, { command: 'press', parameter: 'default', commandType: 'command' });
}

export async function readLock(dev) {
  const b = await call('GET', `/v1.1/devices/${await rid(dev.deviceId)}/status`);
  return { locked: b.lockState === 'locked', lockState: b.lockState, doorOpen: b.doorState === 'opened', battery: b.battery };
}
