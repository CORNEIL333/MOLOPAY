# ADR-0004 · Hébergement et localisation des données

- **Statut :** Accepté par le fondateur le 24 novembre 2026, **révisé le 25 novembre 2026** (option B, décisions dictées en séance, consignées par Claude) ; à confirmer par le juriste et le DPO
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

## Décision révisée (25 novembre 2026) — en vigueur

Après vérification des hébergeurs camerounais, jugés pas assez sûrs, le fondateur décide : « la KYC et tout le reste devra être hébergé et ultra crypté à l'étranger, pour le moment ».

1. **Localisation (option B).** Toute la plateforme à l'étranger chez **AWS** : base de données (comptes, KYC, objectifs, grand livre, audit), serveurs, sauvegardes. **Région : Europe – Paris (eu-west-3)**, appliquée par défaut faute de choix explicite (cadre RGPD, meilleur argument de « niveau de protection équivalent ») — **à confirmer par le fondateur**.
2. **Clés (D5) : AWS KMS**, dans la même région ; clés non exportables (HSM FIPS). Ed25519 pris en charge (`ECC_NIST_EDWARDS25519`, `ED25519_SHA_512`) pour le grand livre, les instructions et les têtes Merkle.
3. **Chiffrement renforcé (« ultra crypté »)** :
   - transport : TLS 1.3 uniquement, HSTS (SEC-CRY-001) ;
   - disques et volumes de la base : chiffrés par clé KMS gérée par nous (pas la clé par défaut du fournisseur) ;
   - sauvegardes : chiffrées par une clé KMS distincte, immuables 35 jours ;
   - **chiffrement applicatif par enveloppe** des champs sensibles (numéro de téléphone, nom légal, données KYC) avec des clés KMS (SEC-CRY-002) : un accès à la base ou à une sauvegarde ne révèle pas ces champs en clair ; recherche par empreinte à clé (HMAC) ;
   - accès aux clés journalisé (CloudTrail), réservé aux rôles de l'application ; aucune clé en dépôt.
4. **Sauvegardes :** un site (une région) + **copie hors site dans une seconde région AWS**, chiffrée ; écart temporaire maintenu à OPS-BAK-001 / NF-REL-002 (RPO non nul) jusqu'aux versements.
5. **Exploitation :** machines virtuelles (EC2) + conteneurs, PostgreSQL 16 exploité par l'équipe (décision du 24 novembre inchangée).

**Risque juridique signalé au fondateur (non tranché par lui à ce jour).** Selon les sources consultées, la loi n° 2024/017 (REG-DPD-004) soumet l'hébergement de données personnelles hors du Cameroun à un niveau de protection équivalent et à l'**autorisation préalable** de l'Autorité de protection des données ; le chiffrement ne supprime pas cette exigence ; sanctions jusqu'à 1 milliard FCFA. Le texte officiel et l'état du décret d'application restent à vérifier par le juriste. **À faire :** déposer la demande d'autorisation (juriste, DPO) ; la collecte de données réelles avant l'accord est une décision du fondateur, non prise à ce jour.

## Décision du 24 novembre 2026 (remplacée le 25 novembre pour la localisation)


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
