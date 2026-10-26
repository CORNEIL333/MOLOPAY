# Dossier de projet — Plateforme d'achat planifié (Cameroun)

> Version 1.0 · 26 octobre 2026 · Venture aVIRA · Statut : cadrage validé, recherche primaire à mener

## 1. Résumé exécutif

Une plateforme camerounaise qui permet de **s'équiper et de financer ses dépenses importantes sans s'endetter**, à travers une seule application et trois mécanismes : épargner puis récupérer (A), recevoir tout de suite grâce à un financeur agréé (B), ou constituer une somme réglée directement à un bénéficiaire (C). Elle ouvre dès le premier jour ses quatre univers de produits, à Yaoundé et à Douala.

La différenciation repose sur la **confiance démontrable** : fonds clients cantonnés chez un établissement agréé et nommé, coût total affiché avant engagement, prix figé, conditions de sortie publiées, et un grand livre dont l'intégrité est vérifiable par un tiers (voir `CDC_04`).

## 2. Origine du projet

Le projet s'inspire de **MoloMolo Pay** (Côte d'Ivoire), fintech d'épargne-achat fondée par une équipe camerounaise, lancée officiellement le 1er avril 2025 et revendiquant plus d'un million d'utilisateurs en treize mois **[Établi, chiffres déclaratifs de l'entreprise]**. L'analyse complète figure dans `03_analyse_concurrentielle.md`. Leçon principale : la demande est prouvée ; la faiblesse du modèle observé est l'opacité (agrément non publié, partenaires bancaires non nommés, CGU introuvables, support débordé).

## 3. Le concept

### 3.1 Trois modèles

| Modèle | Fonctionnement | Qui porte le risque | Usages types |
|---|---|---|---|
| **A · Épargne-achat** | Le client verse à son rythme et récupère l'article une fois payé à 100 % | Aucun risque de crédit ; fonds cantonnés chez un établissement agréé | Essentiels, téléphones, électroménager, meubles |
| **B · Achat financé** | Acompte, remise immédiate, puis remboursement selon un échéancier | Le financeur agréé (banque ou EMF), qui décide seul de l'octroi | Téléphones, électroménager, équipement professionnel, motos |
| **C · Dépense planifiée** | Le client constitue une somme vers un objectif, réglée directement au bénéficiaire | Aucun risque de crédit ; bénéficiaire vérifié avant tout règlement | Loyers, cautions, frais scolaires, matériaux, terrains |

### 3.2 Quatre univers

| Univers | Exemples | A | B | C |
|---|---|---|---|---|
| Essentiels | Riz, huile, gaz, vêtements, fournitures scolaires | Oui | — | Oui |
| Technologie et équipement | Téléphones, ordinateurs, électroménager, meubles | Oui | Oui | — |
| Logement et immobilier | Loyer, caution, avance locative, matériaux, terrains | — | — | Oui |
| Mobilité et activité professionnelle | Motos, véhicules, machines, matériel de commerce | Oui | Oui | — |

### 3.3 Trois interfaces sur un socle commun

- **Application client** : Android, iOS, web léger, canal USSD, dépôt en espèces chez le partenaire.
- **Portail partenaire** : catalogue, plans autorisés, commandes, codes de remise, règlements, personnel.
- **Back-office interne** : opérations, finance, conformité, litiges, fraude, audit.

### 3.4 Quatre promesses

1. **Fonds cantonnés et visibles** : l'établissement qui détient l'argent des modèles A et C est nommé dans l'application.
2. **Coût total affiché** : prix, échéances, frais éventuels et, pour B, coût du crédit, montrés avant le premier franc.
3. **Prix garanti** : figé à la réservation pour toute la durée de l'objectif.
4. **Sortie claire** : annulation, retrait anticipé, marchand défaillant — tout est écrit et publié avant engagement.

## 4. Le marché

| Indicateur | Valeur | Année | Statut |
|---|---|---|---|
| Comptes mobile money au Cameroun | 24,86 millions, 62 % des comptes de la CEMAC | 2023 | [Établi] BEAC |
| Part du Cameroun dans les comptes CEMAC | 65 % | 2024 | [Établi] BEAC |
| Taux de comptes actifs | 47 % | 2023 | [Établi] BEAC |
| Valeur des transactions mobile money | 24 331 milliards FCFA | 2023 | [Établi] CNEF |
| Poids du mobile money dans le PIB | 5 % | 2025 | [Établi] GSMA |
| Adultes épargnant en tontine | 21 % | FinScope | [Établi] |
| Adultes épargnant en banque commerciale | 5 % | FinScope | [Établi] |
| Accès au crédit formel | 3 % de la population | FinScope 2018 | [Établi] |
| Population Douala + Yaoundé | 7,58 millions (INS) à 9,2 millions (ONU, agglomérations) | 2025 | [Établi] |

Trois constats orientent le produit : le besoin d'équipement existe alors que le crédit est quasi inaccessible ; la défiance envers le crédit mobile illégal monte (surendettement, harcèlement) ; le smartphone n'est pas universel et l'USSD domine encore.

## 5. Concurrence (synthèse)

Le paiement fractionné existe déjà : **Tontina Market** (épargne-achat, Douala), **Glotelho**, **PayMOLO (Credix)**, **PlentiKash**, **Bank'Up** (crédit d'achat). Aucune offre vérifiée ne couvre les trois modèles et les quatre univers. Détail et positionnement : `03_analyse_concurrentielle.md`.

## 6. Cadre réglementaire (synthèse)

La venture **ne détient jamais l'argent des clients et n'accorde jamais de crédit elle-même**. Elle opère comme couche technologique et de distribution, adossée à :

- un **établissement agréé** (banque, EMF ou établissement de paiement) qui tient un compte cantonné pour les modèles A et C ;
- un **financeur agréé** qui décide de l'octroi et porte le risque du modèle B.

Textes clés : règlement 04/18/CEMAC/UMAC/COBAC (services de paiement), règlement 03/16/CEMAC/UMAC/CM (systèmes et moyens de paiement), règlement 01/17/CEMAC (microfinance), règlement 01/CEMAC/UMAC/CM du 11 avril 2016 (LBC/FT) et règlement COBAC R-2023/01, loi 2024/017 sur les données personnelles (en vigueur depuis le 23 juin 2026), loi de finances 2025 (droit de 4 FCFA par transaction mobile money). Détail : `CDC_06`.

**Question ouverte critique :** une épargne affectée à un achat, conservée plusieurs mois, peut-elle être requalifiée en collecte de dépôts du public ? À trancher par avis juridique écrit et échange avec la COBAC avant lancement.

## 7. Modèle économique

Les partenaires paient, pas le client.

| Source de revenu | Payeur | Modèle |
|---|---|---|
| Commission sur vente aboutie (~3 % à tester) | Marchand | A, B |
| Commission d'apport par dossier financé | Financeur agréé | B |
| Frais de service sur règlement au bénéficiaire | Bailleur, école, vendeur | C |
| Abonnement portail : Starter gratuit, Pro 5 000–15 000 FCFA/mois, Business sur devis **[Hypothèse]** | Partenaire | Tous |
| Part du rendement des fonds cantonnés, selon contrat | Établissement partenaire | A, C |
| Services optionnels (livraison, installation, garantie) | Client, affichés avant paiement | Tous |

Règles : dépôts gratuits pour le client ; aucun frais caché ; aucun marchand n'est réglé avant que les fonds (client ou financeur) soient effectivement reçus ; une somme encaissée pour le compte d'un tiers n'est jamais du chiffre d'affaires.

Économie unitaire et calculs détaillés : `02_etude_MIT_24_etapes.md`, thème 4.

## 8. Go-to-market

| Univers | Partenaires à signer avant lancement | Lieux de recrutement |
|---|---|---|
| Essentiels | Grossistes et détaillants | Marchés Mokolo (Yaoundé), Mboppi (Douala) |
| Technologie et équipement | Vendeurs de téléphones, électroménager, meubles | Quartiers commerçants |
| Logement et immobilier | Bailleurs, agences, écoles, vendeurs de matériaux et terrains vérifiés | Réseaux d'agences, établissements scolaires |
| Mobilité et activité professionnelle | Concessionnaires motos, fournisseurs de machines | Concessions des deux villes |

Leviers : application + USSD + espèces chez le partenaire ; diaspora (« financer l'objectif d'un proche ») ; agents terrain dans chaque ville ; parrainage récompensé **uniquement sur achat abouti** ; différenciation face à Tontina Market par Yaoundé et les modèles B et C.

## 9. Risques majeurs (synthèse)

Le risque principal est **le lancement complet avec un capital limité**. Il se maîtrise par une porte de lancement unique, pas en reportant des briques. Registre complet : `04_annexes/registre_des_risques.md`.

## 10. Feuille de route

Cinq chantiers en parallèle convergent vers une porte unique ; le jour où elle s'ouvre, tout ouvre.

| Chantier | Livrables pour franchir la porte |
|---|---|
| Juridique et conformité | Avis écrit sur A, B, C ; conformité loi 2024/017 ; contrats types |
| Partenaires financiers | Convention avec l'établissement de cantonnement ; convention avec le financeur B |
| Paiements | Agrégateur MTN MoMo / Orange Money contractualisé ; USSD ; rapprochement testé |
| Réseau de partenaires | Marchands des 4 univers dans les 2 villes ; bailleurs, écoles, concessionnaires |
| Produit | 3 interfaces ; grand livre et journal d'audit vérifiables ; recette passée |

**Aucune date n'est fixée tant que les deux partenaires agréés ne sont pas signés.** C'est le chantier le plus long ; il s'ouvre en premier.

## 11. Décisions à trancher

- [ ] Stratégie de financement : entreprise régionale autofinancée, ou levée avec ambition Afrique de l'Ouest.
- [ ] Niveau de commission marchande à tester et partage des frais d'encaissement.
- [ ] Segment qui reçoit l'effort d'acquisition prioritaire.
- [ ] Ouverture des démarches auprès des deux partenaires agréés et du juriste.
- [ ] Calendrier des 30 entretiens de recherche primaire.
- [ ] Nom commercial et dépôt de marque.
- [ ] Vérification des règles d'activité annexe applicables au fondateur.
