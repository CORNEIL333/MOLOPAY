# État du sprint — 2026-10-26 (jour 1)

- **Heure de début (Europe/Paris) :** 08:13
- **Branche :** `sprint/integration` (jamais `main`)
- **Lot en cours :** clôture de journée (tous les lots du jour sont terminés)
- **Journal du jour :** `docs/journal/2026-10-26.md`

## Lots

| Lot | Statut | Commit | Notes |
|---|---|---|---|
| 00 · Outillage | terminé | `6ffcf99` | lint, typecheck, tests, attaques, e2e, CI, frontières, secrets, SCA |
| 01 · Money | terminé | `86c0086` | XAF `bigint`, 17 tests dont propriétés fast-check |
| 02 · Ledger | terminé (code) | `c0a6ad9` | 26 tests unitaires verts ; 32 tests Testcontainers **écrits, non exécutés** (Docker absent, D2) |
| 03 · Chaînage/Merkle | terminé | `1bf7677` | 66 tests unitaires + 5 tests réseau TSA réels ; JCS, chaîne SHA-256, Merkle RFC 9162, STH Ed25519, RFC 3161 vérifié CMS/EKU/chaîne |
| 04 · Vérificateur indépendant | terminé | `9dd0ee6` | Rust (D1), 9 tests crate + 20 altérations injectées + JSON strict ; `pnpm verify:ledger` vérifie l'export 6 écritures / 3 têtes / 2 témoins ; même dépôt (D9) |
| 05 · Audit | terminé | `3adf53f`, `a025684`, `acd7eed` | 18 tests domaine ; migration `audit.event` (chaîne, ajout seul, motif, 51 clés sensibles en miroir TS/SQL, clés hors `[A-Za-z0-9_.-]` refusées) ; 10 tests base écrits ; lecture SQL paginée prête, exposition HTTP différée au RBAC du lot 08 (D10) |
| 06 · Identity | terminé (code) | `ebb2aac`, `825043e`, `6226d0d`, `cb4bf17` | 31 tests domaine + 30 tests d'attaque ; migrations `0004_identity.sql` et `0007_identity_clock.sql` ; 24 tests Testcontainers **écrits, non exécutés** (D2) ; trois revues adversariales et durcissements (horloge murale, grants colonne, KYC non attribuable, MAC OTP, numéro déjà attribué) ; adaptateur SMS réel différé (D3), aucune simulation |
| 08 · Admin | terminé (code) | `0d7fdc6`, `c76bc90`, `b2a9fe3`, `31a0ccf`, `0d6c270`, `acd7eed` | 177 tests domaine (matrice 9×16 exhaustive, ABAC, maker-checker, charge utile scellée SHA-256/JCS, contexte lié au payload) + 7 tests paramétrage versionné ; migrations `0003_admin.sql` et `0006_admin_clock.sql` (préparation/décision sur `clock_timestamp()`, durée ≤ 7 jours) ; 13 tests Testcontainers **écrits, non exécutés** (D2) ; deux revues adversariales et durcissements |

## Prochaine étape exacte

Sur une machine avec Docker : `pnpm install --frozen-lockfile && pnpm test:db` (79 tests écrits, jamais exécutés), corriger toute divergence SQL, puis retirer la mention « non exécuté ». Ensuite seulement : contrôleurs HTTP derrière un guard d'authentification réel, puis lot paiements (11) pour INT-LED-008 et la lecture du solde dans la récupération. Aucun remote configuré : rien n'a été poussé.

## Commandes de la dernière barrière

- `pnpm typecheck` : OK
- `pnpm lint` : OK (`Module boundaries: OK`)
- `pnpm test` : 376 tests verts (14 fichiers)
- `pnpm test:tsa` : 5 tests réseau verts contre DigiCert (jeton réel : signature CMS, EKU horodatage, chaîne Mozilla, nonce, empreinte)
- `pnpm test:attack` : 37 tests verts (2 fichiers)
- `pnpm test:e2e` : 1 test vert
- `cargo test --manifest-path tools/verifier/Cargo.toml` : 9 tests verts
- `pnpm test:db` : non exécutable, sortie `DOCKER_UNAVAILABLE` (D2) ; 32 tests ledger + 10 tests audit + 13 tests admin + 24 tests identité écrits (79) ; job CI `db` ajouté (`e14d939`), non exécuté localement
- `pnpm verify:ledger` : OK, `LEDGER VERIFIED entries=6 heads=3 witnesses=2`
- `pnpm openapi:check` : OK
- `pnpm security:scan` : OK (secrets et SCA)


## Plan lot 05 (5 lignes)

1. Migration `0002_audit.sql` : schéma `audit`, table `event`, verrou de chaîne, séquence sans trou, ajout seul, motif obligatoire pour les lectures sensibles.
2. Domaine pur `audit/domain.ts` : types d'événements déclarés, validation, JCS + SHA-256, vérification de chaîne, refus des métadonnées sensibles.
3. Tests unitaires : chaîne valide, trou, prev_hash, contenu altéré, id dupliqué, motif manquant, métadonnées interdites, flottants.
4. Lecture audit : requêtes SQL paramétrées paginées + validation testée ; exposition HTTP volontairement différée au RBAC du lot 08 (D10), pas de journal sensible sans contrôle d'accès.
5. Test base `audit.db.test.ts` (à exécuter dès Docker) : chaîne, ajout seul, privilèges `app_rw`/`app_ro`, motif obligatoire ; puis barrières et commit.

## Plan lot 08 (5 lignes)

1. Domaine RBAC : 9 rôles internes, 16 actions, matrice explicite, décisions refusées par défaut.
2. ABAC : périmètre ville/partenaire, plafond d'approbation, motif obligatoire pour lectures sensibles et bris de glace.
3. Moteur maker-checker générique : préparation, décision distincte, expiration, annulation, contre-passation d'état interdite, TTL bris de glace ≤ 2 h.
4. Traçabilité : chaque transition produit un `AuditEventDraft` chaînable, sans recopier la charge utile métier.
5. Migration `0003_admin.sql` (demandes et décisions en ajout seul), tests base à exécuter dès Docker, puis barrières et commit.

## Plan lot 06 (5 lignes)

1. Domaine pur `identity/domain.ts` : E.164 Cameroun, OTP 6 chiffres à usage unique (HMAC poivré, expiration, essais bornés), aucune livraison SMS simulée.
2. PIN 6 chiffres : refus des suites et répétitions, Argon2id + poivre fourni par l'appelant ; le domaine n'accepte aucun poivre par défaut.
3. Appareils : clé Ed25519 publique, enregistrement, révocation ; signature de transaction sur payload JCS lié à compte/appareil/opération/montant/ville/partenaire + nonce.
4. Sessions : accès ≤ 15 min, rafraîchissement lié à l'appareil, révocation immédiate ; récupération interdisant le simple OTP sur nouveau numéro, délai 24 h si solde ; blocage immédiat.
5. Migration `0004_identity.sql`, tests d'attaque identité (rejeu, autre appareil, PIN trivial, OTP rejoué/expiré, session expirée, récupération contournée), tests base écrits non exécutés, barrières et commit.
