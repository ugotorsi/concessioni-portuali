# Security Measures Draft

## Stato documento
Bozza tecnica delle misure di sicurezza rilevate e dei rafforzamenti richiesti.
Non rappresenta una certificazione security/compliance definitiva.

## 1. Misure implementate (baseline)
- Autenticazione applicativa reale con NextAuth credentials.
- Ruoli applicativi e controllo capability server-side.
- Segregazione VIEWER_ADSP su perimetro consultivo.
- Middleware centralizzato per route protection e redirect accessi non autorizzati.
- Security headers baseline (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy).
- Rate limiting centralizzato su endpoint sensibili con adapter configurabile (memory/upstash) e risposta 429 standardizzata.
- Baseline auth hardening con lockout temporaneo account su tentativi falliti e reset stato su login valido.
- Messaggi di errore login uniformati per riduzione leakage su validita credenziali/account.
- Campi MFA-ready introdotti nel modello utente (abilitazione futura senza enforcement in questa fase).
- Audit trail con hash chain tamper-evident applicativa.
- Audit evento download PDF e dinieghi autorizzativi.
- Generazione PDF server-side.
- Seed demo controllato per ambiente locale/test.
- Test automatici unit/e2e su auth, ruoli, headers, audit e policy PDF.
- Metadati protocollo/PEC baseline su documenti con warning ricevute incomplete (uso istruttorio, senza integrazione provider PEC).

## 2. Misure da rafforzare prima della produzione
- Applicazione end-to-end password policy su workflow cambio/reset password e rotazione credenziali.
- MFA end-to-end per profili privilegiati.
- Session hardening (timeout, revoke, policy cookie avanzate).
- Completare rollout produzione backend distribuito (Upstash/Redis) con monitoraggio e tuning soglie.
- CSP più restrittiva e tuning policy browser security.
- HSTS in produzione con configurazione TLS robusta.
- Logging infrastrutturale centralizzato e correlabile.
- Alerting e monitoraggio security events.
- Backup cifrati con restore test periodico.
- Cifratura at rest e gestione chiavi.
- Secrets management enterprise.
- CI/CD security controls (SAST, secret scanning, IaC checks).
- Dependency scanning e vulnerability management.
- Penetration test periodico e remediation tracking.

## 3. Limiti noti della baseline
- Fallback in-memory mantenuto solo per dev/demo/CI; per produzione multi-istanza usare backend distribuito configurato via env.
- Audit hash chain applicativo non equivale a conservazione forense WORM.
- Hardening avanzato e posture enterprise ancora in roadmap.
- Metadati protocollo/PEC non equivalgono a protocollazione legale o conservazione a norma.

## 4. Priorità raccomandate
1. IAM hardening: MFA, policy password, session controls.
2. Logging e monitoring: centralizzazione, alert, incident workflow.
3. Data protection: cifratura at rest, backup cifrati, restore testato.
4. Secure delivery: CI/CD security e gestione vulnerabilità continua.


