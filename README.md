# Casa

Web app per iPad (PWA) per tapparelle e luci Sonoff Mini R4, termovalvole Meross MTS150, climatizzatori Zephir e portone del citofono. Gira su Netlify: l'iPad è solo il pannello.

Prova l'interfaccia in locale: `node demo-server.mjs` → http://localhost:8888/?demo

## Attivazione
1. `config/devices.json`: inserisci gli ID reali dei tuoi dispositivi.
2. Su Netlify imposta queste variabili d'ambiente:
   - `APP_PIN` (obbligatorio per il portone)
   - `EWELINK_APPID`, `EWELINK_SECRET` (account sviluppatore su dev.ewelink.cc), `EWELINK_EMAIL`, `EWELINK_PASSWORD`, `EWELINK_REGION=eu`
   - `MEROSS_EMAIL`, `MEROSS_PASSWORD`
   - `TUYA_ACCESS_ID`, `TUYA_ACCESS_SECRET`, `TUYA_REGION=eu` (solo se i Zephir usano Smart Life/Tuya)
3. Deploy, poi su iPad: Safari → Condividi → Aggiungi a Home.

## Note importanti
- **Tapparelle**: servono 2 Mini R4 per tapparella (SU e GIÙ). In eWeLink imposta su entrambi "Inching" = tempo di corsa. Il software spegne sempre il verso opposto prima di accendere.
- **Portone**: Mini R4 con Inching 1-2 s in parallelo al pulsante apriporta. Verifica la tensione dell'impianto citofonico (un Mini R4 non è un contatto pulito: in caso di dubbi usa un modulo a contatto libero) e fai fare il collegamento a un elettricista. L'app lo apre solo con tocco lungo e APP_PIN, mai da scene/orari.
- **Meross e Tuya sono sperimentali**: protocolli non ufficiali / codici che variano per modello, non testati su dispositivi reali.
- **Alexa**: collega le skill ufficiali eWeLink e Meross per le routine vocali; non usarla per il portone.
