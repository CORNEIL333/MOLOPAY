# ADR-0004 · Hébergement et localisation des données

- **Statut :** Accepté par le fondateur le 24 novembre 2026 (décisions dictées en séance, consignées par Claude) ; à confirmer par le juriste et le DPO
- **Date :** 26 octobre 2026 ; décision le 24 novembre 2026
- **Décideur :** Fondateur

## Contexte

La loi n° 2024/017 (en vigueur depuis le 23 juin 2026) encadre strictement l'hébergement et le transfert de données personnelles hors du Cameroun : niveau de protection équivalent et autorisation préalable de l'autorité. Les partenaires agréés peuvent aussi imposer des exigences de localisation.

## Options

| Option | Avantages | Inconvénients |
|---|---|---|
| A · Hébergement au Cameroun (centre de données local) | Conformité simple, latence faible | Maturité des services managés, KMS/HSM à vérifier |
| B · Cloud international avec autorisation de transfert | Services managés matures (KMS, HSM, sauvegardes) | Autorisation préalable, délais, dépendance |
| C · Hybride : données personnelles et grand livre au Cameroun, traitements non personnels à l'étranger | Équilibre | Complexité d'architecture |

## Critères de décision

Conformité loi 2024/017 et exigences des partenaires ; disponibilité d'un HSM/KMS FIPS 140-3 ; réplication sur deux sites ; coûts ; réversibilité.

## Décision (24 novembre 2026)

1. **Localisation (option C, hybride).** **Toute la base de données au Cameroun** : comptes, KYC, objectifs, grand livre, audit, sauvegardes. Ne part à l'étranger que ce qui ne contient **aucune donnée personnelle** : opérations de signature du KMS/HSM (empreintes et instructions canoniques), pages publiques, outils de développement. Aucune autorisation de transfert n'est donc requise pour le lancement. Le fondateur a d'abord envisagé de ne garder que le KYC au Cameroun ; informé que les comptes, objectifs et le grand livre contiennent aussi des données personnelles (REG-DPD-004) et que la séparation des bases serait un chantier, il a retenu la base entière au Cameroun.
2. **Clés de signature (D5).** **KMS/HSM managé** d'un fournisseur cloud (FIPS 140-3), clés non exportables : grand livre, instructions de règlement, têtes Merkle. Seule l'opération de signature traverse la frontière ; le message signé ne doit contenir aucune donnée personnelle (à imposer par l'adaptateur de signature).
3. **Second site et sauvegardes.** **Un seul site au lancement** + sauvegarde complète quotidienne et journaux de transactions continus, chiffrés, immuables 35 jours, **copiés hors site au Cameroun**. **Écart temporaire accepté** à OPS-BAK-001 (réplication synchrone sur un second site) et à NF-REL-002 (RPO nul) : perte possible des écritures depuis la dernière copie des journaux. À combler avant l'ouverture des versements (D92).
4. **Exploitation.** **Machines virtuelles + conteneurs** (images et composition du lot Q4), PostgreSQL 16 exploité par nous.

## Conséquences

- Choisir un hébergeur au Cameroun offrant : VM, stockage chiffré, sauvegardes immuables, deux emplacements distincts (site + copie hors site), connectivité vers le KMS choisi.
- Choisir le fournisseur KMS/HSM et ouvrir le compte ; adaptateur de signature à écrire (port existant, aucune clé de production en dépôt).
- Exercice de restauration mesuré (Q7) sur la copie hors site ; RPO réel à mesurer et à publier.
- Les environnements de développement restent sur données synthétiques ; aucune donnée réelle avant la mise en service sur l'hébergeur retenu.

## Décision initiale (26 octobre 2026)

À prendre. Tant qu'elle n'est pas prise, **aucune donnée réelle n'est collectée** et les environnements de développement n'utilisent que des données synthétiques.
