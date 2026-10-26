# Matrice de traçabilité

> Version 1.0 · 26 octobre 2026 · À compléter par chaque lot (colonne « Test » et « Preuve »). Une exigence sans test n'est pas « Vérifiée ».
> Statuts : P = Proposée · A = Approuvée · I = Implémentée · V = Vérifiée · R = Retirée

| Exigence | Source / norme | Lot | Test(s) | Preuve | Statut |
|---|---|---|---|---|---|
| F-ACC-001 | Dossier projet ; NIST SP 800-63 | 06 | `identity.signup.otp.*` | — | A |
| F-ACC-002 | ASVS 5.0 (authentification) | 06 | `identity.pin.*`, `attack/identity/*` | — | A |
| F-ACC-003 | Règl. 01/CEMAC/UMAC/CM ; COBAC R-2023/01 | 07 | `kyc.limits.*` | — | A |
| F-ACC-006 | ASVS 5.0 ; MASVS-AUTH | 06 | `identity.device.block.*` | — | A |
| F-CAT-002 | Décision : pas de crédit par la plateforme | 09 | `catalog.plan.refuse_unapproved` | — | A |
| F-CAT-003 | Promesse « prix garanti » | 10 | `agreements.price_frozen.*` | — | A |
| F-SAV-002 | CDC_04 ; ASVS 5.0 | 11 | `payments.confirm_server_side.*` | — | A |
| F-SAV-004 | Non-répudiation | 12 | `settlement.handover_code.*` | — | A |
| F-FIN-002 | Règl. COBAC (crédit) | 13 | `lending.no_handover_without_decision` | — | A |
| F-FIN-003 | Règles COBAC sur le TEG | 13 | `lending.apr_displayed_and_signed` | — | A |
| F-PLN-002 | Risque R-09 | 10 | `agreements.beneficiary_verified.*` | — | A |
| F-PAY-002 | INT-IDEM-001 | 11 | `attack/payments/replay_1000` | — | A |
| F-PAY-003 | ASVS 5.0 (API, webhooks) | 11 | `attack/payments/webhook_*` | — | A |
| F-PAY-004 | INT-IDEM-005 | 11 | `attack/payments/out_of_order` | — | A |
| F-SET-003 | ISO/IEC 27002 (séparation des tâches) | 08, 12 | `attack/makerchecker/*` | — | A |
| F-BO-002 | INT-LED-003 | 02, 21 | `attack/ledger/mutation_by_role` | — | A |
| NF-FUN-001 | ISO 4217 | 01 | `money.no_float` (analyse statique) | — | A |
| NF-REL-002 | ISO 22301 | 24 | Test de bascule | — | A |
| SEC-AUTH-004 | NIST SP 800-63 (AAL3) | 08 | `admin.webauthn_required` | — | A |
| SEC-AUTHZ-002 | ASVS 5.0 (contrôle d'accès) | Tous | `attack/authz/field_allowlist_*` | — | A |
| SEC-AUTHZ-004 | ASVS 5.0 | 08 | `attack/authz/matrix` | — | A |
| SEC-CRY-003 | FIPS 140-3 ; FIPS 186-5 | 03 | Revue + test de signature | — | A |
| SEC-MOB-004 | MASVS-RESILIENCE ; MASTG v2.0 | 19 | Tests MASTG correspondants | — | A |
| SEC-SDLC-003 | SLSA ; CycloneDX ; SSDF | 00 | Vérification CI | — | A |
| INT-LED-001/002 | CDC_04 ; ADR-0002 | 02 | `db.ledger.balanced_deferred` | — | A |
| INT-LED-003 | ADR-0002 | 02 | `attack/ledger/update_delete_*` | — | A |
| INT-HASH-001 | RFC 8785 ; FIPS 180-4 | 03 | `ledger.hash_chain.*` + vérificateur | — | A |
| INT-ANC-001…005 | RFC 6962/9162 ; RFC 3161 | 03, 23 | `ledger.merkle.*`, `witness.*` | — | A |
| INT-VER-001 | ADR-0003 | 04 | Jeu d'altérations injectées | — | A |
| INT-REC-002 | Invariant de cantonnement | 14 | `recon.invariant.*` | — | A |
| REG-DPD-004 | Loi 2024/017 | ADR-0004 | Inspection | — | P |
| REG-LBC-004 | Règl. LBC/FT CEMAC | 07, 17 | `notifications.no_tipping_off` | — | A |
| REG-CON-004 | Loi de finances 2025 ; décision | 17 | Inspection | — | A |

Les exigences non listées ici le sont au fil des lots ; la matrice complète est un livrable de chaque lot (`AGENTS.md` § 10).
