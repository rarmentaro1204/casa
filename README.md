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

## Funzioni smart
- **Suggerimenti** (pagina Casa): luci o climatizzatore accesi mentre sei fuori, porta aperta di notte, clima e termosifone accesi insieme, stanza lontana dalla temperatura impostata, freddo fuori orario, tramonto con tapparelle su, notte gelida con "Casa estate". Ogni suggerimento ha un'azione con un tocco e si può nascondere per 3 ore.
- **Scalda ora**: accende la zona giorno (o una sola valvola) a 21° per un'ora, poi tornano gli orari dello scenario. Funziona in qualsiasi scenario.
- **Siri e automazioni** (Altro → Siri e automazioni): link per l'app Comandi dell'iPhone/iPad, per la voce ("Ehi Siri, esco di casa") o per le automazioni. Protetti da un token segreto rigenerabile; non aprono mai porta e portone.
- **Presenza e riscaldamento** (Altro → Notifiche e presenza): ogni telefono (persone in `config/devices.json`, sezione `people`) ha due link con il proprio nome, per le automazioni di Comandi **Parto** e **Arrivo** su Casa (zona di iOS, sempre attiva anche con l'app chiusa).
  - Escono **tutti** e il riscaldamento sta scaldando (fasce dell'app, programmi Meross letti dalle valvole, o «Scalda ora») → notifica a tutti: «Lo spengo?» → *Spegni* = scenario «Esco di casa».
  - **Rientra qualcuno** e il riscaldamento è spento (fuori orario o «Esco di casa»; non in Estate) → notifica a tutti: «Lo riaccendo?» → *Scalda ora (1 ora)*, *Solo orari* (torna «Casa inverno») o *Lascia così*.
  - Basta che risponda uno: sugli altri telefoni la notifica è sostituita dall'esito. La stessa domanda non si ripete per 10 minuti; vale 3 ore. Chi è in casa si vede (e si corregge) nello stesso pannello.
  - Notifiche: su iPhone l'app va aggiunta alla Home (iOS 16.4+), poi si attivano dal pannello. Su Android si risponde anche dai bottoni della notifica. Chiavi VAPID generate da sole nel Blob store (o variabili `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`).
- **Meteo** (Open-Meteo, senza chiave): temperatura esterna e minima della notte; si attiva con la posizione del dispositivo.

## Controllo valvole
Il pulsante **🔧 Valvole** interroga l'hub Meross e mostra nome, online/offline, temperature e tensione pile di ogni MTS150. Segnala le valvole non trovate e i nomi doppi. Le valvole in `devices.json` si cercano per nome (`subName`), non per ID: dopo aver reinserito le pile e riaccoppiato una valvola il nome resta valido.

## Note importanti
- **Tapparelle**: servono 2 Mini R4 per tapparella (SU e GIÙ). In eWeLink imposta su entrambi "Inching" = tempo di corsa. Il software spegne sempre il verso opposto prima di accendere.
- **Citofono (portone del palazzo)**: SwitchBot Bot attaccato sopra il pulsante apriporta, nessuna modifica all'impianto. Serve SwitchBot Hub per il controllo da remoto. Si apre solo con tocco lungo e APP_PIN, mai da scene/orari.
- **Serratura SwitchBot**: stessa API; variabili `SWITCHBOT_TOKEN` e `SWITCHBOT_SECRET` (app SwitchBot → Profilo → Preferenze → Opzioni sviluppatore). Lo sblocco è solo manuale (tocco lungo + APP_PIN).
- **Meross e Tuya sono sperimentali**: protocolli non ufficiali / codici che variano per modello, non testati su dispositivi reali.
- **Alexa**: collega le skill ufficiali eWeLink e Meross per le routine vocali; non usarla per il portone.
