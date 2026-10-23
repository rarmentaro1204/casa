// Termovalvole MTS150 (sub-device dell'hub MSH300) via cloud Meross + MQTT.
// SPERIMENTALE: protocollo non ufficiale, da verificare sul tuo account.
// Env: MEROSS_EMAIL, MEROSS_PASSWORD
import crypto from 'node:crypto';
import mqtt from 'mqtt';

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const SECRET = '23x17ahWarFH6w29';
let session;
let apiBase = process.env.MEROSS_API || 'https://iotx-eu.meross.com';

async function login(retry = true) {
  if (session) return session;
  const params = Buffer.from(JSON.stringify({ email: process.env.MEROSS_EMAIL, password: md5(process.env.MEROSS_PASSWORD), encryption: 1, accountCountryCode: 'IT', mobileInfo: { deviceModel: 'Pixel', mobileOsVersion: '13', mobileOs: 'Android', uuid: crypto.randomUUID(), carrier: '' } })).toString('base64');
  const nonce = crypto.randomBytes(8).toString('hex').toUpperCase();
  const timestamp = Date.now();
  const sign = md5(SECRET + timestamp + nonce + params);
  const r = await fetch(`${apiBase}/v1/Auth/signIn`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic' },
    body: new URLSearchParams({ params, sign, timestamp, nonce }),
  }).then((x) => x.json());
  // L'account è in un'altra regione: Meross indica il dominio giusto.
  if (r.apiStatus === 1030 && r.data?.domain && retry) { apiBase = r.data.domain.startsWith('http') ? r.data.domain : `https://${r.data.domain}`; return login(false); }
  if (r.apiStatus !== 0) throw new Error(`Meross login: ${r.info}`);
  session = { ...r.data, userId: String(r.data.userId ?? r.data.userid), appId: md5(crypto.randomUUID()) };
  return session;
}

async function send(uuid, method, namespace, payload) {
  const s = await login();
  const host = new URL(s.mqttDomain ? `mqtts://${s.mqttDomain}` : 'mqtts://iotx-eu.meross.com').hostname;
  const clientId = `app:${s.appId}`;
  const client = mqtt.connect(`mqtts://${host}:2001`, { clientId, username: s.userId, password: md5(s.userId + s.key) });
  const respTopic = `/app/${s.userId}-${s.appId}/subscribe`;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { client.end(true); reject(new Error('Meross: timeout')); }, 8000);
    client.on('error', (e) => { clearTimeout(t); client.end(true); reject(e); });
    client.on('connect', () => {
      client.subscribe(respTopic);
      const messageId = md5(crypto.randomUUID());
      const timestamp = Math.floor(Date.now() / 1000);
      const header = { messageId, method, from: respTopic, namespace, payloadVersion: 1, sign: md5(messageId + s.key + timestamp), timestamp, triggerSrc: 'Android', uuid, };
      client.on('message', (_t, buf) => {
        const m = JSON.parse(buf.toString());
        if (m.header.messageId !== messageId) return;
        clearTimeout(t); client.end(true);
        if (m.header.method === 'ERROR') reject(new Error(`Meross ha rifiutato il comando: ${JSON.stringify(m.payload?.error ?? m.payload)}`));
        else resolve(m.payload);
      });
      client.publish(`/appliance/${uuid}/subscribe`, JSON.stringify({ header, payload }));
    });
  });
}

// Temperature in decimi di grado (210 = 21.0°C).
export async function thermostat(dev, cmd) {
  if ('target' in cmd) await send(dev.hubUuid, 'SET', 'Appliance.Hub.Mts100.Temperature', { temperature: [{ id: dev.subId, custom: Math.round(cmd.target * 10) }] });
  if ('on' in cmd) await send(dev.hubUuid, 'SET', 'Appliance.Hub.ToggleX', { togglex: [{ id: dev.subId, onoff: cmd.on ? 1 : 0 }] });
}

export async function readThermostat(dev) {
  const p = await send(dev.hubUuid, 'GET', 'Appliance.Hub.Mts100.All', { all: [{ id: dev.subId }] });
  const d = p.all?.find((x) => x.id === dev.subId);
  if (!d) throw new Error('MTS150 non trovata');
  return { current: d.temperature.room / 10, target: d.temperature.currentSet / 10, on: d.togglex?.onoff === 1 };
}

// Elenca hub e termovalvole dell'account, per compilare config/devices.json.
async function cloud(path, data) {
  const s = await login();
  const params = Buffer.from(JSON.stringify(data)).toString('base64');
  const nonce = crypto.randomBytes(8).toString('hex').toUpperCase();
  const timestamp = Date.now();
  const sign = md5(SECRET + timestamp + nonce + params);
  const r = await fetch(`${apiBase}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${s.token}` },
    body: new URLSearchParams({ params, sign, timestamp, nonce }),
  }).then((x) => x.json());
  if (r.apiStatus !== 0) throw new Error(`Meross ${path}: ${r.info}`);
  return r.data;
}

export async function listDevices() {
  const devs = await cloud('/v1/Device/devList', {});
  const hubs = devs.filter((d) => /^msh/i.test(d.deviceType));
  const out = [];
  for (const h of hubs) {
    const subs = await cloud('/v1/Hub/getSubDevices', { uuid: h.uuid }).catch(() => []);
    out.push({ hubUuid: h.uuid, hubName: h.devName, valvole: subs.map((x) => ({ subId: x.subDeviceId, name: x.subDeviceName, type: x.subDeviceType })) });
  }
  return { hubs: out, altriDispositivi: devs.filter((d) => !/^msh/i.test(d.deviceType)).map((d) => ({ uuid: d.uuid, name: d.devName, type: d.deviceType })) };
}

// Diagnostica: risposta grezza di Meross per una valvola (stato on/off, modalità, temperature).
export async function rawThermostat(dev) {
  return send(dev.hubUuid, 'GET', 'Appliance.Hub.Mts100.All', { all: [{ id: dev.subId }] });
}
