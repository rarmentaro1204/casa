// "Sono uscito di casa": se in questo momento il riscaldamento sta scaldando, manda una notifica
// al telefono e chiede se spegnerlo. Spegnere = scenario «Esco di casa» (valvole a 15°).
// Il segnale di uscita arriva dal telefono (geofence di sistema, vedi hook.mjs, azione «uscito»).
import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { config } from './core.mjs';
import { desired, nextChange, romeNow, getMode, getPolicy, getBoost, setMode, clearBoost } from './heating.mjs';
import { readThermostat } from './meross.mjs';
import { sendToAll } from './push.mjs';

const store = () => getStore('casa');
const MIN_GAP = 10 * 60e3;      // non chiedere due volte nel giro di 10 minuti (il geofence a volte rimbalza)
const VALID_FOR = 3 * 3600e3;   // dopo 3 ore la domanda non ha più senso
const clock = (ms) => romeNow(new Date(ms)).hhmm;

// Il riscaldamento sta scaldando adesso? Torna { on, temp, until, via }.
// - "Scalda ora" attivo: sì.
// - Scenario Inverno con orari dell'app: guarda se adesso si è in una fascia.
// - Scenario Inverno con programmi Meross: l'app non conosce gli orari, quindi legge le valvole
//   (accesa e con obiettivo sopra la temperatura di «Esco di casa»); se non riesce, ripiega sulle fasce.
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
  const want = desired('inverno', romeNow(at), 'app', null, at.getTime());
  const hot = h.group.filter((id) => want[id]?.on && typeof want[id].target === 'number');
  if (!hot.length) return { on: false, why: 'adesso non è una fascia di riscaldamento' };
  return { on: true, temp: h.temp, until: nextChange('inverno', 'app', at)?.at, via: 'orari' };
}

const question = (n) => {
  const t = n.temp != null ? `${String(n.temp).replace('.', ',')}°` : '';
  if (n.via === 'boost') return `Hai lasciato casa e «Scalda ora» è attivo${n.until ? ` fino alle ${n.until}` : ''}. Vuoi spegnere il riscaldamento?`;
  return `Hai lasciato casa e il riscaldamento sta scaldando${t ? ` a ${t}` : ''}${n.until ? ` fino alle ${n.until}` : ''}. Vuoi spegnerlo?`;
};

export async function askHeatingOff() {
  const now = await heatingNow();
  if (!now.on) return { asked: false, reason: now.why };
  const last = await store().get('ask', { type: 'json' });
  if (last && Date.now() - last.at < MIN_GAP) return { asked: false, reason: 'ho già chiesto da pochi minuti' };

  const id = crypto.randomBytes(12).toString('base64url'), text = question(now);
  await store().setJSON('ask', { id, at: Date.now(), text, answered: null });
  const r = await sendToAll({
    title: 'Sei uscito di casa', body: text, tag: 'heating-ask', ask: id, url: `/?ask=${id}`,
    actions: [{ action: 'off', title: 'Spegni' }, { action: 'keep', title: 'Lascia acceso' }],
  });
  if (!r.devices) { await store().delete('ask'); return { asked: false, reason: 'nessun telefono registrato alle notifiche (apri l\'app → Altro → Notifiche)' }; }
  if (!r.sent) return { asked: false, reason: 'le notifiche non sono partite, riprova dall\'app → Altro → Notifiche' };
  return { asked: true, text, ...r };
}

// Info sulla domanda (per la schermata dell'app aperta dalla notifica).
export async function getAsk(id) {
  const a = await store().get('ask', { type: 'json' });
  if (!a || a.id !== id) return { state: 'unknown' };
  if (a.answered) return { state: 'answered', text: a.text, answer: a.answered, message: a.message };
  if (Date.now() - a.at > VALID_FOR) return { state: 'expired', text: a.text };
  return { state: 'open', text: a.text };
}

// answer: 'off' (spegni) oppure 'keep' (lascia com'è). Risponde una volta sola.
export async function answerAsk(id, answer) {
  if (!['off', 'keep'].includes(answer)) throw new Error('Risposta non valida');
  const a = await store().get('ask', { type: 'json' });
  if (!a || a.id !== id) throw new Error('Richiesta non valida o già sostituita');
  if (a.answered) return { ok: true, already: true, message: a.message };
  if (Date.now() - a.at > VALID_FOR) throw new Error('Richiesta scaduta');
  await store().setJSON('ask', { ...a, answered: answer }); // prima di agire: un doppio tocco non ripete i comandi
  let message = 'Ok, lascio il riscaldamento com\'è.';
  if (answer === 'off') {
    await clearBoost();
    const bad = (await setMode('fuori')).filter((x) => x.ok === false).length;
    message = `Riscaldamento abbassato a ${config.heating.away.temp}° («Esco di casa»). Al rientro tocca «Casa inverno».`
      + (bad ? ` Attenzione: ${bad} ${bad === 1 ? 'valvola non ha' : 'valvole non hanno'} risposto.` : '');
  }
  await store().setJSON('ask', { ...a, answered: answer, message });
  return { ok: true, message };
}

// /api/ask — protetto dal codice casuale della domanda (monouso), non dal PIN: lo usa anche il service worker.
export async function runAsk(req) {
  const json = (d, status = 200) => Response.json(d, { status });
  try {
    if (req.method === 'POST') {
      const b = await req.json().catch(() => ({}));
      return json(await answerAsk(String(b.id || ''), b.answer));
    }
    return json(await getAsk(new URL(req.url).searchParams.get('id') || ''));
  } catch (e) { return json({ error: e.message }, 400); }
}
