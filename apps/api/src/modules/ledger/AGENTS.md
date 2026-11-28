# agents — module ledger

> Règles locales, complémentaires et **jamais contraires** à `/AGENTS.md`.

- Toute écriture est en partie double : au moins deux lignes, Σ débits = Σ crédits, montants entiers XAF via `@achat/money` (`bigint`).
- Aucune correction en place : une correction est une contre-passation (`reverses_entry_id`) préparée par un acteur et approuvée par un autre.
- Aucun `UPDATE`, `DELETE` ou `TRUNCATE` sur `ledger.journal_entry`, `ledger.posting` ou `ledger.account`.
- Le numéro de séquence, le `prev_hash` et l'`entry_hash` sont attribués sous verrou, dans la même transaction que l'insertion.
- Les soldes sont lus depuis `ledger.account_balance` (vue dérivée) ; aucun solde n'est stocké comme vérité.
- Ne jamais importer `payments`, `settlement` ou un autre module métier : `ledger` ne dépend que de `audit`.
