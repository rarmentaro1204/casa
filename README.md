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

## Scenari riscaldamento
In prima pagina: **Casa inverno**, **Esco di casa**, **Casa estate** (definiti in `config/devices.json`, sezioni `modes` e `heating`).
- Inverno: Soggiorno, Soggiorno sud e Cucina a 21° Lun–Ven 6–8 e 18–20, Sab–Dom 6–9 e 18–20, spente fuori da queste fasce.
- **Orari valvole**: nel pannello 🌡️ sotto gli scenari si sceglie chi gestisce gli orari. *Impostati nell'app*: li applica questa app. *Programmi dell'app Meross*: in inverno le valvole restano in modalità programma e seguono quelli impostati nell'app Meross, senza che questa app li tocchi.
- Esco di casa: tutte le valvole a 15° (bagno ingresso resta al massimo).
- Estate: le tre valvole si spengono. Esco di casa e Estate restano attivi finché non scegli un altro scenario, quindi al rientro tocca di nuovo "Casa inverno".
- Cameretta e Bagno finestra: sempre a 15° in Inverno e in Esco di casa, spente in Estate.
- Bagno ingresso: sempre acceso al massimo in tutti gli scenari.
- Il controllo parte ogni minuto, ma i comandi partono solo quando serve cambiare stato: le pile delle valvole durano di più.
- Fuso orario: Europe/Rome.

## Controllo valvole
Il pulsante **🔧 Valvole** interroga l'hub Meross e mostra nome, online/offline, temperature e tensione pile di ogni MTS150. Segnala le valvole non trovate e i nomi doppi. Le valvole in `devices.json` si cercano per nome (`subName`), non per ID: dopo aver reinserito le pile e riaccoppiato una valvola il nome resta valido.

## Note importanti
- **Tapparelle**: servono 2 Mini R4 per tapparella (SU e GIÙ). In eWeLink imposta su entrambi "Inching" = tempo di corsa. Il software spegne sempre il verso opposto prima di accendere.
- **Citofono (portone del palazzo)**: SwitchBot Bot attaccato sopra il pulsante apriporta, nessuna modifica all'impianto. Serve SwitchBot Hub per il controllo da remoto. Si apre solo con tocco lungo e APP_PIN, mai da scene/orari.
- **Serratura SwitchBot**: stessa API; variabili `SWITCHBOT_TOKEN` e `SWITCHBOT_SECRET` (app SwitchBot → Profilo → Preferenze → Opzioni sviluppatore). Lo sblocco è solo manuale (tocco lungo + APP_PIN).
- **Meross e Tuya sono sperimentali**: protocolli non ufficiali / codici che variano per modello, non testati su dispositivi reali.
- **Alexa**: collega le skill ufficiali eWeLink e Meross per le routine vocali; non usarla per il portone.
