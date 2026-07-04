# Privacy Gaps and Next Steps

## Stato documento
Matrice preliminare gap privacy/compliance per roadmap pre-produzione.

| Area | Stato attuale | Rischio | Priorita | Intervento consigliato |
| --- | --- | --- | --- | --- |
| DPIA formale | Presente solo draft preliminare | Alto | Alta | Avviare DPIA formale con DPO/ente e approvazione governance |
| Privacy notice | Non formalizzata in documentazione completa | Medio-Alto | Alta | Redigere informative per utenti/interessati e processi correlati |
| DPA/nomine | Da definire per fornitori/sub-responsabili | Alto | Alta | Formalizzare nomine art. 28, clausole e data location |
| Data retention | Bozza policy presente, non attuata | Alto | Alta | Definire tempi ufficiali, job purge, tracciamento esecuzione |
| Data subject rights | Processo non documentato end-to-end | Alto | Alta | Definire workflow richieste accesso/rettifica/cancellazione/opposizione |
| Access log review | Audit presente ma review periodica non formalizzata | Medio | Media | Introdurre review periodica con ownership e KPI |
| Rate limiting distribuito | Adapter Redis-ready presente con fallback memory dev/CI | Medio | Alta | Impostare backend Upstash/Redis in produzione con monitoring, alert e tuning soglie |
| Backup | Strategia non formalizzata nel repo | Alto | Alta | Policy backup cifrati, restore test, RPO/RTO |
| Encryption | Cifratura at rest da confermare | Alto | Alta | Definire standard cifratura at rest/in transit e key management |
| Production hosting | Baseline demo, hardening non completo | Alto | Alta | Definire hosting compliant, segmentazione e controlli runtime |
| Breach response | Procedura data breach non formalizzata | Alto | Alta | Preparare playbook incidenti e registro breach |
| Minimizzazione dati | Presidi parziali, allegati/documenti da governare | Medio-Alto | Alta | Regole di minimizzazione by design e controlli input/upload |
| Export PDF | Policy ruolo presente, governance distribuzione da rafforzare | Medio | Media | Watermark, classificazione, policy invio/archiviazione |
| Audit immutabilita | Hash chain applicativa presente, no WORM | Medio-Alto | Alta | Evolvere verso storage immutabile/SIEM e policy append-only |
| Ruoli/autorizzazioni | RBAC presente, da estendere a casi enterprise | Medio | Media | Revisione periodica ruoli, least privilege, MFA su ruoli critici |
| Test/compliance CI | Baseline test presente, compliance automation limitata | Medio | Media | Integrare test security/compliance e scanning in CI/CD |

## Sequenza operativa suggerita
1. Governance privacy: DPIA formale, nomine, informative.
2. Data lifecycle: retention applicata, minimizzazione, diritti interessati.
3. Security enterprise: cifratura, backup, monitoring, incident response.
4. Assurance continua: test/compliance CI, review periodica controlli.

