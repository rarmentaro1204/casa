// Presenza in casa (più telefoni) e domande sul riscaldamento.
// Ogni telefono, con le automazioni di Comandi «Parto» / «Arrivo», chiama il link con il proprio nome (chi=…).
// - Esce l'ultimo e il riscaldamento sta scaldando → a tutti: «Lo spengo?» (spegni = «Esco di casa»).
// - Rientra qualcuno e il riscaldamento non scalda → a tutti: «Lo riaccendo?».
// Basta che risponda uno; agli altri la notifica viene sostituita con l'esito.
import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { config } from './core.mjs';
import { desired, nextChange, romeNow, getMode, getPolicy, getBoost, setMode, setBoost, clearBoost } from './heating.mjs';
import { readThermostat } from './meross.mjs';
import { sendToAll } from './push.mjs';

const store = () => getStore('casa');
const MIN_GAP = 10 * 60e3;      // la stessa domanda non si ripete nel giro di 10 minuti (il geofence a volte rimbalza)
const VALID_FOR = 3 * 3600e3;   // dopo 3 ore la domanda non ha più senso
const BOOST_MIN = 60;
const clock = (ms) => romeNow(new Date(ms)).hhmm;
const deg = (t) => `${String(t).replace('.', ',')}°`;
const tail = (r) => { const n = (r || []).filter((x) => x.ok === false).length; return n ? ` Attenzione: ${n} ${n === 1 ? 'valvola non ha' : 'valvole non hanno'} risposto.` : ''; };

export const people = () => (config.people?.length ? config.people : [{ id: 'casa', name: 'Casa' }]);
const person = (id) => {
  const list = people();
  const p = id ? list.find((x) => x.id === id) : list.length === 1 ? list[0] : null;
  if (!p) throw new Error(id ? `Persona sconosciuta: ${id}` : `Manca chi=… nel link (${list.map((x) => x.id).join(', ')})`);
  return p;
};

// ---------------------------------------------------------------- presenza
export async function getPresence() {
  const p = (await store().get('presence', { type: 'json' })) || {};
  return people().map((x) => ({ id: x.id, name: x.name, home: p[x.id]?.home ?? null, at: p[x.id]?.at ?? null }));
}
export async function setPresence(id, home) {
  const who = person(id), p = (await store().get('presence', { type: 'json' })) || {};
  p[who.id] = { home: !!home, at: Date.now() };
  await store().setJSON('presence', p);
  return getPresence();
}

// ---------------------------------------------------------------- sta scaldando adesso?
// - "Scalda ora" attivo: sì.
// - Inverno con orari dell'app: si è in una fascia?
// - Inverno con programmi Meross: legge le valvole (accesa e obiettivo sopra la temperatura di «Esco di casa»);
//   se non riesce a leggerle ripiega sulle fasce dell'app.
// - Esco di casa, Estate o nessuno scenario: no.
export async function heatingNow(at = new Date(), live = readThermostat) {
  const [mode, policy, boost] = await Promise.all([getMode(), getPolicy(), getBoost()]);
  const h = config.heating;
  if (boost && boost.until > at.getTime()) return { on: true, temp: boost.temp, until: clock(boost.until), via: 'boost' };
  if (mode !== 'inverno') return { on: false, why: mode ? `è attivo lo scenario «${config.modes.find((m) => m.id === mode)?.name || mode}», non c'è niente da spegnere` : 'nessuno scenario di riscaldamento attivo' };
  if (policy === 'meross') {
    const vs = await Promise.all(h.group.map((id) => live(config.devices.find((d) => d.id === id)).catch(() => null)));
    if (vs.some(Boolean)) {
      const hot = vs.filter((v) => v && v.online && v.on && v.target > h.away.temp);
      return hot.length ? { on: true, temp: Math.max(...hot.map((v) => v.target)), via: 'meross' } : { on: false, why: 'le valvole adesso non stanno scaldando' };
    }
  }
  if (!slotNow(at)) return { on: false, why: 'adesso non è una fascia di riscaldamento' };
  return { on: true, temp: h.temp, until: nextChange('inverno', 'app', at)?.at, via: 'orari' };
}
const slotNow = (at) => { const w = desired('inverno', romeNow(at), 'app', null, at.getTime()); return config.heating.group.some((id) => w[id]?.on && typeof w[id].target === 'number'); };

// ---------------------------------------------------------------- domande
async function ask(kind, { title, text, choices }) {
  const gaps = (await store().get('askGap', { type: 'json' })) || {};
  if (gaps[kind] && Date.now() - gaps[kind] < MIN_GAP) return { asked: false, reason: 'ho già chiesto da pochi minuti' };
  const id = crypto.randomBytes(12).toString('base64url');
  await store().setJSON('ask', { id, kind, at: Date.now(), title, text, choices, answered: null });
  const r = await sendToAll({ title, body: text, tag: 'heating-ask', ask: id, url: `/?ask=${id}`, actions: choices.slice(0, 2).map((c) => ({ action: c.id, title: c.label })) });
  if (!r.devices) { await store().delete('ask'); return { asked: false, reason: 'nessun telefono registrato alle notifiche (apri l\'app → Altro → Notifiche e presenza)' }; }
  if (!r.sent) return { asked: false, reason: 'le notifiche non sono partite, riprova dall\'app → Altro → Notifiche e presenza' };
  gaps[kind] = Date.now(); await store().setJSON('askGap', gaps);
  return { asked: true, text, ...r };
}

export async function personLeft(id) {
  const ps = await setPresence(id, false);
  const still = ps.filter((p) => p.home === true);
  if (still.length) return { asked: false, reason: `in casa c'è ancora ${still.map((p) => p.name).join(' e ')}` };
  const now = await heatingNow();
  if (!now.on) return { asked: false, reason: now.why };
  const who = ps.length > 1 ? 'Non c\'è più nessuno in casa' : 'Hai lasciato casa';
  const text = now.via === 'boost'
    ? `${who} e «Scalda ora» è attivo${now.until ? ` fino alle ${now.until}` : ''}. Spengo il riscaldamento?`
    : `${who} e il riscaldamento sta scaldando${now.temp != null ? ` a ${deg(now.temp)}` : ''}${now.until ? ` fino alle ${now.until}` : ''}. Lo spengo?`;
  return ask('off', { title: ps.length > 1 ? 'Casa vuota' : 'Hai lasciato casa', text, choices: [{ id: 'off', label: 'Spegni' }, { id: 'keep', label: 'Lascia acceso' }] });
}

export async function personArrived(id) {
  const who = person(id);
  await setPresence(who.id, true);
  const [mode, policy] = await Promise.all([getMode(), getPolicy()]);
  if (mode !== 'inverno' && mode !== 'fuori') return { asked: false, reason: mode ? 'in estate non chiedo' : 'nessuno scenario di riscaldamento attivo' };
  if ((await heatingNow()).on) return { asked: false, reason: 'il riscaldamento sta già scaldando' };
  const at = new Date(), next = policy === 'app' ? nextChange('inverno', 'app', at)?.at : null;
  const boostLbl = 'Scalda ora (1 ora)';
  let text, choices;
  if (mode === 'fuori') {
    const st = `Il riscaldamento è su «Esco di casa» (${deg(config.heating.away.temp)})`;
    if (policy === 'app' && slotNow(at)) {
      text = `${who.name} è a casa. ${st} ma adesso è in fascia di riscaldamento. Lo riaccendo?`;
      choices = [{ id: 'sched', label: 'Riaccendi' }, { id: 'keep', label: 'Lascia così' }];
    } else {
      text = `${who.name} è a casa. ${st}. Lo riaccendo?`;
      choices = [{ id: 'boost', label: boostLbl }, { id: 'sched', label: next ? `Solo orari (dalle ${next})` : policy === 'meross' ? 'Riprendi i programmi Meross' : 'Riprendi gli orari' }, { id: 'keep', label: 'Lascia così' }];
    }
  } else {
    text = `${who.name} è a casa e il riscaldamento è spento${next ? ` fino alle ${next}` : ''}. Lo riaccendo?`;
    choices = [{ id: 'boost', label: boostLbl }, { id: 'keep', label: 'No' }];
  }
  return ask('on', { title: `${who.name} è a casa`, text, choices });
}

// ---------------------------------------------------------------- risposte
export async function getAsk(id) {
  const a = await store().get('ask', { type: 'json' });
  if (!a || a.id !== id) return { state: 'unknown' };
  if (a.answered) return { state: 'answered', title: a.title, text: a.text, answer: a.answered, message: a.message };
  if (Date.now() - a.at > VALID_FOR) return { state: 'expired', title: a.title, text: a.text };
  return { state: 'open', title: a.title, text: a.text, choices: a.choices || [{ id: 'off', label: 'Spegni' }, { id: 'keep', label: 'Lascia acceso' }] };
}

// Risponde una volta sola; il primo che risponde decide.
export async function answerAsk(id, answer) {
  const a = await store().get('ask', { type: 'json' });
  if (!a || a.id !== id) throw new Error('Richiesta non valida o già sostituita');
  if (a.answered) return { ok: true, already: true, message: a.message };
  if (!(a.choices || [{ id: 'off' }, { id: 'keep' }]).some((c) => c.id === answer)) throw new Error('Risposta non valida');
  if (Date.now() - a.at > VALID_FOR) throw new Error('Richiesta scaduta');
  await store().setJSON('ask', { ...a, answered: answer }); // prima di agire: un doppio tocco non ripete i comandi
  let message;
  if (answer === 'off') {
    await clearBoost();
    message = `Riscaldamento abbassato a ${deg(config.heating.away.temp)} («Esco di casa»).${tail(await setMode('fuori'))}`;
  } else if (answer === 'sched') {
    message = `«Casa inverno» riattivato: si torna agli orari.${tail(await setMode('inverno'))}`;
  } else if (answer === 'boost') {
    const r1 = (await getMode()) !== 'inverno' ? await setMode('inverno') : [];
    message = `Scaldo la zona giorno a ${deg(config.heating.temp)} per un'ora, poi tornano gli orari.${tail([...r1, ...await setBoost({ ids: 'zona', minutes: BOOST_MIN })])}`;
  } else message = a.kind === 'on' ? 'Ok, lascio così.' : 'Ok, lascio il riscaldamento acceso.';
  await store().setJSON('ask', { ...a, answered: answer, message });
  // Sostituisce la domanda sugli altri telefoni con l'esito (stesso tag).
  await sendToAll({ title: 'Casa', body: message, tag: 'heating-ask', url: '/' }, { ttl: 600 }).catch(() => {});
  return { ok: true, message };
}

// /api/ask — protetto dal codice casuale della domanda (monouso), non dal PIN: lo usa anche il service worker.
export async function runAsk(req) {
  const json = (d, status = 200) => Response.json(d, { status });
  try {
    if (req.method === 'POST') { const b = await req.json().catch(() => ({})); return json(await answerAsk(String(b.id || ''), b.answer)); }
    return json(await getAsk(new URL(req.url).searchParams.get('id') || ''));
  } catch (e) { return json({ error: e.message }, 400); }
}
