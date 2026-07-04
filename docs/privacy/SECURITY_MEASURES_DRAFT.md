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
- Rate limiting baseline su endpoint sensibili.
- Audit trail con hash chain tamper-evident applicativa.
- Audit evento download PDF e dinieghi autorizzativi.
- Generazione PDF server-side.
- Seed demo controllato per ambiente locale/test.
- Test automatici unit/e2e su auth, ruoli, headers, audit e policy PDF.

## 2. Misure da rafforzare prima della produzione
- Password policy piu rigorosa e rotazione credenziali.
- MFA per profili privilegiati.
- Session hardening (timeout, revoke, policy cookie avanzate).
- Rate limiting distribuito (Redis/Upstash o equivalente).
- CSP piu restrittiva e tuning policy browser security.
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
- Rate limiting in-memory adeguato a demo/singola istanza, non a cluster produzione.
- Audit hash chain applicativo non equivale a conservazione forense WORM.
- Hardening avanzato e posture enterprise ancora in roadmap.

## 4. Priorita raccomandate
1. IAM hardening: MFA, policy password, session controls.
2. Logging e monitoring: centralizzazione, alert, incident workflow.
3. Data protection: cifratura at rest, backup cifrati, restore testato.
4. Secure delivery: CI/CD security e gestione vulnerabilita continua.
