# État du sprint — 2026-10-26 (jour 1)

- **Heure de début (Europe/Paris) :** 08:13
- **Branche :** `sprint/integration` (jamais `main`)
- **Lot en cours :** Lot 04 · Vérificateur indépendant (Rust)

## Lots

| Lot | Statut | Commit | Notes |
|---|---|---|---|
| 00 · Outillage | terminé | `6ffcf99` | lint, typecheck, tests, attaques, e2e, CI, frontières, secrets, SCA |
| 01 · Money | terminé | `86c0086` | XAF `bigint`, 17 tests dont propriétés fast-check |
| 02 · Ledger | terminé (code) | `c0a6ad9` | 26 tests unitaires verts ; 32 tests Testcontainers **écrits, non exécutés** (Docker absent, D2) |
| 03 · Chaînage/Merkle | terminé | `1bf7677` | 66 tests unitaires + 5 tests réseau TSA réels ; JCS, chaîne SHA-256, Merkle RFC 9162, STH Ed25519, RFC 3161 vérifié CMS/EKU/chaîne |
| 04 · Vérificateur indépendant | terminé | `9dd0ee6` | Rust (D1), 9 tests crate + 20 altérations injectées + JSON strict ; `pnpm verify:ledger` vérifie l'export 6 écritures / 3 têtes / 2 témoins ; même dépôt (D9) |
| 05 · Audit | à faire | — | — |
| 06 · Identity | à faire si temps | — | `.env.local` absent |
| 08 · Admin | à faire | — | — |

## Prochaine étape exacte

Lot 05 : journal d'audit chaîné append-only, tests d'attaque (réécriture, suppression, insertion), puis lot 08 (RBAC admin, maker-checker).

## Commandes de la dernière barrière

- `pnpm typecheck` : OK
- `pnpm lint` : OK (`Module boundaries: OK`)
- `pnpm test` : 138 tests verts (10 fichiers)
- `pnpm test:tsa` : 5 tests réseau verts contre DigiCert (jeton réel : signature CMS, EKU horodatage, chaîne Mozilla, nonce, empreinte)
- `pnpm test:attack` : 7 tests verts
- `pnpm test:e2e` : 1 test vert
- `cargo test --manifest-path tools/verifier/Cargo.toml` : 9 tests verts
- `pnpm test:db` : non exécutable, sortie `DOCKER_UNAVAILABLE` (D2)
- `pnpm verify:ledger` : OK, `LEDGER VERIFIED entries=6 heads=3 witnesses=2`

