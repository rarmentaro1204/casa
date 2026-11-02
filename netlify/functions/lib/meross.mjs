// Termovalvole MTS150 (sub-device dell'hub MSH300) via cloud Meross + MQTT.
// SPERIMENTALE: protocollo non ufficiale, da verificare sul tuo account.
// Le valvole si cercano per NOME (subName): se rimuovi e riaccoppi una valvola
// cambia l'ID interno ma non il nome, quindi la configurazione resta valida.
// Env: MEROSS_EMAIL, MEROSS_PASSWORD
import crypto from 'node:crypto';
import mqtt from 'mqtt';

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const SECRET = '23x17ahWarFH6w29';
const norm = (s) => String(s || '').trim().toLowerCase();
let session;

function signed(data) {
  const params = Buffer.from(JSON.stringify(data)).toString('base64');
  const nonce = crypto.randomBytes(8).toString('hex').toUpperCase();
  const timestamp = Date.now();
  return new URLSearchParams({ params, sign: md5(SECRET + timestamp + nonce + params), timestamp, nonce });
}

async function cloud(path, data, token = '') {
  const r = await fetch(`https://iot.meross.com${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${token}`.trim() },
    body: signed(data),
  }).then((x) => x.json());
  if (r.apiStatus !== 0) throw new Error(`Meross ${path}: ${r.info || r.apiStatus}`);
  return r.data;
}

async function login() {
  if (session) return session;
  const d = await cloud('/v1/Auth/signIn', { email: process.env.MEROSS_EMAIL, password: md5(process.env.MEROSS_PASSWORD), encryption: 1, accountCountryCode: 'IT', mobileInfo: { deviceModel: 'Pixel', mobileOsVersion: '13', mobileOs: 'Android', uuid: crypto.randomUUID(), carrier: '' } });
  session = d;
  return session;
}

// Ogni chiamata usa un clientId MQTT proprio: due connessioni con lo stesso id si disconnettono a vicenda.
async function send(uuid, method, namespace, payload) {
  const s = await login();
  const appId = md5(crypto.randomUUID());
  const host = s.mqttDomain || 'iotx-eu.meross.com';
  const client = mqtt.connect(`mqtts://${host}:2001`, { clientId: `app:${appId}`, username: s.userId, password: md5(s.userId + s.key) });
  const respTopic = `/app/${s.userId}-${appId}/subscribe`;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { client.end(true); reject(new Error('Meross: timeout (hub spento o offline?)')); }, 8000);
    client.on('error', (e) => { clearTimeout(t); client.end(true); reject(e); });
    client.on('connect', () => {
      client.subscribe(respTopic);
      const messageId = md5(crypto.randomUUID());
      const timestamp = Math.floor(Date.now() / 1000);
      const header = { messageId, method, from: respTopic, namespace, payloadVersion: 1, sign: md5(messageId + s.key + timestamp), timestamp, triggerSrc: 'Android', uuid };
      client.on('message', (_t, buf) => {
        const m = JSON.parse(buf.toString());
        if (m.header.messageId !== messageId) return;
        clearTimeout(t); client.end(true); resolve(m.payload);
      });
      client.publish(`/appliance/${uuid}/subscribe`, JSON.stringify({ header, payload }));
    });
  });
}

// Fotografia di tutte le valvole dell'hub (cache breve per non aprire 4 connessioni uguali).
const snaps = new Map();
export function snapshot(hubUuid, fresh = false) {
  const c = snaps.get(hubUuid);
  if (!fresh && c && Date.now() - c.at < 10000) return c.p;
  const p = (async () => {
    const s = await login();
    const subs = (await cloud('/v1/Hub/getSubDevices', { uuid: hubUuid }, s.token)).filter((x) => /mts/i.test(x.subDeviceType || ''));
    const ids = subs.map((x) => ({ id: x.subDeviceId }));
    const [all, bat] = await Promise.all([
      send(hubUuid, 'GET', 'Appliance.Hub.Mts100.All', { all: ids }),
      send(hubUuid, 'GET', 'Appliance.Hub.Battery', { battery: ids }).catch(() => ({})),
    ]);
    return subs.map((x) => {
      const d = all.all?.find((a) => a.id === x.subDeviceId);
      const b = bat.battery?.find((a) => a.id === x.subDeviceId);
      const t = d?.temperature;
      return { id: x.subDeviceId, name: x.subDeviceName, online: d?.online?.status === 1, on: d?.togglex?.onoff === 1,
        current: t ? t.room / 10 : undefined, target: t ? t.currentSet / 10 : undefined, min: t ? t.min / 10 : 5, max: t ? t.max / 10 : 35, batteryMv: b?.value };
    });
  })();
  snaps.set(hubUuid, { at: Date.now(), p });
  p.catch(() => snaps.delete(hubUuid));
  return p;
}

// Elenco per la diagnostica: segnala nomi doppi (vecchia voce rimasta dopo il reinserimento).
export async function listValves(hubUuid) {
  const list = await snapshot(hubUuid, true);
  return list.map((v) => ({ ...v, duplicate: list.filter((x) => norm(x.name) === norm(v.name)).length > 1 }));
}

async function find(dev) {
  const list = await snapshot(dev.hubUuid);
  if (!dev.subName) {
    const v = list.find((x) => x.id === dev.subId);
    if (!v) throw new Error('MTS150 non trovata (ID cambiato? usa subName)');
    return v;
  }
  const c = list.filter((x) => norm(x.name) === norm(dev.subName));
  if (!c.length) throw new Error(`Valvola "${dev.subName}" non trovata sull'hub`);
  return c.find((x) => x.online) || c[0]; // se ci sono doppioni vince quello online
}

// Temperature in decimi di grado (210 = 21.0°C). target: numero oppure 'max'.
export async function thermostat(dev, cmd) {
  const v = await find(dev);
  if (!v.online) throw new Error(`Valvola "${v.name}" offline: controlla pile e distanza dall'hub`);
  if ('on' in cmd) await send(dev.hubUuid, 'SET', 'Appliance.Hub.ToggleX', { togglex: [{ id: v.id, onoff: cmd.on ? 1 : 0 }] });
  if ('target' in cmd) {
    const t = cmd.target === 'max' ? v.max : cmd.target;
    await send(dev.hubUuid, 'SET', 'Appliance.Hub.Mts100.Mode', { mode: [{ id: v.id, state: 0 }] }); // 0 = manuale
    await send(dev.hubUuid, 'SET', 'Appliance.Hub.Mts100.Temperature', { temperature: [{ id: v.id, custom: Math.round(t * 10) }] });
  }
  snaps.delete(dev.hubUuid);
}

export async function readThermostat(dev) {
  const v = await find(dev);
  return { current: v.current, target: v.target, on: v.on, online: v.online, batteryMv: v.batteryMv };
}
