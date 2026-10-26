# Glossaire

> Les agents IA **doivent** utiliser ces termes exactement dans le code (en anglais entre parenthèses quand un identifiant est attendu), la documentation et les messages.

## Métier

| Terme | Définition | Identifiant code |
|---|---|---|
| Client | Personne physique qui ouvre un objectif ou un achat | `Customer` |
| Partenaire | Organisation référencée : marchand, bailleur, école, concessionnaire, vendeur | `Partner` |
| Marchand | Partenaire qui vend des articles (modèles A et B) | `Merchant` |
| Bénéficiaire | Partenaire qui reçoit un règlement au titre du modèle C | `Beneficiary` |
| Établissement de cantonnement | Banque, EMF ou établissement de paiement agréé qui détient les fonds des clients | `CustodianInstitution` |
| Financeur | Établissement agréé qui octroie le crédit du modèle B et en porte le risque | `Lender` |
| Agrégateur | Prestataire de paiement qui relie la plateforme à MTN MoMo, Orange Money, etc. | `PaymentProvider` |
| Univers | Une des quatre familles de produits | `Universe` |
| Modèle A — épargne-achat | Versements progressifs, remise à 100 % | `SAVE_THEN_BUY` |
| Modèle B — achat financé | Acompte, remise immédiate, remboursement au financeur | `FINANCED_PURCHASE` |
| Modèle C — dépense planifiée | Constitution d'une somme réglée au bénéficiaire | `PLANNED_EXPENSE` |
| Objectif | Engagement du client vers un article ou une dépense, avec montant cible | `Goal` |
| Offre | Article ou dépense + modèle + conditions publiées | `Offer` |
| Plan de paiement | Règles d'échéances d'une offre (rythme, durée, minimum) | `PaymentPlan` |
| Accord | Version contractuelle acceptée par le client, horodatée et figée | `Agreement` |
| Versement | Paiement entrant confirmé par l'agrégateur | `Contribution` |
| Tentative de paiement | Demande de paiement non encore confirmée | `PaymentAttempt` |
| Remise | Délivrance de l'article au client, prouvée par code à usage unique | `Handover` |
| Règlement | Paiement sortant vers un partenaire | `Payout` |
| Remboursement | Restitution de fonds au client | `Refund` |
| Litige | Réclamation formelle pouvant bloquer une clôture | `Dispute` |
| Porte de lancement | Ensemble des conditions qui autorisent l'ouverture au public | — |

## Financier et comptable

| Terme | Définition | Identifiant code |
|---|---|---|
| Grand livre | Ensemble des écritures en partie double, en ajout seul | `Ledger` |
| Écriture | Mouvement équilibré (Σ débits = Σ crédits) composé de lignes | `JournalEntry` |
| Ligne d'écriture | Débit ou crédit d'un compte pour un montant entier en XAF | `Posting` |
| Compte | Compte du plan de comptes interne | `LedgerAccount` |
| Contre-passation | Écriture inverse qui corrige une écriture validée sans la modifier | `Reversal` |
| Fonds de tiers | Sommes détenues pour le compte des clients ou partenaires ; jamais du chiffre d'affaires | — |
| Rapprochement | Comparaison du grand livre avec les relevés de l'agrégateur et du compte cantonné | `Reconciliation` |
| Invariant de cantonnement | Σ des soldes clients au grand livre = solde du compte cantonné (à l'écart de rapprochement documenté près) | — |
| XAF | Code ISO 4217 du franc CFA d'Afrique centrale ; 0 décimale | `XAF` |
| TEG | Taux effectif global, à afficher pour le modèle B | — |

## Technique et sécurité

| Terme | Définition |
|---|---|
| Idempotence | Propriété d'une opération rejouée qui ne produit son effet qu'une fois |
| Clé d'idempotence | Identifiant fourni par l'appelant pour dédoublonner une opération |
| Chaîne de hachage | Chaque écriture contient l'empreinte de la précédente ; toute altération casse la chaîne |
| Arbre de Merkle | Arbre d'empreintes permettant de prouver qu'une écriture appartient à un lot |
| Ancrage | Publication de la racine de Merkle signée et horodatée chez un témoin externe |
| Boîte d'envoi transactionnelle (outbox) | Table où un événement est écrit dans la même transaction que l'état, puis publié |
| Maker-checker | Une personne prépare, une autre approuve ; jamais la même |
| ASVS / MASVS | Standards OWASP de vérification de sécurité (web/API, mobile) |
| SBOM | Inventaire des composants logiciels (CycloneDX) |
| ADR | Architecture Decision Record, décision d'architecture tracée |
| Harness | Environnement qui exécute un agent IA avec ses outils et ses permissions |
