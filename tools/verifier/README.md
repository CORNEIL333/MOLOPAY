# Vérificateur indépendant du grand livre

Outil séparé du code de production, écrit en Rust, sans aucun import du
monorepo TypeScript. Il recalcule tout à partir d'un export JSON :

- équilibre de chaque écriture (Σ débits = Σ crédits) et validité des lignes ;
- chaîne complète `entry_hash = SHA-256(prev_hash ‖ JCS(contenu))` ;
- racines de Merkle RFC 6962/9162 de chaque tête ;
- signatures Ed25519 des têtes signées ;
- concordance avec les têtes reçues des témoins ;
- continuité de séquence et unicité des clés d'idempotence ;
- contre-passations exactement en miroir.

## Compilation et exécution

```sh
cargo build --release --manifest-path tools/verifier/Cargo.toml
cargo test --manifest-path tools/verifier/Cargo.toml
./tools/verifier/target/release/verifier -export tests/fixtures/ledger-export.json \
  -public-key tests/fixtures/ledger-public-key.txt
```

`pnpm verify:ledger` compile l'outil si nécessaire puis utilise par défaut
la fixture et sa clé publique de test. Pour un export réel, passer un
chemin et une clé publique hors bande :

```sh
pnpm verify:ledger chemin/export.json chemin/cle-publique.txt
```

La clé publique **ne doit pas** provenir du même fichier que l'export :
elle est la racine de confiance des signatures de têtes.

## Format d'export (version 1)

Tout champ non listé ci-dessous est refusé (schéma strict).

```json
{
  "version": 1,
  "log_id": "…",
  "generated_at": "2026-10-06T10:00:00.000Z",
  "entries": [
    {
      "seq": 1,
      "id": "019a… (UUID v7)",
      "ts": "2026-10-01T00:00:00.000Z",
      "type": "GENESIS",
      "refs": {},
      "postings": [
        { "account_id": "019a…", "amount_xaf": "10000", "direction": "D", "ordinal": 1 }
      ],
      "actor": "…",
      "approvers": ["…"],
      "idem_scope": "…",
      "idem_key": "…",
      "reverses_entry_id": null,
      "prev_hash": "…64 hex…",
      "entry_hash": "…64 hex…"
    }
  ],
  "tree_heads": [
    {
      "tree_size": 6,
      "root_hash": "…64 hex…",
      "timestamp": "2026-10-06T09:00:00.000Z",
      "log_id": "…",
      "signature": "…base64 Ed25519…"
    }
  ],
  "witness_heads": [
    { "tree_size": 6, "root_hash": "…64 hex…" }
  ]
}
```

Contraintes : la dernière tête signée et le témoin le plus récent doivent
couvrir toutes les écritures de l'export. La signature Ed25519 porte sur le
JCS de `{algorithm, log_id, root_hash, timestamp, tree_size}`.

## Codes de sortie

| Code | Signification |
|---|---|
| 0 | `LEDGER VERIFIED …` : tout est cohérent |
| 1 | `VERIFICATION_FAILED <CODE> <détail>` : altération détectée |
| 2 | `EXPORT_INVALID …` ou `VERIFIER_USAGE …` : entrée inexploitable |

## Limites connues

- Les jetons RFC 3161 sont vérifiés à l'acquisition par le client TypeScript
  (CMS, EKU, chaîne) ; cet outil vérifie les signatures Ed25519 des têtes et
  les racines, pas la signature CMS du jeton d'horodatage.
- L'export doit être produit après la dernière tête ancrée ; les écritures
  postérieures à un témoin ne sont pas couvertes et sont donc refusées.
