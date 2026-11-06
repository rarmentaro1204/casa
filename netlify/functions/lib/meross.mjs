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
// Meross ha server per regione. Parto dall'Europa e, se l'account è altrove, seguo l'indirizzo indicato da Meross.
let apiBase = (process.env.MEROSS_API || 'https://iotx-eu.meross.com').replace(/\/$/, '');

function signed(data) {
  const params = Buffer.from(JSON.stringify(data)).toString('base64');
  const nonce = crypto.randomBytes(8).toString('hex').toUpperCase();
  const timestamp = Date.now();
  return new URLSearchParams({ params, sign: md5(SECRET + timestamp + nonce + params), timestamp, nonce });
}

async function cloud(path, data, token = '', retry = true) {
  if (!process.env.MEROSS_EMAIL || !process.env.MEROSS_PASSWORD) throw new Error('Mancano MEROSS_EMAIL / MEROSS_PASSWORD su Netlify');
  const r = await fetch(`${apiBase}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${token}`.trim() },
    body: signed(data),
  }).then((x) => x.json());
  if (r.apiStatus === 1030 && retry && r.data?.domain) {
    apiBase = r.data.domain.startsWith('http') ? r.data.domain : `https://${r.data.domain}`;
    return cloud(path, data, token, false);
  }
  if (r.apiStatus !== 0) throw new Error(`Meross ${path}: ${r.info || r.apiStatus}`);
  return r.data;
}

async function login() {
  if (session) return session;
  const d = await cloud('/v1/Auth/signIn', { email: process.env.MEROSS_EMAIL, password: md5(process.env.MEROSS_PASSWORD), encryption: 1, accountCountryCode: 'IT', mobileInfo: { deviceModel: 'Pixel', mobileOsVersion: '13', mobileOs: 'Android', uuid: crypto.randomUUID(), carrier: '' } });
  session = d;
  return session;
}

// Ogni connessione usa un clientId MQTT proprio (due connessioni con lo stesso id si disconnettono a vicenda)
// e può portare più richieste di seguito: meno connessioni = comandi più rapidi.
async function connect() {
  const s = await login();
  const appId = md5(crypto.randomUUID());
  const uid = String(s.userId ?? s.userid ?? s.uid ?? '');
  if (!uid || !s.key) throw new Error(`Meross: risposta di login inattesa (campi ricevuti: ${Object.keys(s).join(', ') || 'nessuno'})`);
  const client = mqtt.connect(`mqtts://${s.mqttDomain || 'iotx-eu.meross.com'}:2001`, { clientId: `app:${appId}`, username: uid, password: md5(uid + s.key) });
  const respTopic = `/app/${uid}-${appId}/subscribe`;
  const pending = new Map();
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => { client.end(true); reject(new Error('Meross: timeout (hub spento o offline?)')); }, 8000);
    client.once('error', (e) => { clearTimeout(t); client.end(true); reject(e); });
    client.once('connect', () => { clearTimeout(t); client.subscribe(respTopic); resolve(); });
  });
  client.on('message', (_t, buf) => { const m = JSON.parse(buf.toString()); pending.get(m.header.messageId)?.(m.payload); });
  const request = (uuid, method, namespace, payload) => new Promise((resolve, reject) => {
    const messageId = md5(crypto.randomUUID()), timestamp = Math.floor(Date.now() / 1000);
    const header = { messageId, method, from: respTopic, namespace, payloadVersion: 1, sign: md5(messageId + s.key + timestamp), timestamp, triggerSrc: 'Android', uuid };
    const t = setTimeout(() => { pending.delete(messageId); reject(new Error('Meross: timeout (hub spento o offline?)')); }, 5000);
    pending.set(messageId, (p) => { clearTimeout(t); pending.delete(messageId); resolve(p); });
    client.publish(`/appliance/${uuid}/subscribe`, JSON.stringify({ header, payload }));
  });
  return { request, client, end: () => client.end(true) };
}
// L'hub perde le richieste se ne arrivano molte insieme: le metto in fila su una sola connessione
// condivisa (chiusa dopo 15 s di inattività), con un nuovo tentativo se una richiesta va persa.
let shared = null, idle = null, chain = Promise.resolve();
function drop() { clearTimeout(idle); const c = shared; shared = null; c?.then((x) => x.end(), () => {}); }
function conn() {
  if (!shared) {
    const p = connect();
    shared = p;
    p.then((c) => c.client.once('close', () => { if (shared === p) shared = null; }), () => { if (shared === p) shared = null; });
  }
  clearTimeout(idle); idle = setTimeout(drop, 15000); idle.unref?.();
  return shared;
}
async function request(uuid, method, namespace, payload) {
  for (let i = 0; ; i++) {
    try { return await (await conn()).request(uuid, method, namespace, payload); }
    catch (e) { drop(); if (i >= 1) throw e; }
  }
}
const queued = (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };
const send = (uuid, method, namespace, payload) => queued(() => request(uuid, method, namespace, payload));
const sendMany = (uuid, list) => queued(async () => { for (const [method, namespace, payload] of list) await request(uuid, method, namespace, payload); });

// hubUuid in configurazione: UUID vero, nome dell'hub nell'app, oppure "auto" (se l'account ha un solo hub MSH).
const hubs = new Map();
async function resolveHub(v, s) {
  if (hubs.has(v)) return hubs.get(v);
  const list = (await cloud('/v1/Device/devList', {}, s.token)).filter((d) => /^msh/i.test(d.deviceType || ''));
  const f = list.find((d) => d.uuid === v) || list.find((d) => norm(d.devName) === norm(v)) || (list.length === 1 ? list[0] : null);
  if (!f) throw new Error(list.length ? `Meross: più hub trovati (${list.map((d) => d.devName).join(', ')}), scrivi il nome in hubUuid` : 'Meross: nessun hub MSH trovato nell\'account');
  hubs.set(v, f.uuid);
  return f.uuid;
}

// Fotografia di tutte le valvole dell'hub (cache breve per non aprire 4 connessioni uguali).
const snaps = new Map();
export function snapshot(hubUuid, fresh = false) {
  const c = snaps.get(hubUuid);
  if (!fresh && c && Date.now() - c.at < 10000) return c.p;
  const p = (async () => {
    const s = await login();
    const hub = await resolveHub(hubUuid, s);
    const subs = (await cloud('/v1/Hub/getSubDevices', { uuid: hub }, s.token)).filter((x) => /mts/i.test(x.subDeviceType || ''));
    const ids = subs.map((x) => ({ id: x.subDeviceId }));
    const [all, bat] = await Promise.all([
      send(hub, 'GET', 'Appliance.Hub.Mts100.All', { all: ids }),
      send(hub, 'GET', 'Appliance.Hub.Battery', { battery: ids }).catch(() => ({})),
    ]);
    return subs.map((x) => {
      const d = all.all?.find((a) => a.id === x.subDeviceId);
      const b = bat.battery?.find((a) => a.id === x.subDeviceId);
      const t = d?.temperature;
      return { hub, id: x.subDeviceId, name: x.subDeviceName, online: d?.online?.status === 1, mode: d?.mode?.state, heating: t?.heating === 1, on: d?.togglex?.onoff === 1,
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

// Modalità MTS150 (Appliance.Hub.Mts100.Mode): 0 manuale, 4 programma (gli orari impostati nell'app Meross).
export const MODE_MANUAL = 0, MODE_AUTO = 4;

// cmd: on (bool), target (° oppure 'max'), mode ('auto' = lascia i programmi Meross).
// Impostare una temperatura mette la valvola in manuale; 'on'/'off' da solo NON tocca i programmi.
export async function thermostat(dev, cmd) {
  const v = await find(dev);
  if (!v.online) throw new Error(`Valvola "${v.name}" offline: controlla pile e distanza dall'hub`);
  const list = [];
  if ('on' in cmd) list.push(['SET', 'Appliance.Hub.ToggleX', { togglex: [{ id: v.id, onoff: cmd.on ? 1 : 0 }] }]);
  if (cmd.mode === 'auto') list.push(['SET', 'Appliance.Hub.Mts100.Mode', { mode: [{ id: v.id, state: MODE_AUTO }] }]);
  if ('target' in cmd) {
    const t = cmd.target === 'max' ? v.max : cmd.target;
    list.push(['SET', 'Appliance.Hub.Mts100.Mode', { mode: [{ id: v.id, state: MODE_MANUAL }] }],
      ['SET', 'Appliance.Hub.Mts100.Temperature', { temperature: [{ id: v.id, custom: Math.round(t * 10) }] }]);
  }
  if (list.length) await sendMany(v.hub, list);
  snaps.delete(dev.hubUuid);
}

export async function readThermostat(dev) {
  const v = await find(dev);
  return { current: v.current, target: v.target, on: v.on, online: v.online, batteryMv: v.batteryMv, meMode: v.mode, heating: v.heating };
}
