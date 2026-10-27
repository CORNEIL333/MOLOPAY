# État du sprint — 2026-10-28 (reprise sous Claude Code)

- **Branche :** `sprint/integration` (jamais `main`, aucun remote)
- **Lot en cours :** 09 Catalog (onboarding partenaire fait ; offres et plans à persister)
- **Journal du jour :** `docs/journal/2026-10-28.md` (précédent : `2026-10-26.md`)
- **Client web :** PWA commitée (`d896b37`), ADR-0006 **Proposé**, fusion soumise au fondateur

## Reprise de session (après-midi)

| Sujet | Statut | Commit(s) | Preuve |
|---|---|---|---|
| Vérificateur · liste blanche des types | terminé | `a2deb98` | 29 tests TS + 9 tests Rust verts ; type inconnu au hash recalculé → `ENTRY_INVALID` |
| Audit · refs en liste blanche par action | terminé | `458454d` | 21 tests domaine verts ; action inconnue et clé interdite refusées |
| Récupération · solde dérivé du grand livre | terminé | `60aef00` | `ClientBalance` à constructeur privé, lecture `ledger.account_balance` (2100, LIABILITY) ; 34 tests domaine + 31 tests d’attaque verts |
| Identity · OTP et rotation atomiques | terminé (code) | `8b3f55b` | `UPDATE … WHERE … RETURNING` unique ; SQL **non exécuté** (D2) |
| `test:db` · `DATABASE_URL` | terminé | `9f5cf41` | harnais Testcontainers ou base existante avec garde locale ; README racine |
| Identity · tests base des stores | écrits, **non exécutés** | `8940d67`, `fac6e12` | 8 tests ajoutés (31 → 32 dans `identity.db.test.ts`) |
| Lot 09 · logique pure catalogue | terminé (partiel) | `ecc99d9` | 23 tests verts ; offre complète, partenaire validé, plans approuvés, filtres, stock ; **aucune migration**, ni persistance ni HTTP |

## Lots

| Lot | Statut | Notes |
|---|---|---|
| 00 · Outillage | terminé | lint, typecheck, tests, attaques, CI, frontières, secrets, SCA |
| 01 · Money | terminé | XAF `bigint`, tests de propriété |
| 02 · Ledger | terminé (code) | 32 tests base écrits, non exécutés (D2) |
| 03 · Chaînage/Merkle | terminé | Merkle RFC 9162, STH Ed25519, RFC 3161 réel |
| 04 · Vérificateur | terminé | Rust, liste blanche des types d’écriture ajoutée |
| 05 · Audit | terminé (code) | refs en liste blanche par action ; 10 tests base écrits |
| 06 · Identity | terminé (code) | stores OTP/rotation atomiques, solde dérivé du grand livre ; 32 tests base écrits, non exécutés |
| 08 · Admin | terminé (code) | 184 tests domaine verts ; 13 tests base écrits |
| 09 · Catalog | partiel | domaine offres/plans ; onboarding partenaire maker-checker (domaine + 0008 + store, `0eb1088`, `f82bb11`) ; persistance offres/plans et journalisation des refus à faire |

## Prochaine étape exacte

1. Obtenir un PostgreSQL 16 local (D24), puis `DATABASE_URL=… pnpm test:db` : **99 tests base** jamais exécutés (32 ledger, 10 audit, 13 admin, 32 identité, 12 catalogue). Corriger les divergences SQL réelles.
2. Réparer `pnpm` 12.6.0 sur le poste et relancer `pnpm security:scan` (SCA non exécutée).
3. Lot 09 : persistance versionnée des offres (F-PRT-002) avec publication refusée si `partner_state` ≠ VALIDATED ; plans approuvés et journalisation des refus d'activation (F-CAT-002 « refusée et journalisée » : nouveau type d'événement d'audit à ajouter).
4. Contrôleurs HTTP derrière un guard réel, puis lot 11 (paiements).

## Barrière finale (reprise)

- `pnpm typecheck` : OK
- `pnpm lint` : OK (`Module boundaries: OK`)
- `pnpm test` : **405 tests verts**, 15 fichiers
- `pnpm test:attack` : **38 tests verts**, 2 fichiers
- `cargo test --manifest-path tools/verifier/Cargo.toml` : **9 tests verts**
- `pnpm verify:ledger` : `LEDGER VERIFIED entries=6 heads=3 witnesses=2 last_tree_size=6 log_id=achat-ledger-fixture-v1`
- `pnpm openapi:check` : OK
- `pnpm security:scan` : OK (secrets et SCA)
- `pnpm test:db` : **non exécuté**, sortie `DOCKER_UNAVAILABLE` (code 2, D2) ; Docker, `psql`, `initdb` et `pg_ctl` absents. **87 tests base écrits** (32 ledger, 10 audit, 13 admin, 32 identité), 7 migrations.
- `pnpm test:tsa` : non relancé pendant la reprise (5 tests réseau déjà verts le matin)
- `pnpm test:e2e` : non relancé pendant la reprise (1 test vert le matin)
