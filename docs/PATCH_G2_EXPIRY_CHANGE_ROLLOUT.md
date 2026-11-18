# Patch G2: rollout cambio scadenza

La scrittura controllata di `Concessione.dataScadenza` e disabilitata per default tramite
`CONCESSIONE_EXPIRY_CHANGE_ENABLED=false`.

## Sequenza operativa

1. Mantenere il flag disabilitato.
2. Fermare tutte le vecchie istanze web capaci di scrivere e tutti i worker legacy; attendere la fine delle lease e delle transazioni attive.
3. Applicare la migration additiva `20260920_patch_g2_concessione_expiry_generation`.
4. Distribuire web e worker dual-stack V1/V2 con il flag ancora disabilitato.
5. Verificare che non restino istanze web o worker legacy.
6. Abilitare `CONCESSIONE_EXPIRY_CHANGE_ENABLED=true` solo sul web compatibile.

Le concessioni esistenti restano in generation `0` e continuano sul contratto V1. Le nuove
concessioni e ogni scadenza modificata usano una generation positiva e il contratto V2.

## Rollback

Dopo la prima generation positiva non distribuire codice lifecycle legacy. Disabilitare subito
il writer, mantenere schema e supporto V1/V2 e procedere con un roll-forward correttivo.