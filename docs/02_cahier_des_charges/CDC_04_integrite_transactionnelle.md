# Cahier des charges — 04 · Intégrité transactionnelle

> Version 1.0 · 26 octobre 2026 · Ce chapitre fixe le **niveau de sécurité transactionnelle attendu**. Il emprunte aux chaînes de blocs leurs garanties (immutabilité, vérifiabilité par un tiers, non-répudiation, horodatage prouvé) sans en reprendre le consensus distribué, inutile ici.
> Références : FIPS 180-4, FIPS 186-5, RFC 8785, RFC 6962 / RFC 9162, RFC 3161, ISO 4217.

## 1. Pourquoi pas une blockchain, et ce qu'on en garde

| Propriété d'une blockchain | Utile ici ? | Comment on l'obtient |
|---|---|---|
| Immutabilité de l'historique | **Oui** | Grand livre en ajout seul imposé par la base + chaîne de hachage |
| Détection de toute altération | **Oui** | Chaque écriture contient l'empreinte de la précédente ; vérificateur indépendant |
| Preuve d'existence à une date | **Oui** | Racine de Merkle quotidienne signée, horodatée (RFC 3161) et ancrée chez des témoins externes |
| Vérifiabilité par un tiers sans accès au système | **Oui** | Preuves d'inclusion et de cohérence (RFC 6962) remises aux auditeurs, partenaires et clients |
| Consensus entre parties qui ne se font pas confiance | Non | Un seul opérateur responsable devant le régulateur ; les partenaires agréés jouent le rôle de témoins |
| Jeton, monnaie, contrat intelligent public | **Non** | Interdit : pas d'émission de valeur, pas de données personnelles sur une chaîne publique |

**Décision (ADR-0003)** : registre « à preuve d'altération » (*tamper-evident*) de type journal transparent, ancré quotidiennement chez au moins deux témoins indépendants, dont, optionnellement, une chaîne publique (empreinte seule, aucune donnée).

## 2. Grand livre en partie double (INT-LED)

| ID | Exigence |
|---|---|
| INT-LED-001 | Tout mouvement de valeur DOIT être une écriture (`JournalEntry`) composée d'au moins deux lignes (`Posting`) dont Σ débits = Σ crédits, en XAF entiers (`BIGINT`, jamais flottant). |
| INT-LED-002 | L'équilibre DOIT être imposé par la base de données (contrainte différée vérifiée à la validation de la transaction), en plus du code applicatif. |
| INT-LED-003 | Le grand livre est **en ajout seul** : les rôles applicatifs et humains n'ont ni `UPDATE` ni `DELETE` sur les tables d'écritures ; un déclencheur rejette en outre toute tentative, y compris d'un rôle propriétaire hors procédure de migration signée. |
| INT-LED-004 | Toute correction DOIT être une contre-passation (écriture inverse liée à l'originale par `reverses_entry_id`), suivie si besoin d'une écriture correcte ; les deux sont soumises à maker-checker. |
| INT-LED-005 | Les soldes ne sont jamais stockés comme vérité : ils sont **dérivés** des écritures (vues matérialisées recalculables). Un cache de solde est permis s'il est vérifié contre la dérivation à chaque rapprochement. |
| INT-LED-006 | Le plan de comptes DOIT séparer strictement : fonds des clients (passif envers les clients), fonds dus aux partenaires, fonds du financeur (modèle B), produits acquis (commissions), frais d'encaissement, comptes de suspens. |
| INT-LED-007 | Chaque écriture porte : identifiant UUID v7, horodatage serveur (UTC), type d'opération, références métier (accord, versement, règlement), identité de l'initiateur et, le cas échéant, des approbateurs, clé d'idempotence, numéro de séquence global strictement croissant, empreinte de chaînage. |
| INT-LED-008 | Les écritures d'un même flux métier DOIVENT être créées dans la même transaction que le changement d'état métier correspondant (pas d'état métier sans écriture, pas d'écriture sans état). |

### 2.1 Plan de comptes minimal

| Code | Compte | Nature |
|---|---|---|
| 1100 | Compte cantonné chez l'établissement (miroir) | Actif (fonds de tiers) |
| 1200 | Créances sur l'agrégateur (encaissements en transit) | Actif |
| 2100-{client} | Fonds des clients — objectifs A et C | Passif envers les clients |
| 2200-{partenaire} | Fonds dus aux partenaires | Passif envers les partenaires |
| 2300-{financeur} | Remboursements collectés pour le financeur (B) | Passif envers le financeur |
| 2900 | Suspens à identifier | Passif, doit tendre vers 0 |
| 7100 | Commissions marchandes acquises | Produit |
| 7200 | Commissions d'apport financeur | Produit |
| 7300 | Abonnements partenaires | Produit |
| 6100 | Frais d'encaissement et de règlement | Charge |

### 2.2 Exemple : versement de 5 000 FCFA sur un objectif A

| Ligne | Compte | Débit | Crédit |
|---|---|---|---|
| 1 | 1200 Créance agrégateur | 5 000 | |
| 2 | 2100-{client} Fonds du client | | 5 000 |

À réception des fonds sur le compte cantonné : débit 1100 / crédit 1200. À la remise : débit 2100-{client} / crédit 2200-{marchand} ; puis commission : débit 2200-{marchand} / crédit 7100.

### 2.3 Esquisse de mise en œuvre (PostgreSQL, indicative)

```sql
-- Rôle applicatif : insertion seule
REVOKE UPDATE, DELETE, TRUNCATE ON ledger.journal_entry, ledger.posting FROM app_rw;
GRANT INSERT, SELECT ON ledger.journal_entry, ledger.posting TO app_rw;

-- Refus structurel de toute modification
CREATE FUNCTION ledger.forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ledger is append-only'; END $$;
CREATE TRIGGER no_update BEFORE UPDATE OR DELETE ON ledger.posting
  FOR EACH ROW EXECUTE FUNCTION ledger.forbid_mutation();

-- Équilibre vérifié à la validation de la transaction
CREATE CONSTRAINT TRIGGER balanced AFTER INSERT ON ledger.posting
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION ledger.assert_entry_balanced();  -- Σdébits = Σcrédits pour NEW.entry_id
```

## 3. Chaîne de hachage (INT-HASH)

| ID | Exigence |
|---|---|
| INT-HASH-001 | Chaque écriture DOIT contenir `prev_hash` (empreinte de l'écriture de séquence précédente) et `entry_hash = SHA-256(prev_hash ‖ JCS(contenu))`, où `JCS` est la sérialisation canonique RFC 8785 du contenu (champs, lignes triées par ordre défini, montants entiers, dates ISO 8601 UTC). |
| INT-HASH-002 | La séquence globale DOIT être sans trou et strictement croissante ; l'attribution se fait sous verrou (une seule écriture validée par numéro). |
| INT-HASH-003 | L'écriture de genèse a `prev_hash` = 32 octets nuls et contient l'empreinte des paramètres initiaux (plan de comptes v1, clé publique de signature). |
| INT-HASH-004 | Le calcul DOIT être déterministe et reproductible par un outil indépendant écrit dans un autre langage (voir § 6). |
| INT-HASH-005 | Le même mécanisme s'applique au **journal d'audit de sécurité** (SEC-LOG-001) et au **journal des événements métier**. |

```
entry_hash(n) = SHA-256( entry_hash(n-1) || JCS({seq, id, ts, type, refs, postings[], actor, approvers[], idem_key}) )
```

## 4. Lots, arbres de Merkle et ancrage (INT-ANC)

| ID | Exigence |
|---|---|
| INT-ANC-001 | Les écritures sont regroupées en **lots** (au minimum toutes les heures et à chaque clôture quotidienne à 00:00 Africa/Douala). Pour chaque lot, un arbre de Merkle conforme à RFC 6962/9162 est calculé sur les `entry_hash`. |
| INT-ANC-002 | La **tête signée** du journal (taille, racine, horodatage) est signée en Ed25519 par la clé HSM de la plateforme (« signed tree head »). |
| INT-ANC-003 | La tête quotidienne DOIT être horodatée par une autorité d'horodatage RFC 3161 indépendante. |
| INT-ANC-004 | La tête quotidienne DOIT être transmise à **au moins deux témoins indépendants** qui la conservent : l'établissement de cantonnement et le financeur (canal authentifié, accusé de réception signé). Un troisième témoin PEUT être un ancrage public de l'empreinte seule (par exemple OpenTimestamps sur Bitcoin), sans aucune donnée personnelle ni montant. |
| INT-ANC-005 | Le système DOIT fournir sur demande : une **preuve d'inclusion** d'une écriture dans une tête signée, et une **preuve de cohérence** entre deux têtes (l'historique antérieur n'a pas été réécrit). |
| INT-ANC-006 | Le client PEUT obtenir, pour chaque reçu, la preuve d'inclusion de son versement (lien de vérification dans le reçu numérique). |

## 5. Idempotence et machines à états (INT-IDEM)

| ID | Exigence |
|---|---|
| INT-IDEM-001 | Toute commande qui crée ou déplace de la valeur DOIT porter une clé d'idempotence ; la base impose l'unicité `(portée, clé)` ; un rejeu renvoie le résultat original. |
| INT-IDEM-002 | Les identifiants de transaction des prestataires sont uniques en base (`UNIQUE (provider, provider_tx_id)`). |
| INT-IDEM-003 | Les transitions d'état sont déclarées (`CDC_05`, § 5) et vérifiées par la base (table de transitions autorisées) ; une transition non déclarée est refusée. |
| INT-IDEM-004 | Les événements sortants passent par une boîte d'envoi transactionnelle (outbox) écrite dans la même transaction ; les consommateurs sont idempotents. |
| INT-IDEM-005 | L'ordre des messages des prestataires n'est jamais supposé : un message tardif ne peut pas faire régresser un état terminal. |

## 6. Vérificateur indépendant (INT-VER)

| ID | Exigence |
|---|---|
| INT-VER-001 | Un outil de vérification **séparé du code de production** (autre dépôt, autre langage, par ex. Go ou Rust) DOIT recalculer à partir d'un export : l'équilibre de chaque écriture, la chaîne de hachage complète, les racines de Merkle, les signatures, et les comparer aux têtes reçues par les témoins. |
| INT-VER-002 | L'outil s'exécute automatiquement chaque nuit ; toute divergence déclenche une alerte critique et le gel des flux sortants (SEC-INC-003). |
| INT-VER-003 | L'outil et son mode d'emploi sont remis aux auditeurs, à l'établissement de cantonnement et au financeur. |

## 7. Rapprochement (INT-REC)

| ID | Exigence |
|---|---|
| INT-REC-001 | Rapprochement **à trois voies** quotidien : grand livre ↔ relevé de l'agrégateur ↔ relevé du compte cantonné. |
| INT-REC-002 | **Invariant de cantonnement** : Σ soldes des comptes 2100-* + 2200-* + 2300-* = solde du compte cantonné + encaissements en transit identifiés − règlements en transit identifiés. Tout écart non expliqué > 0 FCFA ouvre un incident. |
| INT-REC-003 | Les écarts sont classés (en transit, frais, doublon, inconnu) et ne sont corrigés que par écritures de régularisation approuvées (maker-checker). |
| INT-REC-004 | Ancienneté des écarts suivie ; tout écart > 48 h est escaladé à la direction et signalé à l'établissement de cantonnement. |
| INT-REC-005 | Le compte de suspens 2900 DOIT être soldé chaque fin de mois ou justifié ligne à ligne. |

## 8. Non-répudiation des parties (INT-NR)

| ID | Exigence |
|---|---|
| INT-NR-001 | Les acceptations d'accords par le client sont signées par la clé de l'appareil (SEC-AUTH-002) ; la signature et l'empreinte du texte accepté sont conservées. |
| INT-NR-002 | Les instructions de règlement envoyées à l'établissement de cantonnement sont signées par la clé HSM de la plateforme et portent l'empreinte de l'écriture correspondante. |
| INT-NR-003 | Les décisions du financeur (B) sont reçues par canal authentifié et conservées avec leur signature ou leur preuve d'origine. |

## 9. Tests obligatoires (renvoi `CDC_07`)

- Tests de propriété : sur 10⁶ séquences d'opérations aléatoires, l'équilibre global, l'invariant de cantonnement calculé sur ces séquences et la chaîne de hachage restent valides.
- Tests d'attaque : tentative d'`UPDATE`/`DELETE` par chaque rôle → refus ; webhook rejoué, désordonné, falsifié → aucun double crédit ; altération d'une ligne en base de test → le vérificateur indépendant la détecte.
- Tests de concurrence : 1 000 versements simultanés sur un même objectif → séquence sans trou, aucun doublon.
