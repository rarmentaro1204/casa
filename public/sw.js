// Service worker: riceve le notifiche push (es. «Sei uscito di casa, spengo il riscaldamento?»).
// Non fa cache: l'app si aggiorna sempre da sola.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(d.title || 'Casa', {
    body: d.body || '',
    tag: d.tag,
    renotify: !!d.tag,
    requireInteraction: !!d.ask,
    actions: d.actions || [],   // iOS li ignora: lì si tocca la notifica e si risponde nell'app
    data: d,
  }));
});

async function openApp(url) {
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const w = wins.find((c) => new URL(c.url).origin === self.location.origin);
  if (w) { await w.focus(); w.postMessage({ type: 'open', url }); return; }
  await self.clients.openWindow(url);
}

self.addEventListener('notificationclick', (event) => {
  const d = event.notification.data || {};
  event.notification.close();
  // Bottoni della notifica (Android / desktop): rispondono senza aprire l'app.
  if (d.ask && (event.action === 'off' || event.action === 'keep')) {
    event.waitUntil(
      fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: d.ask, answer: event.action }) })
        .then((r) => r.json())
        .then((r) => self.registration.showNotification('Casa', { body: r.message || r.error || 'Fatto.', tag: 'heating-answer' }))
        .catch(() => self.registration.showNotification('Casa', { body: 'Non sono riuscito a rispondere: apri l\'app.', tag: 'heating-answer', data: { url: d.url } }))
    );
    return;
  }
  event.waitUntil(openApp(d.url || '/'));
});
