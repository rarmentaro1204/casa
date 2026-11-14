// Notifiche push (Web Push) verso i telefoni che hanno installato l'app.
// Le chiavi VAPID si generano da sole la prima volta e restano nel Blob store; se preferisci
// puoi fissarle con le variabili VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (e VAPID_SUBJECT).
import webpush from 'web-push';
import { getStore } from '@netlify/blobs';

const store = () => getStore('casa');
const MAX_DEVICES = 8;

async function vapid() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  let k = await store().get('vapid', { type: 'json' });
  if (!k) { k = webpush.generateVAPIDKeys(); await store().setJSON('vapid', k); }
  return k;
}
export const publicKey = async () => (await vapid()).publicKey;

const list = async () => (await store().get('push', { type: 'json' })) || [];

export async function subscribe(sub, ua = '') {
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) throw new Error('Iscrizione non valida');
  if (!/^https:\/\//.test(sub.endpoint)) throw new Error('Endpoint non valido');
  const all = (await list()).filter((s) => s.sub.endpoint !== sub.endpoint);
  all.push({ sub, ua: String(ua).slice(0, 120), at: Date.now() });
  await store().setJSON('push', all.slice(-MAX_DEVICES));
  return all.length;
}

export async function unsubscribe(endpoint) {
  const all = await list(), keep = all.filter((s) => s.sub.endpoint !== endpoint);
  if (keep.length !== all.length) await store().setJSON('push', keep);
  return keep.length;
}

export const devices = async () => (await list()).length;

// Manda a tutti i dispositivi registrati. Toglie da sola le iscrizioni scadute (404/410).
export async function sendToAll(payload, { ttl = 3600 } = {}) {
  const subs = await list();
  if (!subs.length) return { devices: 0, sent: 0, failed: 0 };
  const k = await vapid();
  const opts = { vapidDetails: { subject: process.env.VAPID_SUBJECT || process.env.URL || 'https://casa.netlify.app', publicKey: k.publicKey, privateKey: k.privateKey }, TTL: ttl, urgency: 'high' };
  const res = await Promise.allSettled(subs.map((s) => webpush.sendNotification(s.sub, JSON.stringify(payload), opts)));
  const gone = (r) => r.status === 'rejected' && [404, 410].includes(r.reason?.statusCode);
  const keep = subs.filter((_, i) => !gone(res[i]));
  if (keep.length !== subs.length) await store().setJSON('push', keep);
  res.forEach((r) => { if (r.status === 'rejected' && !gone(r)) console.error('push', r.reason?.statusCode, r.reason?.body || r.reason?.message); });
  const sent = res.filter((r) => r.status === 'fulfilled').length;
  return { devices: subs.length, sent, failed: subs.length - sent };
}
