# Cahier des charges — 05 · Architecture et données

> Version 1.0 · 26 octobre 2026 · Vues inspirées du modèle C4 et d'ISO/IEC/IEEE 42010. Choix de pile : ADR-0001 (statut : **Proposé**, à valider par le fondateur).

## 1. Vue de contexte (C4 niveau 1)

```
 [Client]──app/USSD──┐                     ┌──[Agrégateur MoMo/OM/cartes]
 [Diaspora]──web─────┤                     ├──[Établissement de cantonnement]
 [Partenaire]─portail┼──► PLATEFORME ◄─────┼──[Financeur agréé (B)]
 [Équipe interne]─BO─┘                     ├──[Passerelle SMS / USSD opérateurs]
                                           ├──[Autorité d'horodatage RFC 3161]
                                           └──[Témoins d'ancrage]
```

## 2. Vue des conteneurs (C4 niveau 2)

| Conteneur | Technologie proposée | Rôle |
|---|---|---|
| Application client | Flutter (Android, iOS) + web léger | Parcours client |
| Passerelle USSD | Service dédié (même dépôt) derrière l'agrégateur/opérateur | Menus USSD, sessions courtes |
| Portail partenaire | Next.js (TypeScript) | Catalogue, commandes, remises, règlements |
| Back-office | Next.js (TypeScript), réseau d'administration isolé | Opérations, finance, conformité, audit |
| API cœur | Node.js + TypeScript (NestJS), **monolithe modulaire** | Toute la logique métier et financière |
| Base transactionnelle | PostgreSQL 16+ (réplication synchrone) | État métier, grand livre, outbox |
| Traitements asynchrones | Travailleurs lisant l'outbox (pas de courtier externe au lancement) | Webhooks sortants, notifications, rapprochement, lots Merkle |
| Stockage objet | Compatible S3, chiffré, privé | Pièces KYC, preuves de remise, exports |
| KMS / HSM | Validé FIPS 140-3 | Clés de chiffrement et de signature |
| Vérificateur indépendant | Go ou Rust, dépôt séparé | Contrôle nocturne de l'intégrité (`CDC_04` § 6) |

## 3. Modules du monolithe (C4 niveau 3)

| Module | Responsabilité | Peut dépendre de |
|---|---|---|
| `identity` | Comptes, appareils, PIN, OTP, sessions | `audit` |
| `kyc` | Niveaux, pièces, vérifications | `identity`, `audit` |
| `catalog` | Partenaires, offres, stocks, plans | `audit` |
| `agreements` | Objectifs A/B/C, accords, prix figés | `catalog`, `ledger`, `audit` |
| `payments` | Tentatives, prestataires, webhooks | `ledger`, `audit` |
| `ledger` | Écritures, comptes, chaînage, lots Merkle | `audit` uniquement |
| `settlement` | Remises, règlements, remboursements | `agreements`, `ledger`, `audit` |
| `lending` | Dossiers B, décisions, échéanciers financeur | `agreements`, `ledger`, `audit` |
| `disputes` | Réclamations, litiges | `agreements`, `audit` |
| `risk` | Règles de fraude, alertes | lecture des autres via événements |
| `reconciliation` | Rapprochements | `ledger`, `payments` |
| `notifications` | SMS, push | événements |
| `audit` | Journal d'audit chaîné | — |
| `admin` | Rôles, paramètres versionnés, maker-checker | `audit` |

Règles : aucun module n'écrit dans les tables d'un autre ; communication par interfaces publiques ou événements ; frontières vérifiées en CI.

## 4. Modèle de données (entités principales)

| Entité | Champs clés | Remarques |
|---|---|---|
| `Customer` | id, phone_e164, kyc_level, status, created_at | Numéro chiffré + empreinte pour la recherche |
| `Device` | id, customer_id, public_key, attestation, status | Clé publique de signature de transaction |
| `Partner` | id, type (merchant, beneficiary), legal_ids, status, settlement_account_ref | Validé par maker-checker |
| `Offer` | id, partner_id, universe, models[], price_xaf, city[], stock, terms_version | Prix catalogue |
| `PaymentPlan` | id, model, rhythm, min_amount, max_duration, approved_by | Approuvé plateforme (+ financeur pour B) |
| `Goal` / `Agreement` | id, customer_id, model, offer_id / beneficiary_id, target_xaf (figé), terms_hash, signed_at, device_signature, status | Accord immuable ; versions nouvelles = nouvel accord |
| `PaymentAttempt` | id, agreement_id, provider, amount_xaf, idem_key, status | |
| `Contribution` | id, attempt_id, provider_tx_id (unique), amount_xaf, confirmed_at, entry_id | Lien vers l'écriture |
| `Handover` | id, agreement_id, code_hash, used_at, partner_user_id, location | Code stocké en empreinte |
| `Payout` / `Refund` | id, amount_xaf, maker_id, checker_id, instruction_signature, status, entry_id | |
| `LoanFile` | id, agreement_id, lender_id, decision, decision_ref, apr, schedule | Modèle B |
| `Dispute` | id, agreement_id, status, blocks_settlement | |
| `JournalEntry` / `Posting` | voir `CDC_04` | En ajout seul |
| `LedgerBatch` | id, from_seq, to_seq, merkle_root, sth_signature, tsa_token, witness_acks[] | Têtes signées |
| `AuditEvent` | seq, actor, action, target, reason, prev_hash, hash | En ajout seul |
| `ParameterVersion` | key, value, version, valid_from, approved_by | Paramètres métier versionnés |

Conventions : clés UUID v7 ; horodatages `timestamptz` UTC ; montants `bigint` XAF ; suppressions logiques uniquement pour les données non financières ; aucune suppression physique de données financières.

## 5. Machines à états

### 5.1 Tentative de paiement

```
CREATED → PENDING → CONFIRMED (terminal)
                  → FAILED (terminal)
                  → EXPIRED (terminal)
CONFIRMED → REFUND_PENDING → REFUNDED (terminal)
```
Interdit : tout retour depuis un état terminal ; `CONFIRMED` sans `provider_tx_id` vérifié.

### 5.2 Objectif / accord (A et C)

```
DRAFT → ACTIVE → FUNDED (100 %) → HANDED_OVER | PAID_TO_BENEFICIARY → CLOSED
ACTIVE → CANCELLED_BY_CUSTOMER → REFUNDED → CLOSED
ACTIVE/FUNDED → DISPUTED → (retour à l'état précédent) | REFUNDED
ACTIVE → FROZEN (décès, fraude, perte de téléphone) → ACTIVE | REFUNDED
```
`LOCKED` est un attribut (verrouillage client), pas un état.

### 5.3 Achat financé (B)

```
DRAFT → SUBMITTED_TO_LENDER → APPROVED | DECLINED (terminal)
APPROVED → DOWN_PAYMENT_CONFIRMED → HANDED_OVER → REPAYING → REPAID → CLOSED
REPAYING → IN_ARREARS → REPAYING | DEFAULTED (géré par le financeur)
```

### 5.4 Règlement / remboursement

```
PREPARED (maker) → APPROVED (checker ≠ maker) → INSTRUCTED (signé) → EXECUTED | REJECTED
PREPARED → CANCELLED
```

## 6. API

| Règle | Détail |
|---|---|
| Contrat | OpenAPI 3.1, versionné (`/v1`), généré et testé en CI (tests de contrat) |
| Erreurs | RFC 9457 (Problem Details) ; codes métier stables |
| Idempotence | En-tête `Idempotency-Key` obligatoire sur toute écriture |
| Pagination | Par curseur |
| Webhooks sortants (partenaires API) | Signés HMAC, réessais exponentiels, journal de livraison |
| Horodatage | ISO 8601 UTC |

## 7. Environnements et déploiement

Dev (données synthétiques uniquement) → Test → Préproduction (copie de structure, données anonymisées) → Production. Infrastructure en code, déploiements par pipeline signé, approbation humaine obligatoire pour la production, retour arrière testé. Hébergement : ADR-0004.
