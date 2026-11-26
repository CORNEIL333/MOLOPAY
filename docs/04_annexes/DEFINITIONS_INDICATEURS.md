# Définitions des indicateurs produits (F-REP-002)

> Exigence F-REP-002 : « Indicateurs produits : volume, objectifs ouverts, taux d'objectifs à 100 %, délai de remise, impayés B, marge par commande, par univers et par ville. Définitions écrites ; calculs testés. »
>
> Ce document fixe les définitions **avant** tout calcul. Chaque indicateur se calcule en lecture seule, à partir des seules données de la base (grand livre, historique d'état des objectifs, règlements), jamais à partir de valeurs saisies. Les montants sont des entiers XAF. Une période est un intervalle `[début, fin[` en heure de Douala ; un indicateur « à date » est lu à l'instant `fin`.
>
> Les choix marqués **(D119)** attendent la décision du fondateur ; l'option appliquée en attendant est la plus prudente : ne rien attribuer qu'on ne sait pas attribuer.

## 1. Dimensions

### Univers

- **Modèle A** (`SAVE_THEN_BUY`) : univers de la version d'offre figée dans l'accord (`catalog.offer_version.universe`) : `ESSENTIALS`, `TECHNOLOGY`, `HOUSING` ou `MOBILITY`.
- **Modèle C** (`PLANNED_EXPENSE`) : un objectif C n'a pas d'offre, donc pas d'univers enregistré. **En attendant D119 :** case à part `PLANNED_EXPENSE (hors univers)`. Option proposée : univers déduit de la catégorie du bénéficiaire (bailleur, agence, vendeur de matériaux ou de terrain → `HOUSING` ; école → à décider).
- **Modèle B** : non ouvert dans le code (aucun accord B) ; aucune case.

### Ville

Aujourd'hui, aucun objectif ne porte de ville : une offre peut couvrir Yaoundé **et** Douala, et un objectif C n'en a pas.

**En attendant D119 :**
- objectif A dont l'offre ne couvre qu'une ville → cette ville ;
- tout autre objectif → case `NON_ATTRIBUÉE`.

Aucune répartition au prorata ni supposition n'est faite.

Option proposée (D119) : enregistrer à la création de l'objectif la ville choisie par le client (l'application la demande déjà), figée comme le prix (I-11). Cela demande une migration et une évolution du contrat. Les objectifs créés avant resteraient `NON_ATTRIBUÉE`.

## 2. Indicateurs

| Indicateur | Définition exacte | Source | Unité |
|---|---|---|---|
| **Volume** | Somme des versements **confirmés** sur la période. Un versement compte à la date de sa confirmation au grand livre (crédit du compte client) ; les contre-passations de la période se déduisent. | Grand livre (écritures de versement confirmé) | XAF |
| **Objectifs ouverts** | Nombre d'objectifs dont le dernier état, à la date `fin`, est `ACTIVE` (verrouillés compris). Les objectifs gelés, en litige, financés, remis, réglés, annulés ou remboursés ne sont pas ouverts. | `agreements.status_event` | nombre |
| **Taux d'objectifs à 100 %** | Parmi les objectifs **activés** pendant la période (transition `DRAFT → ACTIVE`), part de ceux qui ont atteint `FUNDED` à la date `fin`, quel que soit leur état ensuite. Un objectif activé puis annulé avant `FUNDED` compte au dénominateur seulement. Le taux n'est pas publié si le dénominateur vaut 0. | `agreements.status_event` | pour-cent, une décimale, arrondi au plus proche |
| **Délai de remise** (modèle A) | Pour chaque objectif passé à `HANDED_OVER` pendant la période : durée entre son passage à `FUNDED` et son passage à `HANDED_OVER`. Publiés : nombre, médiane et 90ᵉ centile, en jours avec une décimale. | `agreements.status_event` | jours |
| **Impayés B** | **Non applicable** tant que le modèle B n'est pas ouvert : l'indicateur est publié comme « sans objet », jamais comme 0. Quand B ouvrira, le chiffre viendra du financeur (I-10), pas de nous. | — | — |
| **Marge par commande** (modèle A) | Pour chaque remise dont le règlement au marchand a été **exécuté** pendant la période : commission figée sur ce règlement (`settlement.payout.commission_xaf`). Publiés : nombre, somme, moyenne arrondie à l'entier inférieur. Aucun autre produit ni coût n'est inclus : c'est la marge **brute** de commission. | `settlement.payout`, exécution du règlement | XAF |

## 3. Règles communes

- Les objectifs d'un compte de test ou de démonstration ne sont pas exclus par le calcul : la base de production ne doit pas en contenir.
- Un indicateur ventilé publie toujours aussi son total, et la somme des cases est égale au total (cases `NON_ATTRIBUÉE` et `hors univers` comprises).
- Aucune donnée personnelle dans le résultat : uniquement des agrégats. Toute case de moins de 5 objectifs est publiée « < 5 » (pas de réidentification d'un client).
- Les calculs sont des fonctions SQL en lecture seule, exécutées par `app_ro`, testées sur des scénarios construits par les flux réels.
