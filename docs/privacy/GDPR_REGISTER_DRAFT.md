# GDPR Register Draft

## Stato documento
Bozza operativa per demo istituzionale e valutazione preliminare compliance.
Questo documento non certifica conformità GDPR definitiva.

## 1. Soggetti del trattamento (placeholder)
- Titolare del trattamento: Ente concedente / Amministrazione utilizzatrice (da nominare formalmente).
- Contitolare (eventuale): da verificare in base al modello organizzativo.
- Responsabile del trattamento: fornitore piattaforma/servizi ICT (se applicabile, da nomina contrattuale).
- DPO/RPD: da identificare lato ente e coinvolgere in validazione.

## 2. Finalita del trattamento
- Gestione concessioni demaniali/portuali.
- Monitoraggio obblighi concessori e scadenze.
- Gestione criticità tecnico-giuridiche-economiche.
- Gestione procedimenti istruttori e supporto al contraddittorio.
- Reportistica istruttoria e supporto decisionale interno.
- Audit, sicurezza, prevenzione abusi e accountability.

## 3. Categorie di interessati
- Utenti interni della piattaforma.
- Funzionari/operatori autorizzati.
- Concessionari e referenti.
- Soggetti coinvolti nei procedimenti.

## 4. Categorie di dati trattati
- Dati identificativi (nome, denominazione, codici identificativi).
- Dati di contatto (email, PEC, telefono, sede legale).
- Dati ruolo/account (ruolo applicativo, stato attivo, credenziali hash).
- Dati amministrativi concessori e istruttori.
- Dati economico-contabili (canoni, versamenti, morosita).
- Log tecnici e audit (azione, attore, timestamp, ip, user-agent, hash chain).
- Documentazione istruttoria collegata a concessioni/procedimenti/report.

## 5. Basi giuridiche (ipotesi da validare con ente)
- Adempimento di obbligo legale.
- Esecuzione di compito di interesse pubblico.
- Esercizio di pubblici poteri.
- Legittimo interesse per sicurezza/logging, solo dove coerente e proporzionato.

## 6. Destinatari categorie
- Amministrazione/ente concedente.
- Organi di controllo e autorità competenti.
- Soggetti autorizzati interni.
- Fornitori tecnici nominati secondo art. 28 GDPR.

## 7. Trasferimenti extra UE
- Stato: da verificare.
- Azione richiesta: censimento fornitori/sub-responsabili e data location.

## 8. Conservazione (principio generale)
- Durate puntuali: da definire con ente in base a massimario, obblighi legali e policy interne.
- In ambiente demo: minimizzazione, reset periodico dataset, niente uso di dati reali non necessari.

## 9. Misure tecniche/organizzative rilevate (baseline)
- Autenticazione applicativa con NextAuth (credentials).
- Ruoli e segregazione permessi con policy VIEWER_ADSP consultiva.
- Middleware con route protection.
- Security headers baseline.
- Rate limiting baseline su endpoint sensibili.
- Audit trail con hash chain tamper-evident applicativa.
- Tracciamento download PDF e dinieghi autorizzativi.
- Test automatici unit/e2e su sicurezza e controllo accessi.
- Backup/retention/cifratura at rest: da definire e formalizzare.

## 10. Gap da presidiare prima di produzione
- DPIA formale approvata con DPO/ente.
- Nomine privacy (responsabili/sub-responsabili) e DPA fornitori.
- Policy retention applicata e verificabile.
- Procedure data breach e gestione diritti interessati.
- Hardening produzione (MFA, cifratura, logging infrastrutturale, monitoring).

## 11. Nota di perimetro
Questa bozza e orientata a supportare confronto con PA/AdSP/ente concedente.
La messa in produzione richiede validazione legale-organizzativa e decisione formale del titolare.

