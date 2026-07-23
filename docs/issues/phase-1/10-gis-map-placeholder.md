# Add GIS map placeholder or base map module

## Obiettivo
Introdurre una prima rappresentazione geografica o placeholder evolutivo per aree, banchine e occupazioni.

## Motivazione strategica
Rafforza la lettura territoriale dei casi e migliora la comunicazione del rischio su occupazioni difformi.

## Ambito
- Componente mappa base o placeholder evolutivo.
- Collegamento minimo a concessione/ubicazione.
- Fallback testuale in assenza dati geospaziali.

## File coinvolti
- src/app/concessioni/[id]/page.tsx
- src/components/
- src/types/
- docs/GIS_ROADMAP_NOTE.md

## Attività tecniche
- Scegliere approccio placeholder o mappa base.
- Definire modello dati minimo per coordinate/area.
- Integrare rendering in vista concessione.
- Gestire fallback e note limiti modulo.

## Criteri di accettazione
- Visualizzazione geografica minima disponibile o placeholder operativo.
- Nessuna regressione su UI desktop/mobile.
- Dati geospaziali opzionali gestiti senza errori.
- Nota tecnica sui limiti e step successivi pubblicata.

## Test richiesti
- Test rendering con dati geospaziali presenti.
- Test fallback senza dati geospaziali.
- Smoke test responsive base.

## Rischi
- Scelta libreria mappa non allineata ai vincoli futuri.
- Over-engineering anticipato rispetto obiettivo phase-1.

## Dipendenze
- Nessuna bloccante; consigliata in coda alla fase.

## Priorità
Medium

## Complessita
Media-Alta

## Label suggerite
gis, ux, phase-1, priority-medium

