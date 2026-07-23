# External AI Audit - From Investor Demo to Real Platform Development

## 1. Titolo
External AI Audit - From Investor Demo to Real Platform Development

## 2. Contesto
Stiamo sviluppando una piattaforma di supporto istruttorio per monitoraggio e governo dei rapporti concessori demaniali/pubblici.

Posizionamento dominio richiesto:
- core comune concessorio;
- verticale A portuale/AdSP;
- verticale B marittima turistico-ricreativa (in evoluzione progressiva).

Abbiamo appena completato e consegnato una cloud demo all investitore.

Da questo momento, l obiettivo non e più una demo narrativa, ma una piattaforma reale, pilotabile presso enti, con roadmap tecnica, legale e commerciale credibile.

Vincolo fondamentale:
- non confondere stato demo con stato produzione.
- non trattare art. 18 L. 84/1994 come base universale piattaforma.

Cornice legale minima da considerare nel giudizio:
- art. 36 cod. nav. base generale concessoria;
- art. 37 cod. nav. procedura comparativa/istanze concorrenti;
- art. 47 cod. nav. regola trasversale decadenza;
- d.l. 400/1993 riferimento centrale per turistico-ricreative;
- art. 12 direttiva 2006/123/CE su risorse scarse, selezione trasparente/imparziale e no proroghe automatiche generalizzate.

## 3. Stato sintetico
Moduli presenti nel repository:
- login/ruoli;
- dashboard;
- concessioni;
- criticità;
- procedimenti;
- documenti;
- audit trail;
- report PDF;
- mappa;
- demo guidata AI;
- business plan;
- cloud Vercel/Neon.

Baseline tecnica verificata in questa assessment session:
- test unit: verdi;
- build: verde;
- check: verde;
- Docker locale non attivo nella sessione (quindi E2E/DB locale non rieseguiti qui).

## 4. Limiti noti
Punti deboli dichiarati e già identificati:
- storage documentale cloud persistente non ancora definitivo;
- legal assistant ancora non pienamente operativo;
- normativa non ancora modulo dinamico completo;
- PEC/protocollo non integrati realmente end-to-end;
- AI server-side non integrata in modo robusto;
- multi-tenant assente;
- compliance privacy in gran parte draft;
- produzione non pronta;
- cloud demo non production.

## 5. Domande principali per l audit
Rispondi in modo severo e pratico alle seguenti domande:
- Qual e lo stato reale del progetto?
- Quali moduli sono demo e quali sono già base di piattaforma?
- Quale dovrebbe essere lo Sprint 1?
- Conviene partire da storage documentale persistente o legal assistant operativo?
- Quali rischi impediscono un pilot presso un ente?
- Quali feature sono indispensabili per un primo pilot?
- Quali feature sono solo scenografiche?
- Quali debiti tecnici vanno chiusi prima di vendere?
- Quali debiti legali/compliance vanno chiusi?
- Quali claim commerciali sono pericolosi?
- Quale roadmap 30/60/90 giorni suggerisci?
- Quanto capitale serve per arrivare a un pilot serio?
- Quale business model appare più credibile?
- Quale architettura tecnica suggerisci?
- Quale strategia dati/documenti suggerisci?
- Come presenteresti il progetto a una PA?
- Come presenteresti il progetto a un investitore?

## 6. Output richiesto all altra AI
Fornisci output strutturato con:
- executive summary;
- voto demo/pilot/production;
- tabella moduli;
- roadmap prioritaria;
- Sprint 1 consigliato;
- rischi critici;
- quick wins;
- cose da tagliare;
- costi stimati;
- piano 90 giorni;
- pitch investitore;
- pitch PA/AdSP;
- raccomandazione finale go/no-go.

## 7. Tono richiesto
Il tono deve essere:
- severo;
- non compiacente;
- pragmatico;
- orientato a prodotto;
- orientato a PA;
- orientato a investitore;
- con indicazione chiara delle debolezze.

## 8. Short prompt version
Usa questa versione breve se serve una richiesta rapida:

"Esegui un audit severo del progetto Concessioni Portuali, già consegnato come cloud demo investitore, da riposizionare come piattaforma modulare di supporto istruttorio con core concessorio comune e verticali normative progressive. Distingui con nettezza moduli demo vs moduli realmente pronti, assegna voto demo/pilot/production, verifica coerenza legale (art. 18 come verticale speciale; art. 36 base generale; art. 37 comparativa; art. 47 trasversale; d.l. 400/1993; art. 12 dir. 2006/123/CE), indica rischi bloccanti, roadmap 30/60/90 giorni, costi stimati, quick wins e raccomandazione finale go/no-go. Mantieni tono pragmatico, non compiacente, orientato a PA e investitore."
