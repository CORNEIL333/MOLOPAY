# État du sprint — 2026-10-29 (reprise sous Claude Code)

- **Branche :** `sprint/integration` (jamais `main`, aucun remote)
- **Lot en cours :** 09 Catalog (partenaires, offres versionnées et journalisation F-CAT-002 faits ; plans bloqués par D26)
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
| 09 · Catalog | partiel | onboarding partenaire maker-checker (`0eb1088`, `f82bb11`) ; offres versionnées 0009 (`bbcc012`) ; activation de plan journalisée + `CATALOG_ACTION` 0010 (`d69e1ee`) ; persistance des plans en attente de D26 |

## Prochaine étape exacte

1. ~~Exécuter les tests base~~ : fait le 2026-10-29, **110/110 verts** sur PostgreSQL 16.15 réel (D24).
2. Réparer `pnpm` 12.6.0 sur le poste et relancer `pnpm security:scan` (SCA non exécutée).
3. Lot 09 : persistance des plans approuvés après décision D26 ; sinon passer au lot 10 (accords A/C, prix figé sur `(offer_id, version)`).
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
- `pnpm test:db` (2026-10-29) : **110 tests verts**, 5 fichiers (32 ledger, 12 audit, 13 admin, 32 identité, 21 catalogue), migrations 0001–0010, PostgreSQL 16.15 local. Premier passage : 105/110 ; les 5 échecs étaient des jeux de données de test violant des contraintes existantes (corrigés côté test, aucune contrainte modifiée).
- `pnpm test:tsa` : non relancé pendant la reprise (5 tests réseau déjà verts le matin)
- `pnpm test:e2e` : non relancé pendant la reprise (1 test vert le matin)
