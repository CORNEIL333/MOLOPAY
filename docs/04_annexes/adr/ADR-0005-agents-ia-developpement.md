# ADR-0005 · Réalisation par harness et agents IA

- **Statut :** Accepté
- **Date :** 26 octobre 2026

## Contexte

Le projet sera réalisé principalement par des agents IA pilotés par le fondateur. Les risques propres aux agents (OWASP Top 10 for Agentic Applications 2026) s'ajoutent aux risques logiciels classiques.

## Décision

1. Format d'instructions : **AGENTS.md** (standard ouvert, Agentic AI Foundation) à la racine, `CLAUDE.md` important `AGENTS.md`.
2. Règles de collaboration, niveaux de risque L0–L3, portes d'approbation et garde-fous techniques : `COLLABORATION_ET_GARDE_FOUS.md`.
3. Séparation implémenteur / vérificateur en sessions distinctes.
4. Aucun accès des agents aux secrets, à la production, aux données réelles ou aux fonds.
5. Toute fusion et tout déploiement restent des actes humains.

## Conséquences

- (+) Vitesse de réalisation, documentation à jour, tests systématiques.
- (−) Charge de revue humaine importante sur les lots L2–L3 ; elle est assumée et non réductible.
