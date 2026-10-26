# État du sprint — 2026-10-26 (jour 1)

- **Heure de début (Europe/Paris) :** 08:13
- **Branche :** `sprint/integration` (jamais `main`)
- **Lot en cours :** Lot 03 · Chaînage, Merkle, signature, horodatage

## Lots

| Lot | Statut | Commit | Notes |
|---|---|---|---|
| 00 · Outillage | terminé | `6ffcf99` | lint, typecheck, tests, attaques, e2e, CI, frontières, secrets, SCA |
| 01 · Money | terminé | `86c0086` | XAF `bigint`, 17 tests dont propriétés fast-check |
| 02 · Ledger | terminé (code) | `c0a6ad9` | 26 tests unitaires verts ; 32 tests Testcontainers **écrits, non exécutés** (Docker absent, D2) |
| 03 · Chaînage/Merkle | en cours | — | — |
| 04 · Vérificateur indépendant | à faire | — | Go indisponible : bascule Rust (D1) |
| 05 · Audit | à faire | — | — |
| 06 · Identity | à faire si temps | — | `.env.local` absent |
| 08 · Admin | à faire | — | — |

## Prochaine étape exacte

Lot 03 :
1. canonicalisation RFC 8785 (JCS) du contenu d'écriture ;
2. `entry_hash = SHA-256(prev_hash ‖ JCS(contenu))`, genèse à prev_hash nul ;
3. arbre de Merkle RFC 6962/9162 avec vecteurs officiels, preuves d'inclusion et de cohérence ;
4. tête d'arbre signée Ed25519 (clé de test hors dépôt, D5) ;
5. horodatage RFC 3161 réel (TSA publique, D6) ;
6. tests unitaires et d'intégration réseau, sans faux prestataire.

## Commandes de la dernière barrière

- `pnpm typecheck` : OK
- `pnpm lint` : OK (`Module boundaries: OK`)
- `pnpm test` : 48 tests verts
- `pnpm test:attack` : 7 tests verts
- `pnpm test:e2e` : 1 test vert
- `pnpm test:db` : non exécutable, sortie `DOCKER_UNAVAILABLE` (D2)
- `pnpm verify:ledger` : non exécutable, vérificateur absent (lot 04)
