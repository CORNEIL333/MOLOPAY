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
| 03 · Chaînage/Merkle | terminé | à reporter | 66 tests unitaires + 5 tests réseau TSA réels ; JCS, chaîne SHA-256, Merkle RFC 9162, STH Ed25519, RFC 3161 vérifié CMS/EKU/chaîne |
| 04 · Vérificateur indépendant | à faire | — | Go indisponible : bascule Rust (D1) |
| 05 · Audit | à faire | — | — |
| 06 · Identity | à faire si temps | — | `.env.local` absent |
| 08 · Admin | à faire | — | — |

## Prochaine étape exacte

Lot 04 : vérificateur Rust indépendant du code de production, export JSON du grand livre, recalcul équilibre + chaîne + Merkle + signatures + têtes TSA, branchement de `pnpm verify:ledger`, jeu d'altérations détectées.

## Commandes de la dernière barrière

- `pnpm typecheck` : OK
- `pnpm lint` : OK (`Module boundaries: OK`)
- `pnpm test` : 114 tests verts (9 fichiers)
- `pnpm test:tsa` : 5 tests réseau verts contre DigiCert (jeton réel : signature CMS, EKU horodatage, chaîne Mozilla, nonce, empreinte)
- `pnpm test:attack` : 7 tests verts
- `pnpm test:e2e` : 1 test vert
- `pnpm test:db` : non exécutable, sortie `DOCKER_UNAVAILABLE` (D2)
- `pnpm verify:ledger` : non exécutable, vérificateur absent (lot 04)

