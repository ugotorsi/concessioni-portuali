# Phase 1 Execution Order

## Ordine consigliato delle issue
1. Auth reale (Issue 1)
2. Security middleware/headers/rate limiting (Issue 6)
3. Audit trail (Issue 4)
4. Test baseline Vitest + Playwright (Issue 5)
5. Art. 47 mapping su Criticita (Issue 2)
6. Checklist contraddittorio su Procedimento (Issue 7)
7. PDF server-side professionale (Issue 3)
8. Demo scenarios istituzionali (Issue 9)
9. GDPR/DPIA docs draft (Issue 8)
10. GIS placeholder/modulo base (Issue 10)

## Dipendenze
- Issue 1 -> abilita identity affidabile per audit e policy.
- Issue 6 dipende dal modello auth target (Issue 1) o va allineata subito dopo.
- Issue 4 dipende da identity/sessione affidabile (Issue 1).
- Issue 5 ottiene massimo valore dopo baseline auth/security/audit (Issue 1/6/4).
- Issue 7 e facilitata dal mapping legale (Issue 2).
- Issue 3 produce output finale migliore dopo arricchimento legale/procedimentale (Issue 2/7).
- Issue 9 dipende da disponibilita output report robusti (Issue 3) e flusso procedimentale (Issue 7).
- Issue 8 consolida compliance usando evidenze gia implementate (Issue 1/4/6).
- Issue 10 non blocca altre issue e puo restare in coda.

## Cosa fare prima
- Definire perimetro tecnico minimo della milestone (nessun refactor esteso).
- Stabilire definition of done per ogni issue con acceptance criteria testabili.
- Allineare naming labels GitHub e convenzioni apertura issue.
- Preparare board milestone e collegare dipendenze.

## Cosa non fare prima
- Non introdurre integrazioni esterne complesse non necessarie alla demo istituzionale.
- Non avviare redesign UI ampio fuori perimetro Phase 1.
- Non aprire stream paralleli non prioritari che aumentano rischio regressione.
- Non rimandare i test all'ultima settimana.

## Attivita in parallelo
- In parallelo controllato: Issue 2 e Issue 7 (allineamento dominio legale).
- In parallelo controllato: Issue 8 documentale puo avanzare mentre chiudono Issue 3 e Issue 9.
- In parallelo tardivo: Issue 10 GIS puo procedere senza bloccare stream core.
- Da non parallelizzare troppo: Issue 1, 6, 4 (core security/compliance) per evitare incoerenze.

## Definition of Done finale della Phase 1
Phase 1 e completata quando:
- tutte le 10 issue sono chiuse con criteri di accettazione verificati;
- build/check/test risultano verdi in modo ripetibile;
- demo istituzionale morosita e occupazione difforme e ripetibile end-to-end;
- documentazione compliance minima (GDPR/DPIA draft) e disponibile;
- repository risulta pulito e milestone GitHub chiusa con evidenze tracciate.
