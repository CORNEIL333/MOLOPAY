# Fiche des points ouverts — 11 novembre 2026

> Points qui **bloquent** une suite de travail et que l'agent ne peut pas trancher seul (prix, engagements commerciaux, juridique, accès externes, architecture de sécurité). Pour chacun : ce qui est bloqué, l'option appliquée en attendant (la plus prudente) et la question précise. Détails dans `DECISIONS_EN_ATTENTE.md` (référence Dnn).

## 1. Paramètres financiers (publication en maker-checker, fermés par défaut)

| Point | Bloque | En attendant | Question |
|---|---|---|---|
| Taux de commission marchand (D46) | tout règlement marchand | aucun règlement possible | Quel taux (en points de base), par type d'abonnement ? |
| Délai de contestation après remise (D46) | tout règlement marchand | idem | Combien de jours (0 à 60) ? |
| Seuils des règles de fraude (D53) | la détection de fraude | aucune détection | Valider : > 3 versements / 60 min, > 2 annulations / 30 j, > 20 remises / boutique / 24 h ? |
| Commission sur le modèle C (D50) | — | aucune commission prélevée | Faut-il en prélever une ? |

## 2. Engagements envers le client (⚖ juridique)

| Point | En attendant | Question |
|---|---|---|
| Délai de remboursement et canal (D49, D51) | non affiché | Délai promis ? Remboursement sur le Mobile Money d'origine ? |
| Délai de réponse aux réclamations (D41, D56) | 15 j cible, 45 j max (R-2020/06) | Valider ces valeurs et leur publication. |
| Rupture de stock (D57) | réservation à l'activation, aucune offre de remplacement | Remplacement proposé, ou remboursement intégral d'office ? Règle de réapprovisionnement ? |
| Gabarit « remboursement effectué » (D52) | réutilise « règlement confirmé » | Ajouter un texte distinct à F-NOT-001 (FR/EN à valider) ? |
| Textes juridiques, version des conditions (D23) | version provisoire | Textes définitifs. |

## 3. Architecture et accès (décision ou action humaine)

| Point | Bloque | Question |
|---|---|---|
| Authentification du personnel (lot 21) | toutes les routes back-office : remboursements, virements, règlements, litiges, classement des écarts, alertes de fraude | Fournisseur d'identité, MFA, réseau isolé : quel choix (ADR à approuver) ? Tous les flux existent déjà côté serveur, avec leurs contrôles de rôles. |
| Canal partenaire (lot 20) | reçus et notifications aux marchands et bénéficiaires (D47, D58) | Portail partenaire et authentification des partenaires : priorité ? |
| Agrégateur de paiement (lot 11) | tout encaissement réel | Agrégateur retenu et identifiants de l'environnement de test officiel. |
| Établissement de cantonnement | instructions signées réelles, relevés (INT-REC-001) | Format et canal des instructions ; accès aux relevés. |
| Financeur agréé (D44) | modèle B | Désignation du financeur. |
| Témoins d'ancrage (lot 23) | envoi des têtes signées | Conventions et canal authentifié ; clé de production en HSM (D5). |
| Attestation d'appareil (lot 19) | règle « plusieurs comptes par appareil » | Dépend de l'app mobile. |

## 4. Outillage (décision simple)

- `pnpm verify:ledger` réutilise un binaire déjà compilé sans le recompiler (D59). Proposition : le recompiler systématiquement (compilation incrémentale). **Accord ?**

## 5. Ce qui avance sans vous

Tous les flux serveur décrits ci-dessus existent et sont testés : base garante, mutations des règles de base, vérificateur Rust sur des flux réels. Ils seront branchés dès que les points 1 à 3 seront levés.
