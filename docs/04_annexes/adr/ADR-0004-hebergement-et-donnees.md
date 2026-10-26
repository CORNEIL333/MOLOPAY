# ADR-0004 · Hébergement et localisation des données

- **Statut :** Ouvert (décision à prendre avec le juriste et le DPO avant le lot 00 en production)
- **Date :** 26 octobre 2026

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

## Décision

À prendre. Tant qu'elle n'est pas prise, **aucune donnée réelle n'est collectée** et les environnements de développement n'utilisent que des données synthétiques.
