# Studio Basso su Windows

1. Nella cartella che contiene `ChordMiniApp` e `Brani`, fai doppio clic su **Avvia Studio Basso.cmd**.
2. Si apre `http://127.0.0.1:3207/basso` nel browser. Se riconoscibili dal nome, il primo mix e il relativo stem `Bass` in `Brani` sono preselezionati. All'avvio viene analizzato solo il mix. Per altri brani scegli i file e premi **1. Analizza il brano con ChordMini**.
3. Quando vedi gli accordi, premi **2. Aggiungi la linea di basso**. Scegli **TAB**, **Pentagramma** o **Nascondi**. Nella TAB hai due battute per riga; usa **Spazio TAB** per allargarle. Clicca una battuta per raggiungerla, attiva il loop e usa i cursori **Mix originale** e **Stem di basso** per decidere quanto sentirne. Puoi correggere le note cliccandole nella TAB; le modifiche si conservano nello stesso profilo del browser.
4. Sotto le corde, la TAB mostra durate, pause e legature stimate. Il viola marca la nota target del basso: la fondamentale su `C`, il Mi su `C/E`, in qualunque ottava. La diteggiatura tende a tenere la mano nella stessa zona e preferisce un tasto vicino alla corda a vuoto quando non obbliga a spostarsi.
5. **Mostra i gradi dell’accordo** aggiunge i gradi cromatici rispetto alla fondamentale (`3` sul Mi di `C/E`); il viola continua a indicare la nota target anche con l’opzione spenta.
6. Per controllare le note, metti in loop alcune battute e alterna **A · Basso registrato** e **B · Basso trascritto**. B è un basso sintetico che suona la TAB ritmica (un solo attacco per le note legate), con la stessa velocità e lo stesso loop. Se una nota breve non è un nuovo attacco, cliccala e scegli **Unisci alla precedente**: mantiene l’altezza precedente e la prolunga. L’unione si può annullare subito e viene conservata nel progetto.

## Progetti ed esportazione

- **Salva progetto** e **Salva copia** scaricano un file `.studiobasso.json`, senza audio. **Apri progetto** ricarica la griglia, il basso, le modifiche e le impostazioni senza nuova analisi. Se gli audio non sono in `Brani` con lo stesso nome, selezionali manualmente senza ricalcolare il progetto.
- **Ripristina il basso automatico** elimina le sole correzioni a note e diteggiature. **Nuovo progetto** permette di passare a un altro brano.
- In **Stampa / PDF** scegli intervallo e contenuto: sigle, diagrammi chitarra, TAB o pentagramma. Per stampare anche il testo, importa un `.lrc` sincronizzato (gli accordi sono associati alla riga, non alla parola). Nella stessa anteprima puoi scaricare l’intervallo in MIDI o MusicXML.

Studio Basso si trova in `/basso`. Il link **Torna a ChordMini** apre le schermate originali; per i loro servizi, modelli opzionali e chiavi segui la configurazione nel README principale. Non sono requisiti per Studio Basso.

Il server è accessibile solo da questo computer. La griglia del mix usa i modelli predefiniti di ChordMini, **Chord-CNN-LSTM** (vocabolario `full`) e **Madmom**, e il suo calcolo delle battute. Il basso è una trascrizione indipendente, di una nota alla volta, derivata dallo stem. La diteggiatura è proposta, non rilevata dalla registrazione. Se il primo accento non coincide con quello che ascolti, puoi passare alla griglia manuale e spostarlo. Per sincronizzare più file, esportali dallo stesso inizio, senza rimuovere il silenzio introduttivo. Per l'analisi sono accettati WAV, MP3, FLAC e OGG fino a 160 MB ciascuno.

Prerequisiti per una nuova installazione: Node.js (20.9+), npm, Python 3.12 x64, Git e Visual Studio con strumenti C++ (solo per compilare Madmom se il pacchetto non è già presente). Il collegamento installa le dipendenze Python e Node con Internet, se mancanti. Non richiede Docker, Firebase o un account per Studio Basso. I log e i risultati dell'analisi sono in `ChordMiniApp/.cache/local-bass`.

Per una prima prova su un altro PC, clona il repository con i sottoprogetti, metti `Brani` accanto alla cartella del clone e usa **`Avvia Studio Basso.cmd` dentro il repository**. Trasferisci a parte i file `.studiobasso.json` e i relativi audio. Non copiare `node_modules`, `.venv-bass`, `.next`, cache o file `.env` contenenti credenziali.
