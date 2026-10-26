# ADR-0003 · Intégrité « à preuve d'altération » : chaîne de hachage, Merkle, ancrage

- **Statut :** Accepté (principe)
- **Date :** 26 octobre 2026

## Contexte

Le fondateur attend un niveau de sécurité transactionnelle comparable à celui d'une chaîne de blocs. Les propriétés réellement utiles sont l'immutabilité vérifiable, la preuve d'antériorité et la vérification par des tiers. Le consensus distribué, les jetons et la publication de données ne le sont pas, et seraient incompatibles avec la confidentialité et le cadre réglementaire.

## Décision

1. Chaînage SHA-256 de chaque écriture sur la précédente, sur sérialisation canonique RFC 8785.
2. Lots horaires et clôture quotidienne en arbres de Merkle (RFC 6962/9162), tête signée Ed25519 par clé HSM.
3. Horodatage RFC 3161 de la tête quotidienne.
4. Remise de la tête à au moins deux témoins indépendants (établissement de cantonnement, financeur) avec accusé signé ; ancrage public optionnel de l'**empreinte seule**.
5. Preuves d'inclusion et de cohérence disponibles ; vérificateur indépendant nocturne (ADR-0001).
6. Même mécanisme pour le journal d'audit et le journal d'événements.

## Conséquences

- (+) Toute réécriture de l'historique est détectable par un tiers, même par un administrateur de la base.
- (+) Aucune donnée personnelle ni montant hors du système.
- (−) Gestion de clés en HSM et d'une relation avec une autorité d'horodatage.

## Alternatives écartées

| Alternative | Raison |
|---|---|
| Blockchain publique pour les transactions | Données personnelles exposées, coûts, volatilité, conformité impossible |
| Blockchain privée (consensus entre partenaires) | Complexité et gouvernance multi-acteurs sans bénéfice par rapport aux témoins |
| Base « ledger » propriétaire d'un cloud | Dépendance fournisseur, hébergement hors Cameroun (ADR-0004) |
