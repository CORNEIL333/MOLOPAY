# État du sprint — 2026-10-26 (jour 1)

- **Heure de début (Europe/Paris) :** 08:13
- **Branche :** `sprint/integration` (jamais `main`)
- **Lot en cours :** clôture lot 08 (commit)

## Lots

| Lot | Statut | Commit | Notes |
|---|---|---|---|
| 00 · Outillage | terminé | `6ffcf99` | lint, typecheck, tests, attaques, e2e, CI, frontières, secrets, SCA |
| 01 · Money | terminé | `86c0086` | XAF `bigint`, 17 tests dont propriétés fast-check |
| 02 · Ledger | terminé (code) | `c0a6ad9` | 26 tests unitaires verts ; 32 tests Testcontainers **écrits, non exécutés** (Docker absent, D2) |
| 03 · Chaînage/Merkle | terminé | `1bf7677` | 66 tests unitaires + 5 tests réseau TSA réels ; JCS, chaîne SHA-256, Merkle RFC 9162, STH Ed25519, RFC 3161 vérifié CMS/EKU/chaîne |
| 04 · Vérificateur indépendant | terminé | `9dd0ee6` | Rust (D1), 9 tests crate + 20 altérations injectées + JSON strict ; `pnpm verify:ledger` vérifie l'export 6 écritures / 3 têtes / 2 témoins ; même dépôt (D9) |
| 05 · Audit | terminé | `3adf53f` | 17 tests domaine ; migration `audit.event` (chaîne, ajout seul, motif) ; lecture SQL paginée prête, exposition HTTP différée au RBAC du lot 08 (D10) |
| 06 · Identity | à faire si temps | — | `.env.local` absent |
| 08 · Admin | terminé (code) | `0d7fdc6`, `c76bc90` | 174 tests domaine (matrice 9×16 exhaustive, ABAC, maker-checker, charge utile scellée SHA-256/JCS, contexte lié au payload, TTL anti-antidatage) + 7 tests paramétrage versionné lié à la demande approuvée ; migration `0003_admin.sql` ; 10 tests Testcontainers **écrits, non exécutés** (D2) ; durcissement post-revue |
| 06 · Identity | à faire si temps | — | `.env.local` absent (D3) |

## Prochaine étape exacte

Clôture de journée : relire `docs/journal/2026-10-26.md`, vérifier la barrière complète, commit final et push de `sprint/integration` si un remote existe. Lot 06 non entamé faute de secrets réels (D3).

## Commandes de la dernière barrière

- `pnpm typecheck` : OK
- `pnpm lint` : OK (`Module boundaries: OK`)
- `pnpm test` : 339 tests verts (13 fichiers)
- `pnpm test:tsa` : 5 tests réseau verts contre DigiCert (jeton réel : signature CMS, EKU horodatage, chaîne Mozilla, nonce, empreinte)
- `pnpm test:attack` : 7 tests verts
- `pnpm test:e2e` : 1 test vert
- `cargo test --manifest-path tools/verifier/Cargo.toml` : 9 tests verts
- `pnpm test:db` : non exécutable, sortie `DOCKER_UNAVAILABLE` (D2) ; 32 tests ledger + 10 tests audit + 10 tests admin écrits
- `pnpm verify:ledger` : OK, `LEDGER VERIFIED entries=6 heads=3 witnesses=2`


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
