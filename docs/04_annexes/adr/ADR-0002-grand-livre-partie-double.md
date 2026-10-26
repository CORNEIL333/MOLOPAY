# ADR-0002 · Grand livre en partie double, en ajout seul, soldes dérivés

- **Statut :** Accepté (principe) · détail d'implémentation à valider au lot 02
- **Date :** 26 octobre 2026

## Contexte

La plateforme tient le registre de fonds qui ne lui appartiennent pas (clients, partenaires, financeur). Toute erreur ou altération doit être impossible à masquer et toute correction traçable.

## Décision

1. Comptabilité en partie double ; chaque écriture équilibrée, imposée par la base (contrainte différée).
2. Tables d'écritures en ajout seul : privilèges `UPDATE/DELETE` retirés + déclencheur de refus.
3. Corrections par contre-passation uniquement, sous maker-checker.
4. Soldes dérivés des écritures ; tout cache est vérifié au rapprochement.
5. Montants en `bigint` XAF.
6. Écriture et changement d'état métier dans la même transaction.

## Conséquences

- (+) Auditabilité totale ; invariants vérifiables mécaniquement.
- (−) Les erreurs se corrigent par écritures visibles (voulu).
- (−) Volume de données croissant ; partitionnement par période prévu.
