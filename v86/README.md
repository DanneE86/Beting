# V85 & Dagens Dubbel – data & systembyggare

Hämtar **endast V85 och Dagens Dubbel (DD)** från [ATG Racinginfo API](https://www.atg.se/services/racinginfo/v1/api/).

**V85:** Körs normalt **lördagar**. Spellistan visar **alla kommande V85** (upp till 4 veckor framåt). Standardval är nästa lördagsomgång. Andelsspel hämtas för V85 när ATG har det.

## Snabbstart

### GUI (localhost)

```bash
npm run dev
# http://localhost:5173/v86

npm run v86:dev
```

### CLI

```bash
npm run v86:build
npm run v86:build -- --game V85_2026-05-30_5_5
npm run v86:build -- --game dd_2026-05-24_32_9
```

## Analysmodell (checklist-v1)

Varje häst/kusk poängsätts mot din checklista utifrån ATG-data:

**Häst:** senaste placeringar, formkurva, distans, spår/starttyp, bana, underlag, klass (EPS), tränare, utrustning, ålder/härstamning, km-tid, restitution (proxy).

**Kusk:** form 2026, trend, bana, favoritleverans, tränarsamarbete.

**Travsport** (`api.travsport.se`) fyller på automatiskt vid analys:
- Senaste 5–6 starter med placering och km-tid
- Formkurva, vilodagar, bana-historik, kusk+häst-statistik

Saknas fortfarande: körstil, marginal/tempo i detalj (delvis via km-tid).

```bash
npm run v86:travsport -- V85_2026-05-30_5_5   # fyll lokal cache
```

Klicka på en häst i GUI för full checklista per avdelning.

## System

- V85: 0,50 kr/rad, standardbudget 600 kr (8 avdelningar)
- DD: 1 kr/rad, standardbudget 50 kr (2 avdelningar)
